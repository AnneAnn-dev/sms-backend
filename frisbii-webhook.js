// frisbii-webhook.js
// -----------------------------------------------------------------------------
// Onboarding-trigger for LommeKontor via Frisbii Billing & Pay (tidl. Reepay).
// Indlaeses fra server.js med:  require("./frisbii-webhook")(app, supabase);
//
// Flow:  Simply-side -> Frisbii hosted checkout -> kunde betaler
//        -> Frisbii sender webhook "invoice_settled"
//        -> opret firma -> tildel nummer -> opret auth-bruger -> magic link
//
// Provisioneringen spejler 1:1 din Shopify-flow i onboarding.js (samme kolonner,
// samme status-felter, samme mail). Eneste forskel er triggeren + idempotens-noeglen.
// Kraever Node 18+ (global fetch).
// -----------------------------------------------------------------------------

const crypto = require("crypto");
const { sendWelcomeMail, sendAdminAlert } = require("./mail");

const FRISBII_API = "https://api.frisbii.com/v1";

module.exports = (app, supabase) => {
  const PRIVATE_KEY    = process.env.FRISBII_PRIVATE_KEY;    // privat API-noegle
  const WEBHOOK_SECRET = process.env.FRISBII_WEBHOOK_SECRET; // secret fra webhook-indstillingerne

  // ─── Signatur: HMAC-SHA256(secret, timestamp + id), hex ─────────────────────
  // Daekker KUN timestamp+id -> ingen raa body noedvendig (modsat Shopify).
  function verifySignature(body) {
    if (!body || !body.timestamp || !body.id || !body.signature) return false;
    const expected = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(body.timestamp + body.id)
      .digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(body.signature, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // ─── Frisbii API (Basic auth: noegle som brugernavn, tom adgangskode) ───────
  async function frisbiiGet(path) {
    const auth = Buffer.from(`${PRIVATE_KEY}:`).toString("base64");
    const r = await fetch(`${FRISBII_API}${path}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`Frisbii GET ${path} -> ${r.status}: ${await r.text()}`);
    return r.json();
  }

  // ─── Provisionering (spejler Shopify-flowet i onboarding.js) ────────────────
  async function provisionFirm({ customer, subscription }) {
    const subHandle = subscription.handle;
    const email     = customer.email?.toLowerCase().trim();
    const firstName = customer.first_name || "";
    const lastName  = customer.last_name  || "";
    const company   = customer.company || `${firstName} ${lastName}`.trim() || email;

    if (!email) {
      console.error("❌ Ingen email paa Frisbii-kunde:", customer.handle);
      return;
    }

    // Idempotens — er abonnementet allerede behandlet? (renewal/duplikat -> spring over)
    const { data: existing } = await supabase
      .from("firms")
      .select("id")
      .eq("frisbii_subscription", subHandle)
      .maybeSingle();
    if (existing) {
      console.log("ℹ️  Abonnement allerede behandlet:", subHandle);
      return;
    }

    // Find ledigt nummer i puljen (samme som Shopify: firm_id IS NULL)
    const { data: phoneRow, error: phoneErr } = await supabase
      .from("phone_numbers")
      .select("id, number")
      .is("firm_id", null)
      .limit(1)
      .single();
    if (phoneErr || !phoneRow) {
      console.error("❌ Ingen ledige numre i puljen!");
      // Kritisk: en betalende kunde kunne ikke faa et nummer.
      await sendAdminAlert({
        subject: "KRITISK: nummerpuljen er TOM",
        text:
          `En betalende kunde kunne IKKE tildeles et nummer, fordi puljen er tom.\n\n` +
          `Kunde: ${company} <${email}>\n` +
          `Frisbii-abonnement: ${subHandle}\n\n` +
          `Firmaet er IKKE oprettet. Laeg ledige numre i phone_numbers og opret kunden manuelt.`,
      }).catch((e) => console.error("⚠️  Kunne ikke sende alarm:", e.message));
      throw new Error("Ingen ledige numre");
    }

    // Opret firma (samme felter som Shopify-flow)
    const { data: firm, error: firmErr } = await supabase
      .from("firms")
      .insert({
        name:                 company,
        email,
        phone_number:         phoneRow.number,
        frisbii_subscription: subHandle,
        frisbii_customer:     customer.handle,
        status:               "onboarding", // onboarding-tilstand: → "active" efter verifikation
        billing_status:       "active",     // abonnementstilstand (adskilt fra onboarding)
        voice_gender:         "female",
        greeting_text:        `Hej, du har ringet til ${company}. Jeg har ikke mulighed for at tage telefonen lige nu, men jeg sender dig en SMS, så du kan beskrive din opgave. Jeg vender tilbage hurtigst muligt.`,
        verification_status:  "pending",
      })
      .select()
      .single();
    if (firmErr) {
      console.error("❌ Firma-oprettelse fejlede:", firmErr);
      throw firmErr;
    }

    // Knyt nummeret til firmaet
    await supabase
      .from("phone_numbers")
      .update({ firm_id: firm.id })
      .eq("id", phoneRow.id);

    // Advar hvis puljen er ved at loebe toer (taeller ledige numre TILBAGE)
    const LOW_POOL = Number(process.env.LOW_POOL_THRESHOLD) || 3;
    const { count: ledige } = await supabase
      .from("phone_numbers")
      .select("*", { count: "exact", head: true })
      .is("firm_id", null);
    if (typeof ledige === "number" && ledige <= LOW_POOL) {
      console.warn(`⚠️  Nummerpulje lav: ${ledige} ledige tilbage`);
      await sendAdminAlert({
        subject: `Nummerpulje lav: ${ledige} ledige tilbage`,
        text:
          `Der er kun ${ledige} ledige numre tilbage i phone_numbers.\n\n` +
          `Laeg flere numre i puljen, foer den loeber helt toer og en kunde ikke kan oprettes.`,
      }).catch((e) => console.error("⚠️  Kunne ikke sende alarm:", e.message));
    }

    // Opret Supabase Auth-bruger
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { firm_id: firm.id, firm_name: company },
    });
    if (authErr) {
      if (authErr.code === "email_exists" || /already.*regist/i.test(authErr.message)) {
        console.log("ℹ️  Auth-bruger findes allerede for", email, "— fortsaetter (magic link virker stadig)");
      } else {
        console.error("❌ Auth-bruger fejlede:", authErr.message);
      }
    }
    if (authUser?.user) {
      await supabase.from("firm_users").insert({
        firm_id: firm.id,
        user_id: authUser.user.id,
        role:    "owner",
      });
    }

    // Generer magic link til login
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type:    "magiclink",
      email,
      options: { redirectTo: `${process.env.BASE_URL}/onboarding` },
    });
    const loginUrl = linkData?.properties?.action_link || `${process.env.BASE_URL}/dashboard`;

    // Send velkomstmail (delt funktion fra mail.js)
    try {
      await sendWelcomeMail({ to: email, firmName: company, loginUrl, phoneNumber: phoneRow.number });
      console.log("✉️  Velkomstmail sendt til:", email);
    } catch (mailErr) {
      console.error("❌ Mail fejlede:", mailErr);
      // Firma er oprettet — mail kan sendes igen manuelt
    }

    console.log("✅ Firma oprettet (Frisbii):", firm.id, "—", company, "→", phoneRow.number);
  }

  // ─── Webhook-rute (express.json() er allerede sat globalt i server.js) ──────
  app.post("/webhook/frisbii", async (req, res) => {
    const body = req.body;

    // Eneste ting der kan give et ikke-2xx-svar: en ugyldig signatur.
    // Et aegte Frisbii-webhook har altid gyldig signatur, saa det faar altid 200.
    if (!verifySignature(body)) {
      console.warn("⚠️  Frisbii webhook: ugyldig signatur", body?.id);
      return res.status(401).send("invalid signature");
    }

    // Kvittér STRAKS med 200, FØR vi provisionerer. Saa kan en fejl i oprettelsen
    // (tom nummerpulje, mail-fejl, dublet-email osv.) aldrig faa Frisbii til at
    // disable webhooket. Provisioneringen koerer bagefter; fejl logges blot.
    res.status(200).send("ok");

    try {
      switch (body.event_type) {
        case "invoice_settled": {
          // Webhooket baerer ikke dataen — hent fuld state via API'et.
          const [customer, subscription] = await Promise.all([
            frisbiiGet(`/customer/${body.customer}`),
            frisbiiGet(`/subscription/${body.subscription}`),
          ]);
          await provisionFirm({ customer, subscription });
          break;
        }

        case "invoice_failed":
          await supabase.from("firms")
            .update({ billing_status: "past_due" })
            .eq("frisbii_subscription", body.subscription);
          break;

        case "subscription_cancelled":
        case "subscription_expired":
          await supabase.from("firms")
            .update({ billing_status: "cancelled" })
            .eq("frisbii_subscription", body.subscription);
          break;

        default:
          break; // oevrige events ignoreres bevidst
      }
    } catch (err) {
      // Svaret er allerede sendt (200) — vi logger bare, saa webhooket forbliver enabled.
      console.error("❌ Frisbii efterbehandling fejlede (webhook forbliver enabled):", err);
    }
  });

  console.log("📡 Frisbii webhook registreret paa /webhook/frisbii");
};
