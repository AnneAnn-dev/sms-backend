// push.js
// -----------------------------------------------------------------------------
// Web push til badge + notifikation, ogsaa naar appen er lukket (RISIKOREGISTER
// D34, spor om at appen ikke opdaterer badgen naar den er helt lukket). VAPID
// er allerede konfigureret i server.js (webpush.setVapidDetails) — "web-push"
// er samme modul-instans i hele processen (Node cacher require), saa denne fil
// behoever ikke konfigurere den igen, blot at server.js's opstartslinjer koerer
// foer nogen route rammes (hvilket de altid goer).
//
// To dele:
//   1) registrerPushRuter(app, supabase) — /api/push/subscribe + /unsubscribe.
//      Skrivning sker KUN her, med service-role-noeglen. push_subscriptions
//      har RLS til og ingen policies (moenster: onboarding_sidevisninger) —
//      klienten kan hverken laese eller skrive tabellen direkte.
//   2) sendNytLeadPush(supabase, firmId) — kaldes fra server.js naar et
//      RIGTIGT nyt (kunde-indsendt) lead er gemt. IKKE fra manuel oprettelse
//      (/opret-opgave), som allerede saetter seen_at med det samme og derfor
//      aldrig skal give et badge-tal eller en besked (se oplaeggets punkt 2).
//
// Persondata: push-beskeden baerer bevidst hverken navn, adresse eller
// telefonnummer — kun en generisk tekst + et tal. Web push gaar via
// browserleverandoerens push-tjeneste (Google/Apple m.fl. — en tredjepart),
// saa mindst muligt indhold er en bevidst afvejning, ikke en forglemmelse
// (jf. J3/S20 om tredjepartsdata og dataminimering).
//
// Fejlhaandtering er fail-open: kan en besked ikke sendes, maa det ALDRIG
// paavirke kunden, der lige har indsendt sin opgave. Fejl logges, intet mere.
// Et 404/410-svar fra push-tjenesten betyder at abonnementet er dodt
// (afinstalleret app, ryddet browserdata) — det er selvoprydende, ikke en fejl.
//
// Ingen feature-flag: aendringen er rent additiv (ny tabel, ny valgfri UI),
// paavirker ingen der ikke selv trykker "Sla beskeder til", og foelger den
// normale deploy-ceremoni (branch -> staging -> rogtest -> PR -> prod).
// -----------------------------------------------------------------------------

const webpush = require("web-push");
const { firmIdFromToken } = require("./auth");

async function sendNytLeadPush(supabase, firmId) {
  if (!firmId) return;

  const { data: subs, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_key")
    .eq("firm_id", firmId);

  if (subsError) {
    console.error("❌ push: kunne ikke hente abonnementer:", subsError.message);
    return;
  }
  if (!subs || !subs.length) return;

  // Samme "ny"-definition som badge og "Ny"-maerket i dashboard.html.
  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("firm_id", firmId)
    .is("seen_at", null)
    .eq("status", "open");

  const payload = JSON.stringify({
    title: "Nyt lead",
    body:  "Der er kommet en ny opgave.",
    count: count || 0,
  });

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        payload
      );
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      } else {
        console.error("❌ push: afsendelse fejlede:", err.message);
      }
    }
  }));
}

function registrerPushRuter(app, supabase) {
  // ─── Gem/opdatér et abonnement ─────────────────────────────────────────
  app.post("/api/push/subscribe", async (req, res) => {
    const firmId = await firmIdFromToken(supabase, req);
    if (!firmId) return res.status(401).json({ error: "Ikke logget ind" });

    const sub      = req.body?.subscription;
    const endpoint = sub?.endpoint;
    const p256dh   = sub?.keys?.p256dh;
    const authKey  = sub?.keys?.auth;
    if (!endpoint || !p256dh || !authKey) {
      return res.status(400).json({ error: "Mangler abonnementsfelter" });
    }

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        { firm_id: firmId, endpoint, p256dh, auth_key: authKey },
        { onConflict: "endpoint" }
      );

    if (error) {
      console.error("❌ push/subscribe:", error.message);
      return res.status(500).json({ error: "Kunne ikke gemme abonnementet" });
    }
    res.json({ ok: true });
  });

  // ─── Fjern et abonnement (håndværkeren slår beskeder fra) ──────────────
  app.post("/api/push/unsubscribe", async (req, res) => {
    const firmId = await firmIdFromToken(supabase, req);
    if (!firmId) return res.status(401).json({ error: "Ikke logget ind" });

    const endpoint = req.body?.endpoint;
    if (!endpoint) return res.status(400).json({ error: "Mangler endpoint" });

    // firm_id med i .eq(): et firma kan kun slette sit EGET abonnement (IDOR).
    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("firm_id", firmId);

    if (error) {
      console.error("❌ push/unsubscribe:", error.message);
      return res.status(500).json({ error: "Kunne ikke fjerne abonnementet" });
    }
    res.json({ ok: true });
  });

  console.log("🔔 Push-ruter registreret på /api/push/subscribe + /unsubscribe");
}

module.exports = { registrerPushRuter, sendNytLeadPush };
