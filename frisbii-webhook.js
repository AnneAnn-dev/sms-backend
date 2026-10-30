// frisbii-webhook.js
// -----------------------------------------------------------------------------
// Onboarding-trigger for Dit Digitale Kontor via Frisbii Billing & Pay (tidl. Reepay).
// Indlaeses fra server.js med:  require("./frisbii-webhook")(app, supabase);
//
// Flow:  Simply-side -> Frisbii hosted checkout -> kunde betaler
//        -> Frisbii sender webhook "invoice_settled"
//        -> opret firma -> tildel nummer -> opret auth-bruger -> magic link
//
// TRIAL-STARTSKUD (tilfoejet juli-26): en 0-kr-trial udloeser ALDRIG
// invoice_settled (afklaret ved eksperiment i staging 8/7-26) — kun bl.a.
// subscription_created. Derfor provisionerer subscription_created NU OGSAA,
// men KUN naar abonnementet er/bliver trial (afgjort via Frisbii-API'et, ikke
// webhook-payloaden). Betalte planer provisioneres uaendret af invoice_settled.
// Begge startskud gaar gennem SAMME provisionFirm; dobbelt-provisionering
// stoppes af (1) app-tjekket paa frisbii_subscription og (2) den race-sikre
// MEDFOEDTE unique-constraint firms_frisbii_subscription_key (fra
// frisbii-webhook-migration.sql — kolonnen blev foedt med "unique").
//
// Provisioneringen spejler 1:1 din Shopify-flow i onboarding.js (samme kolonner,
// samme status-felter, samme mail). Eneste forskel er triggeren + idempotens-noeglen.
// Kraever Node 18+ (global fetch).
//
// FORUDSAETNINGER (migrationer, i raekkefoelge):
//   1. frisbii-webhook-migration.sql  (frisbii_webhook_events + firms.billing_status_updated_at
//                                      + unique paa firms.frisbii_subscription)
//   2. webhook_events_processed       (processed_at + error — dead-letter)
//   3. phone_number_quarantine        (quarantined_until + last_firm_id)
// -----------------------------------------------------------------------------

const crypto = require("crypto");
const twilio = require("twilio");
const { sendWelcomeMail, sendAdminAlert, sendVelkomstUdenNummerMail, sendNummerKlarMail } = require("./mail");
const { uniqueSlug } = require("./slug");
const { maskerTlf, maskerMail, normalizePhone, vaelgLedigtNummer } = require("./phone");
// Fase 3, T6: synk bag FASE3_SYNK. Slukket = intet nyt sker (se frisbii-webhook-synk.js).
const { FASE3_SYNK } = require("./flags");
const { efterEvent, alarmVedFejl } = require("./frisbii-webhook-synk");
const { synkFirma } = require("./frisbii-synk");
const { lavFrisbiiGet } = require("./frisbii-miljoe");
// Fase 3, T7a: nummerets egne funktioner + karantaene efter verifikation (D95).
const { sikrTelefonModul, frigivNummer, nummerEfterSynk } = require("./telefon-nummer");
// Fase 3, T7b: nummeret efter synk + puljealarmerne (delt med gensynk-firma.js).
const { alarmSpoegelser, alarmLavPulje, nummerOgBesked } = require("./frisbii-nummer");

// Kun "+45" + otte cifre godtages som haandvaerkerens eget mobilnummer.
// Frisbii-feltet er frit tekst og valgfrit, saa der kan staa hvad som helst
// i det — et fastnetnummer, et udenlandsk nummer, en note. Et gaet her ville
// vaere vaerre end et tomt felt: onboardingen spoerger gerne, men den maa
// ikke praesentere et forkert nummer som "dit".
function danskMobil(e164) {
  return e164 && /^\+45\d{8}$/.test(e164) ? e164 : null;
}

const FRISBII_API = "https://api.frisbii.com/v1";

module.exports = (app, supabase) => {
  // Twilio-klient — bruges KUN til at verificere, at et puljenummer faktisk
  // findes i kontoen, foer det gives til en kunde (se vaelgLedigtNummer).
  // Konstrueres som i onboarding.js: SDK'en formvaliderer SID'en her, saa en
  // formugyldig vaerdi crasher ved boot. Det er uaendret adfaerd — onboarding.js
  // goer allerede praecis det samme, saa appen kan i forvejen ikke starte uden.
  const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  const PRIVATE_KEY    = process.env.FRISBII_PRIVATE_KEY;    // privat API-noegle
  const WEBHOOK_SECRET = process.env.FRISBII_WEBHOOK_SECRET; // secret fra webhook-indstillingerne
  // T6: synkFirma henter selv abonnement og add-ons med samme noegle.
  const frisbiiHent = lavFrisbiiGet(PRIVATE_KEY);
  // T7b: puljealarmer og "dit nummer er klar" (frisbii-nummer.js).
  const alarmDeps = { alarm: sendAdminAlert, log: console };
  const nummerDeps = {
    supabase, twilioClient, alarm: sendAdminAlert, log: console,
    sendNummerKlar: sendNummerKlarMail, loginUrl: `${process.env.BASE_URL}/dashboard`,
  };

  // ─── Signatur: HMAC-SHA256(secret, timestamp + id), hex ─────────────────────
  // Daekker KUN timestamp+id -> ingen raa body noedvendig (modsat Shopify).
  // NB: signaturen beviser AT webhooket stammer fra Frisbii og at id/timestamp
  // ikke er aendret. Den beviser IKKE at webhooket ikke er en gentagelse/replay
  // af et tidligere, helt legitimt webhook — det haandteres separat nedenfor.
  function verifySignature(body) {
    if (!body || !body.timestamp || !body.id || !body.signature) return false;
    if (typeof body.signature !== "string") return false;
    const expected = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(body.timestamp + body.id)
      .digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(body.signature, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // ─── Replay-beskyttelse + dead-letter: har vi set OG behandlet id'et foer? ──
  // Frisbii dokumenterer selv at id+timestamp er det eneste signaturen daekker,
  // og anbefaler at modtageren gemmer id og ignorerer gensete id'er.
  //
  // Skelner nu (jf. migration webhook_events_processed) mellem:
  //   "new"        -> aldrig set: behandl
  //   "unprocessed"-> set foer, men processed_at er NULL: et tidligere forsoeg
  //                   fejlede efter claim (fx Frisbii-API nede). Frisbiis retry
  //                   er vores anden chance — BEHANDL IGEN. Downstream er
  //                   idempotent (provisionFirm tjekker frisbii_subscription;
  //                   setBillingStatus har timestamp-guard), saa genkoersel er ufarlig.
  //   "processed"  -> set og faerdigbehandlet: ignorer.
  async function claimWebhookEvent(body) {
    const { error } = await supabase
      .from("frisbii_webhook_events")
      .insert({ id: body.id, event_id: body.event_id, event_type: body.event_type });

    if (!error) return "new"; // nyt id, frit foer

    // Unique violation (Postgres-kode 23505) = vi har set dette id foer.
    // Men blev det ogsaa FAERDIGBEHANDLET? (dead-letter-tjekket)
    if (error.code === "23505") {
      const { data: seen, error: lookupErr } = await supabase
        .from("frisbii_webhook_events")
        .select("processed_at")
        .eq("id", body.id)
        .maybeSingle();

      if (lookupErr) {
        // Kan ikke afgoere status — vaelg genbehandling frem for tab (idempotent downstream).
        console.error("⚠️  Kunne ikke slaa webhook-status op (genbehandler for en sikkerheds skyld):", lookupErr);
        return "unprocessed";
      }
      if (seen && !seen.processed_at) {
        console.warn("🔁 Frisbii webhook set foer men ALDRIG faerdigbehandlet — genbehandler:", body.id);
        return "unprocessed";
      }
      console.log("ℹ️  Frisbii webhook allerede behandlet, ignorerer:", body.id);
      return "processed";
    }

    // Anden DB-fejl (forbindelse osv.) — vi kan ikke garantere idempotens lige
    // nu. Vi vælger at behandle webhooket alligevel (frem for at tabe det),
    // fordi downstream i sig selv er idempotent (se ovenfor).
    console.error("⚠️  Kunne ikke registrere webhook-id (fortsætter alligevel):", error);
    return "new";
  }

  // ─── Bogfoer udfaldet af behandlingen ────────────────────────────────────────
  // processed_at saettes KUN ved succes. Ved fejl gemmes aarsagen i error og
  // processed_at forbliver NULL. Tabellen ER dermed vores dead-letter-liste:
  //   select * from frisbii_webhook_events where processed_at is null;
  // MAALT 29/10-26 (D92): Frisbii proever IKKE selv igen. Vi svarer 200 foer
  // behandlingen, og Frisbii bogfoerer eventet som COMPLETED efter 1 forsoeg.
  // En raekke her bliver kun behandlet igen, naar et menneske gensender eventet
  // i Frisbii (Webhooks) - saa giver claim "unprocessed" - eller koerer
  // gensynk-firma.js. Den planlagte genbehandling er D92 del 3b.
  async function markProcessed(webhookId) {
    const { error } = await supabase
      .from("frisbii_webhook_events")
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq("id", webhookId);
    if (error) console.error("⚠️  Kunne ikke markere webhook som behandlet:", webhookId, error);
  }

  async function markFailed(webhookId, message) {
    const { error } = await supabase
      .from("frisbii_webhook_events")
      .update({ error: String(message).slice(0, 2000) })
      .eq("id", webhookId);
    if (error) console.error("⚠️  Kunne ikke gemme webhook-fejl:", webhookId, error);
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

  // ─── Er abonnementet i (eller paa vej ind i) en trial-periode? ──────────────
  // Frisbii/Reepay-subscription-objektet har felterne til det: in_trial er
  // sandt i selve trial-perioden; er abonnementet endnu ikke startet, siger
  // trial_start/trial_end om det FAAR en trial-periode.
  // FAIL-CLOSED: kan sporgsmaalet ikke besvares (manglende felter), svares
  // false — saa provisionerer subscription_created ikke, og en almindelig
  // betalt plan haandteres stadig korrekt af invoice_settled. Bemaerk at
  // fail-closed her kun gaelder FELT-laesningen; fejler selve API-KALDET
  // (frisbiiGet kaster), ryger eventet i dead-letter og genbehandles ved
  // Frisbiis retry — vi gaetter aldrig.
  function isTrialSubscription(sub) {
    if (!sub || typeof sub !== "object") return false;
    if (sub.in_trial === true) return true;
    if (sub.trial_end && new Date(sub.trial_end).getTime() > Date.now()) return true;
    return false;
  }

  // ─── Saet billing_status, men kun hvis dette webhook er NYERE end det ───────
  // sidste der opdaterede statussen. Frisbii garanterer FIFO-levering KUN hvis
  // intet fejler; en retry kan derfor ankomme efter en nyere webhook (fx en
  // forsinket "invoice_failed"-retry der dukker op efter en "invoice_settled"
  // der allerede har gjort kunden active igen). Uden dette tjek kan en gammel
  // retry skubbe en ellers sund kunde tilbage i past_due/cancelled.
  // RETURNERER true hvis opdateringen blev ANVENDT (nyere end sidste), ellers
  // false — saa kaldere kan gate sideeffekter (fx deprovisionering) paa guarden.
  async function setBillingStatus(subscriptionHandle, status, webhookTimestamp) {
    const { data: firm, error: findErr } = await supabase
      .from("firms")
      .select("id, billing_status, billing_status_updated_at")
      .eq("frisbii_subscription", subscriptionHandle)
      .maybeSingle();

    if (findErr) {
      console.error("❌ Kunne ikke slå firma op for billing-opdatering:", findErr);
      return false;
    }
    if (!firm) {
      // Sker for et abonnement der endnu ikke er provisioneret (race med
      // invoice_settled), eller for testdata uden tilhørende firma.
      console.warn("⚠️  Intet firma for frisbii_subscription:", subscriptionHandle, "— ignorerer", status);
      return false;
    }

    if (firm.billing_status_updated_at && webhookTimestamp <= firm.billing_status_updated_at) {
      console.log(
        `ℹ️  Ignorerer aeldre/lige-gammel billing-webhook for firma ${firm.id} ` +
        `(${status} @ ${webhookTimestamp} <= sidst anvendt ${firm.billing_status_updated_at})`
      );
      return false;
    }

    const { error: updateErr } = await supabase
      .from("firms")
      .update({ billing_status: status, billing_status_updated_at: webhookTimestamp })
      .eq("id", firm.id);
    if (updateErr) {
      console.error("❌ billing_status-opdatering fejlede:", updateErr);
      return false;
    }
    console.log(`✅ billing_status -> ${status} for firma ${firm.id} (${subscriptionHandle})`);
    return true;
  }

  // ─── Deprovisionering: her lukkes udgiftsdriveren ────────────────────────────
  // Kaldes ved subscription_expired (og expired_dunning): kunden har ikke
  // laengere et betalt abonnement. Firmaet saettes inaktivt (rutning stopper),
  // og nummeret frigives med frigivNummer (telefon-nummer.js, T7a):
  //   - nummeret har ALDRIG vaeret verificeret: frigives STRAKS (ingen karantaene)
  //   - nummeret HAR vaeret verificeret:        KARANTAENE i QUARANTINE_DAYS_PAID (default 30)
  //     — det har vaeret kundens (det staar paa bilen!), uanset prisen (D95, Ann 30/10).
  //     Foer afgjordes det af betalingshistorikken, og en 0-kr.-pris taltes som "proeve".
  // last_firm_id gemmes, saa win-back kan genforene kunde og nummer med ét opslag.
  // Pool-udvaelgelsen springer karantaene-numre over, til perioden er udloebet.
  // Idempotent: koeres den to gange, goer anden koersel intet.
  // VIGTIGT: rydder BEGGE nummer-registreringer — pool-raekkens firm_id OG
  // firms.phone_number (ellers ville et genbrugt nummer pege paa to firmaer,
  // og rutnings-opslaget i /opkald ville knaekke paa .single()).
  // Twilio-nummeret beholdes i (sub)kontoen — kun den interne tildeling ryddes.
  async function deprovisionFirm(subscriptionHandle) {
    const { data: firm, error: findErr } = await supabase
      .from("firms")
      .select("id, name, phone_number, status")
      .eq("frisbii_subscription", subscriptionHandle)
      .maybeSingle();

    if (findErr) {
      console.error("❌ Deprovisionering: kunne ikke slaa firma op:", findErr);
      throw findErr; // -> markFailed: dead-letter (Frisbii gensender ikke selv, D92)
    }
    if (!firm) {
      console.warn("⚠️  Deprovisionering: intet firma for", subscriptionHandle, "— ignorerer");
      return;
    }
    if (firm.status === "inactive" && !firm.phone_number) {
      console.log("ℹ️  Firma allerede deprovisioneret:", firm.id);
      return;
    }

    // 1) Frigiv nummeret (begge registreringer) — karantaene, hvis det har
    //    vaeret verificeret. last_firm_id gemmes i begge tilfaelde.
    let frigivet;
    try {
      frigivet = await frigivNummer({ supabase, firmId: firm.id });
    } catch (poolErr) {
      console.error("❌ Deprovisionering: kunne ikke frigive nummer:", poolErr.message);
      throw poolErr;
    }

    // 2) Saet inaktiv (rutning stopper). phone_number er ryddet af frigivNummer.
    const { error: firmErr } = await supabase
      .from("firms")
      .update({ status: "inactive", phone_number: null })
      .eq("id", firm.id);
    if (firmErr) {
      console.error("❌ Deprovisionering: kunne ikke saette firma inaktivt:", firmErr);
      throw firmErr;
    }

    console.log(
      frigivet.karantaeneTil
        ? `🔻 DEPROVISIONERET: firma ${firm.id} (${firm.name}) — nummer ${frigivet.nummer} i karantaene til ${frigivet.karantaeneTil} (nummeret har vaeret verificeret)`
        : `🔻 DEPROVISIONERET: firma ${firm.id} (${firm.name}) — nummer ${frigivet.nummer || "(intet)"} frigivet STRAKS (aldrig verificeret, ingen karantaene)`
    );
  }

  // ─── Provisionering (spejler Shopify-flowet i onboarding.js) ────────────────
  async function provisionFirm({ customer, subscription }) {
    const subHandle = subscription.handle;
    const email     = customer.email?.toLowerCase().trim();
    const firstName = customer.first_name || "";
    const lastName  = customer.last_name  || "";
    // ⚠️ D33: `company` er IKKE obligatorisk paa Frisbiis hostede
    // betalingsside — og det er den side, kunderne faktisk gaar igennem
    // (bekraeftet 6/9-26). Valideringen i /checkout/start naas derfor aldrig
    // af en rigtig kunde. Fallbacken nedenfor er altsaa ikke et kanttilfaelde,
    // men en vej, der ligger aaben hver dag.
    //
    // Naar den bruges, kommer firmaet til at hedde PERSONEN. Og navnet er ikke
    // bare en kolonne: det bliver firms.name, sluggen i SMS-linket,
    // velkomstmailen og greeting_text — som praerenderes til lyd. Haandvaerkerens
    // telefonsvarer siger da hans eget navn i stedet for firmaets.
    const firmanavnMangler = !(customer.company || "").trim();
    const company   = customer.company || `${firstName} ${lastName}`.trim() || email;

    // ─── Haandvaerkerens EGET mobilnummer (ikke DDK-nummeret) ────────────────
    // Frisbii har det allerede: `/checkout/start` sender det med som
    // `create_customer.phone`. Indtil nu blev det liggende hos dem, og
    // `firms.owner_phone` stod tom for HVER ENESTE Frisbii-kunde. Konsekvensen
    // sad i onboardingens side 1, som vaelger variant paa `if (state.ownerPhone)`:
    // bekraeftelses-varianten ("Er det dit nummer?") kunne aldrig vises, saa
    // alle blev bedt om at taste et nummer, vi havde i forvejen. Varianten var
    // reelt doed kode og er kun set med `provision-test-firm.js --phone`.
    // Fundet 5/9-26.
    //
    // E.164 via normalizePhone, saa feltet er aebler-mod-aebler med den
    // From-sammenligning, /opkald laver ved verifikationen. Er nummeret tomt
    // eller ikke et dansk mobilnummer, saettes det IKKE — saa spoerger
    // onboardingen, praecis som foer.
    const ownerPhone = danskMobil(normalizePhone(customer.phone));

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

    // Find ledigt nummer i puljen — KARANTAENE springes over (reserveret til
    // evt. vundet-tilbage kunder), og nummeret verificeres hos Twilio, foer det
    // gives til en kunde. Se begrundelsen i phone.js: puljen kan indeholde
    // "spoegelser" — raekker for numre, der er frigivet hos Twilio uden at
    // raekken blev slettet. Et spoegelse er et doedt nummer for kunden.
    // Kan Twilio ikke naas, kaster vaelgLedigtNummer -> dead-letter -> retry.
    // Vi gaetter aldrig paa, om et nummer findes.
    // T7b: med FASE3_SYNK oprettes firmaet FOERST, uden nummer, og nummeret
    // tildeles bagefter - kun hvis Telefonpasser er koebt (D25). Slukket flag:
    // praecis som foer (nummer foerst, tom pulje = intet firma).
    let phoneRow = null, spoegelser = [], ledigeVerificeret = 0;
    if (!FASE3_SYNK) {
      ({ valgt: phoneRow, spoegelser, ledigeVerificeret } = await vaelgLedigtNummer({ supabase, twilioClient }));

      // Spoegelser slettes IKKE herfra — oprydning i prod sker med aabne oejne.
      // Men de skal ses: uden alarm er det naeste kunde, der opdager dem.
      await alarmSpoegelser(alarmDeps, spoegelser);

      if (!phoneRow) {
        console.error("❌ Ingen ledige numre i puljen!");
        // Kritisk: en betalende kunde kunne ikke faa et nummer.
        await sendAdminAlert({
          subject: "KRITISK: nummerpuljen er TOM",
          text:
            `En betalende kunde kunne IKKE tildeles et nummer, fordi puljen er tom.\n\n` +
            `Kunde: ${company} <${email}>\n` +
            `Frisbii-abonnement: ${subHandle}\n` +
            (spoegelser.length ? `Bemaerk: ${spoegelser.length} raekke(r) i puljen er spoegelser og taeller ikke med.\n` : ``) +
            `\nFirmaet er IKKE oprettet. Laeg ledige numre i phone_numbers og opret kunden manuelt.`,
        }).catch((e) => console.error("⚠️  Kunne ikke sende alarm:", e.message));
        throw new Error("Ingen ledige numre");
      }
    }

    // Generér en unik slug til den maskerede formular-URL
    // (opgave.ditdigitalekontor.dk/{slug}/{token}). Skal sættes ved oprettelse, ellers
    // bliver SMS-linket til nye firmaer …/null/{token}.
    const slug = await uniqueSlug(supabase, company);

    // Opret firma (samme felter som Shopify-flow)
    const { data: firm, error: firmErr } = await supabase
      .from("firms")
      .insert({
        name:                       company,
        // Var der intet firmanavn hos Frisbii, er `company` et gaet (personens
        // navn eller e-mailen). Flaget lader onboardingen vise et TOMT felt i
        // stedet for at foreslaa et navn, ingen har skrevet. (9/9-26.)
        navn_er_gaettet:            firmanavnMangler,
        slug,
        email,
        owner_phone:                ownerPhone,   // null = onboardingen spoerger, som foer
        phone_number:               phoneRow ? phoneRow.number : null, // T7b: null med FASE3_SYNK
        frisbii_subscription:       subHandle,
        frisbii_customer:           customer.handle,
        status:                     "onboarding", // onboarding-tilstand: → "active" efter verifikation
        billing_status:             "active",     // abonnementstilstand (adskilt fra onboarding)
        billing_status_updated_at:  new Date().toISOString(),
        voice_gender:               "female",
        greeting_text:              `Hej, du har ringet til ${company}. Jeg har ikke mulighed for at tage telefonen lige nu, men jeg sender dig en SMS, så du kan beskrive din opgave. Jeg vender tilbage hurtigst muligt.`,
        verification_status:        "pending",
      })
      .select()
      .single();
    if (firmErr) {
      // Race-vaernet: to samtidige events for SAMME abonnement (fx
      // subscription_created + invoice_settled ved en trial-plan med
      // oprettelsesgebyr) kan begge naa forbi idempotens-tjekket oeverst,
      // foer nogen af dem har indsat firmaet. Den medfoedte unique-constraint
      // firms_frisbii_subscription_key koarer da vinderen; taberen lander her
      // med 23505. Det er IKKE en fejl: firmaet ER provisioneret (af den anden
      // handler), saa eventet behandles som no-op og markeres processed —
      // i stedet for at gaa i dead-letter og vente unoedigt paa en retry.
      // Regex-gaten sikrer at KUN frisbii_subscription-vaernet behandles
      // saadan; en 23505 fra en anden constraint (fx et fremtidigt unique paa
      // phone_number) skal stadig i dead-letter og undersoeges.
      if (firmErr.code === "23505" && /frisbii_subscription/i.test(firmErr.message || "")) {
        console.log("ℹ️  Race tabt — abonnementet blev netop provisioneret af et parallelt event:", subHandle);
        return;
      }
      console.error("❌ Firma-oprettelse fejlede:", firmErr);
      throw firmErr;
    }

    let nummer = phoneRow ? phoneRow.number : null;
    let moduler = ["telefon"];
    let udenNummer = null; // T7b: "A" (Telefonpasser ikke koebt) | "B" (koebt, puljen tom)
    let tjekPulje = !FASE3_SYNK; // lav-pulje-alarm kun, naar et nummer netop blev taget
    if (!FASE3_SYNK) {
      // Knyt nummeret til firmaet
      await supabase
        .from("phone_numbers")
        .update({ firm_id: firm.id })
        .eq("id", phoneRow.id);

      // T7a: telefon-raekken i firma_moduler, som triggeren firma_faar_telefon
      // gav foer (triggeren er fjernet i migrationen t7a).
      await sikrTelefonModul(supabase, firm.id);
    } else {
      // T7b: Frisbii afgoer modulerne (synk), og nummeret foelger dem.
      const r = await synkFirma({ supabase, hent: frisbiiHent, abonnement: subHandle, skriv: true });
      if (r.status === "skrevet") {
        moduler = r.saet.moduler;
        const n = await nummerEfterSynk({ supabase, twilioClient, firmId: firm.id, saet: r.saet });
        if (n.status === "tildelt") {
          nummer = n.nummer;
          tjekPulje = true;
          ledigeVerificeret = (n.ledigeVerificeret ?? 0) + 1; // lav-pulje-tjekket nedenfor traekker 1 fra
          await alarmSpoegelser(alarmDeps, n.spoegelser);
        } else if (n.status === "har") {
          nummer = n.nummer;
        } else if (n.status === "tom") {
          // Alarmen ("venter paa nummer") og spoegelserne meldes af efterEvent,
          // som koerer lige efter denne case - ellers kom de to gange.
          udenNummer = "B";
        } else {
          udenNummer = moduler.includes("telefon") ? "B" : "A";
        }
      } else {
        // "ukendt" produkt: synk skrev intet. Firmaet oprettes alligevel (ellers
        // ville en gensendelse sige "allerede behandlet" og kunden faa intet
        // login). efterEvent kaster bagefter -> dead-letter + alarm.
        moduler = [];
        udenNummer = "A";
        console.warn(`⚠️  Firma ${firm.id} oprettet UDEN moduler: synk sagde "${r.status}" (${subHandle})`);
      }
    }

    // ─── D33: firmanavnet manglede — sig det, i stedet for at substituere tavst ──
    // Alarmen forhindrer ikke den forkerte provisionering; den goer den SYNLIG.
    // Det afgoerende er vinduet: greeting_text saettes her, men lyden renderes
    // foerst, naar kunden gemmer sin besked i onboardingen (side 3). Naar
    // alarmen frem inden da, koster rettelsen ingenting. Opdages det bagefter,
    // kraever den en ny TTS-rendering.
    //
    // Fejler mailen, maa det aldrig vaelte en provisionering, der ellers
    // lykkedes — derfor .catch(), som ved de oevrige alarmer.
    if (firmanavnMangler) {
      console.warn("⚠️  Firmanavn manglede ved tilmelding — firma opkaldt efter personen:", firm.id, company);
      await sendAdminAlert({
        subject: `Firmanavn mangler — firma ${firm.id} hedder nu "${company}"`,
        text:
          `En kunde er tilmeldt UDEN firmanavn. Feltet er ikke obligatorisk paa\n` +
          `Frisbiis hostede betalingsside, og den gaar uden om /checkout/start.\n\n` +
          `Firma-id:   ${firm.id}\n` +
          `Navn nu:    ${company}   <-- personens navn, ikke firmaets\n` +
          `Slug:       ${slug}\n` +
          `E-mail:     ${maskerMail(email)}\n` +
          `Frisbii:    ${customer.handle} / ${subHandle}\n\n` +
          `HVAD DER ER FORKERT NU:\n` +
          `  firms.name, sluggen i SMS-linket, velkomstmailen (allerede sendt)\n` +
          `  og greeting_text — den tekst, telefonsvareren laeser op.\n\n` +
          `TIDSVINDUE — vigtigt:\n` +
          `  Lyden er IKKE renderet endnu. Den renderes foerst, naar kunden\n` +
          `  gemmer sin besked paa side 3 i onboardingen. Retter du navnet og\n` +
          `  greeting_text inden da, koster det ingenting. Bagefter kraever det\n` +
          `  en ny TTS-rendering.\n\n` +
          `SLUGGEN kan ogsaa aendres nu — der er endnu ikke sendt en eneste SMS\n` +
          `med linket. Senere ville det braekke links, der allerede er ude.\n\n` +
          `Se D33 i risikoregistret.`,
      }).catch((e) => console.error("⚠️  Kunne ikke sende alarm om manglende firmanavn:", e.message));
    }

    // Advar hvis puljen er ved at loebe toer. Tallet er VERIFICEREDE ledige
    // numre — karantaene-numre og spoegelser taeller ikke med (se 4/9-26).
    // (-1 fordi det netop tildelte nummer ikke er ledigt mere.) Kun naar et
    // nummer faktisk blev tildelt (T7b: ikke ved "uden nummer").
    if (tjekPulje) await alarmLavPulje(alarmDeps, Math.max(0, ledigeVerificeret - 1));

    // Opret Supabase Auth-bruger
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { firm_id: firm.id, firm_name: company },
    });
    if (authErr) {
      if (authErr.code === "email_exists" || /already.*regist/i.test(authErr.message)) {
        console.log("ℹ️  Auth-bruger findes allerede for", maskerMail(email), "— fortsaetter (magic link virker stadig)");
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

    // Generer prefetch-sikkert login-link via token_hash (IKKE action_link).
    // action_link peger paa Supabases /verify-endpoint, som forbruger tokenet
    // ved ethvert GET — mail-scannere braender det dermed foer kunden naar frem.
    // Med token_hash sker verifikationen foerst naar browseren kalder verifyOtp
    // paa /onboarding, saa et scanner-GET ikke kan oedelaegge linket.
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type:    "magiclink",
      email,
      options: { redirectTo: `${process.env.BASE_URL}/onboarding` },
    });
    const tokenHash = linkData?.properties?.hashed_token;
    const loginUrl = tokenHash
      ? `${process.env.BASE_URL}/onboarding?token_hash=${encodeURIComponent(tokenHash)}&type=email`
      : `${process.env.BASE_URL}/dashboard`;

    // Send velkomstmail (delt funktion fra mail.js)
    try {
      // T7b: uden nummer -> variant A (Telefonpasser ikke koebt) eller B (nummeret er paa vej).
      const mailResult = nummer
        ? await sendWelcomeMail({ to: email, firmName: company, loginUrl, phoneNumber: nummer })
        : await sendVelkomstUdenNummerMail({ to: email, firmName: company, loginUrl, moduler, variant: udenNummer || "A" });
      if (mailResult?.blocked) {
        console.log("📧 Velkomstmail BLOKERET af staging-gaten (ikke sendt):", maskerMail(email));
      } else {
        console.log("✉️  Velkomstmail sendt til:", maskerMail(email));
      }
    } catch (mailErr) {
      console.error("❌ Mail fejlede:", mailErr);
      // Firma er oprettet — mail kan sendes igen manuelt
    }

    console.log("✅ Firma oprettet (Frisbii):", firm.id, "—", company, "→", nummer ? maskerTlf(nummer) : `(uden nummer, variant ${udenNummer || "A"})`);
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

    // Replay/dublet-tjek FOER vi svarer. Dette er stadig hurtigt (ét insert),
    // og er den officielt anbefalede idempotens-mekanisme — se kommentar ved
    // claimWebhookEvent(). Et duplikeret webhook faar stadig 200 (Frisbii skal
    // ikke se det som en fejl og begynde at retry'e), men udløser kun
    // sideeffekter, hvis det foerste forsoeg aldrig kom i maal ("unprocessed").
    const claim = await claimWebhookEvent(body);

    // Kvittér STRAKS med 200, FØR vi provisionerer. Saa kan en fejl i oprettelsen
    // (tom nummerpulje, mail-fejl, dublet-email osv.) aldrig faa Frisbii til at
    // disable webhooket. Provisioneringen koerer bagefter; fejl logges blot —
    // OG bogfoeres i frisbii_webhook_events (processed_at/error), saa et fejlet
    // event kan genbehandles ved en gensendelse fra Frisbii i stedet for at gaa
    // tabt. Frisbii gensender IKKE af sig selv (maalt 29/10-26, D92).
    res.status(200).send("ok");

    if (claim === "processed") return; // faerdigbehandlet tidligere — intet mere at goere

    try {
      switch (body.event_type) {
        case "invoice_settled": {
          // Webhooket baerer ikke dataen — hent fuld state via API'et.
          const [customer, subscription] = await Promise.all([
            frisbiiGet(`/customer/${body.customer}`),
            frisbiiGet(`/subscription/${body.subscription}`),
          ]);
          await provisionFirm({ customer, subscription });
          // En settled invoice betyder ogsaa at abonnementet er (tilbage i)
          // god stand — vigtigt efter en tidligere invoice_failed/dunning.
          await setBillingStatus(body.subscription, "active", body.timestamp);
          break;
        }

        case "subscription_created": {
          // TRIAL-STARTSKUDDET: en 0-kr-trial udloeser aldrig invoice_settled,
          // saa uden denne gren provisioneres trial-kunder ALDRIG (intet firma,
          // intet nummer, ingen velkomstmail — kun tavshed efter Frisbiis egen
          // kvittering). Afklaret ved eksperiment i staging 8/7-26.
          //
          // Korrekthedsregel 2: webhooket baerer ingen tilstand — om planen har
          // trial afgoeres via API'et, aldrig via antagelser om plan-handles.
          const subscription = await frisbiiGet(`/subscription/${body.subscription}`);

          if (!isTrialSubscription(subscription)) {
            // Almindelig betalt plan: invoice_settled ejer provisioneringen,
            // praecis som i dag. Dette event er blot stoej og markeres
            // processed nedenfor — den testede betalings-sti roeres ikke.
            console.log("ℹ️  subscription_created uden trial — invoice_settled provisionerer:", body.subscription);
            break;
          }

          console.log("🎁 Trial-abonnement oprettet — provisionerer:", body.subscription);
          const customer = await frisbiiGet(`/customer/${body.customer}`);
          await provisionFirm({ customer, subscription });
          // Bevidst INGEN setBillingStatus her: provisionFirm saetter selv
          // billing_status "active" ved oprettelsen, og subscription_created
          // signalerer aldrig "tilbage i god stand" (modsat invoice_settled).
          // Ved trialens udloeb ankommer invoice_settled saa: provisionFirms
          // idempotens-tjek goer provisioneringen til en no-op, og settled-
          // casens setBillingStatus bekraefter blot active. Betaler kunden
          // ALDRIG, koerer dunning -> expired -> deprovisionering, hvor
          // nummeret frigives straks, medmindre det naaede at blive verificeret (T7a, D95).
          break;
        }

        case "invoice_failed":
          await setBillingStatus(body.subscription, "past_due", body.timestamp);
          break;

        case "invoice_reactivate":
          // En tidligere failed/cancelled faktura er sat tilbage til pending.
          // Ikke noedvendigvis betalt endnu, men ikke laengere i en fejltilstand.
          await setBillingStatus(body.subscription, "active", body.timestamp);
          break;

        case "subscription_cancelled":
          // OPSIGELSE ≠ UDLØB (korrekthedsregel 1): kunden har betalt til
          // periodeslut — service FORTSAETTER, nummeret beholdes. Statussen er
          // et retention-signal (kontakt kunden!). Deprovisionering sker foerst
          // ved subscription_expired.
          await setBillingStatus(body.subscription, "cancelled", body.timestamp);
          break;

        case "subscription_uncancelled":
          // Kunden (eller admin) har fortrudt opsigelsen foer periodeslut.
          // NB: en cancel-retry kan ankomme EFTER uncancel — timestamp-guarden
          // i setBillingStatus haandterer raekkefoelgen.
          await setBillingStatus(body.subscription, "active", body.timestamp);
          break;

        case "subscription_expired": {
          // UDLØB: abonnementet er reelt slut (periodeslut efter opsigelse,
          // eller udloeb af anden aarsag). Her lukkes udgiftsdriveren.
          // Deprovisionering gates paa guarden: en gammel expired-retry, der
          // ankommer efter fx en genoptegning, maa ikke rive firmaet ned.
          const applied = await setBillingStatus(body.subscription, "expired", body.timestamp);
          if (applied) await deprovisionFirm(body.subscription);
          break;
        }

        case "subscription_on_hold_dunning":
          // Hele abonnementet er sat PAA HOLD pga. mislykket dunning — endnu
          // ikke udloebet. Kunden kan stadig redde det (ny betalingsmetode).
          await setBillingStatus(body.subscription, "past_due", body.timestamp);
          break;

        case "subscription_expired_dunning": {
          // Dunning-processen er opgivet -> abonnementet ER udloebet.
          // Samme slutstatus og deprovisionering som subscription_expired.
          const applied = await setBillingStatus(body.subscription, "expired", body.timestamp);
          if (applied) await deprovisionFirm(body.subscription);
          break;
        }

        case "subscription_reactivated":
          // Et tidligere "on hold"-abonnement er saet aktivt igen (admin eller
          // kunden har rettet betalingsmetoden).
          await setBillingStatus(body.subscription, "active", body.timestamp);
          break;

        case "invoice_refund": {
          // REFUNDERING (korrekthedsregel: bogfoer/flag — ingen automatik).
          // En refund kan betyde mange ting (fejlopkraevning, kulance, tvist),
          // saa systemet skal IKKE selv aendre kundens status eller deprovisionere
          // — det er en MENNESKE-beslutning. Vi goer to ting:
          //  1) Henter fakturaen og logger beloeb + kunde synligt.
          //  2) Alarmerer admin via mail (sendAdminAlert), saa sagen vurderes.
          // Frisbii er selv kilden til refund-historikken; vi behoever ikke
          // duplikere den i egne kolonner.
          let detaljer = `Faktura: ${body.invoice}, abonnement: ${body.subscription || "?"}`;
          try {
            const invoice = await frisbiiGet(`/invoice/${body.invoice}`);
            const beloeb = ((invoice.refunded_amount ?? invoice.amount ?? 0) / 100).toFixed(2);
            detaljer = `Faktura ${body.invoice}: ${beloeb} ${invoice.currency || "DKK"} refunderet` +
                       ` — kunde ${invoice.customer || body.customer || "?"}, abonnement ${body.subscription || "?"}`;
          } catch (err) {
            console.warn("⚠️  Kunne ikke hente refund-detaljer (alarmerer med det vi har):", err.message);
          }
          console.warn(`💸 REFUND registreret: ${detaljer}`);
          await sendAdminAlert({
            subject: "Refundering registreret — kraever vurdering",
            text:
              `Frisbii har registreret en refundering:\n\n${detaljer}\n\n` +
              `Systemet har IKKE aendret kundens status eller nummer — vurder sagen manuelt:\n` +
              `- Fejlopkraevning/kulance: formentlig ingen handling.\n` +
              `- Reel fortrydelse/tvist: overvej opsigelse i Frisbii (expired-flowet deprovisionerer saa selv).`,
          });
          break;
        }

        default:
          break; // oevrige events: ingen egen case. Med FASE3_SYNK logges og synkes de nedenfor (D92)
      }

      // Fase 3, T6: Frisbii -> firma_moduler. Slukket flag = returnerer straks.
      // Kaster ved ukendt produkt eller fejl -> catch -> dead-letter + alarm.
      await efterEvent({
        body,
        aktiv: FASE3_SYNK,
        synk: (abonnement) => synkFirma({ supabase, hent: frisbiiHent, abonnement, skriv: true }),
        alarm: sendAdminAlert,
        log: console,
        // T7b: nummeret foelger modulerne (tildel ved tilkoeb, frigiv ved fravalg).
        efterSkrevet: (r) => nummerOgBesked(nummerDeps, r),
      });

      // Alt gik godt (eller eventet var bevidst ignoreret): bogfoer succes,
      // saa fremtidige dubletter/retries afvises som "processed".
      await markProcessed(body.id);
    } catch (err) {
      // Svaret er allerede sendt (200) — vi logger og bogfoerer fejlen.
      // processed_at forbliver NULL -> dead-letter. Frisbii gensender IKKE af sig
      // selv (maalt 29/10-26): gensend i Frisbii eller koer gensynk-firma.js.
      console.error("❌ Frisbii efterbehandling fejlede (staar i dead-letter - Frisbii gensender IKKE selv):", err);
      await markFailed(body.id, err.message || err);
      // T6 (D92): med FASE3_SYNK giver et fejlet event alarm. Slukket = som foer.
      await alarmVedFejl({ body, fejl: err, aktiv: FASE3_SYNK, alarm: sendAdminAlert, log: console });
    }
  });

  console.log("📡 Frisbii webhook registreret paa /webhook/frisbii");
};
