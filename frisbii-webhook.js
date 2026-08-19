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
const { sendWelcomeMail, sendAdminAlert } = require("./mail");
const { uniqueSlug } = require("./slug");
const { maskerTlf, maskerMail } = require("./phone");

const FRISBII_API = "https://api.frisbii.com/v1";

module.exports = (app, supabase) => {
  const PRIVATE_KEY    = process.env.FRISBII_PRIVATE_KEY;    // privat API-noegle
  const WEBHOOK_SECRET = process.env.FRISBII_WEBHOOK_SECRET; // secret fra webhook-indstillingerne

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
  // processed_at forbliver NULL — saa Frisbiis naeste retry faar "unprocessed"
  // og proever igen. Tabellen ER dermed vores dead-letter-liste:
  //   select * from frisbii_webhook_events where processed_at is null;
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
  // Frisbii/Reepay-subscription-objektet har felterne til det: is_in_trial er
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
    if (sub.is_in_trial === true) return true;
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

  // ─── Har abonnementet nogensinde haft en betalt faktura? ────────────────────
  // Afgoer karantaeneperioden ved deprovisionering: proevekunder (aldrig betalt)
  // faar kort karantaene, betalende kunder lang. Kilden er Frisbii (fakturaerne
  // lyver ikke). FAIL-SAFE: kan sporgsmaalet ikke besvares (API-fejl, ukendt
  // svarformat), antages BETALT -> lang karantaene. Hellere gemme et nummer for
  // laenge end at genbruge en betalende kundes nummer for tidligt.
  async function hasEverPaid(subscriptionHandle) {
    try {
      const res = await frisbiiGet(
        `/list/invoice?subscription=${encodeURIComponent(subscriptionHandle)}&state=settled&size=20`
      );
      const invoices = res?.content || res || [];
      if (!Array.isArray(invoices)) throw new Error("uventet svarformat fra /list/invoice");
      return invoices.some((inv) => (inv.amount ?? 0) > 0);
    } catch (err) {
      console.warn("⚠️  Kunne ikke afgoere betalingshistorik (antager BETALT, lang karantaene):", err.message);
      return true;
    }
  }

  // ─── Deprovisionering: her lukkes udgiftsdriveren ────────────────────────────
  // Kaldes ved subscription_expired (og expired_dunning): kunden har ikke
  // laengere et betalt abonnement. Firmaet saettes inaktivt (rutning stopper),
  // og nummeret haandteres efter betalingshistorik:
  //   - proevekunde (aldrig betalt):  frigives STRAKS til puljen (ingen karantaene)
  //   - betalende kunde:              KARANTAENE i QUARANTINE_DAYS_PAID (default 30)
  //     — en vundet-tilbage kunde skal kunne faa SIT nummer igen (det staar paa bilen!)
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
      throw findErr; // -> markFailed: genbehandles ved naeste retry
    }
    if (!firm) {
      console.warn("⚠️  Deprovisionering: intet firma for", subscriptionHandle, "— ignorerer");
      return;
    }
    if (firm.status === "inactive" && !firm.phone_number) {
      console.log("ℹ️  Firma allerede deprovisioneret:", firm.id);
      return;
    }

    // Karantaeneperiode efter betalingshistorik:
    //   - proevekunde (aldrig betalt en krone): INGEN karantaene — nummeret
    //     frigives straks (svag binding: nummeret naaede naeppe bilen paa en proeve)
    //   - betalende kunde: QUARANTINE_DAYS_PAID (default 30) — win-back-vindue
    const paid = await hasEverPaid(subscriptionHandle);
    const days = paid ? (Number(process.env.QUARANTINE_DAYS_PAID) || 30) : 0;
    const quarantinedUntil = days > 0
      ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
      : null;

    // 1) Frigiv nummeret — med karantaene hvis kunden var betalende.
    //    last_firm_id gemmes i BEGGE tilfaelde (billigt historisk spor).
    const { error: poolErr } = await supabase
      .from("phone_numbers")
      .update({ firm_id: null, quarantined_until: quarantinedUntil, last_firm_id: firm.id })
      .eq("firm_id", firm.id);
    if (poolErr) {
      console.error("❌ Deprovisionering: kunne ikke frigive nummer:", poolErr);
      throw poolErr;
    }

    // 2) Ryd firmaets nummer-kolonne + saet inaktiv (rutning stopper)
    const { error: firmErr } = await supabase
      .from("firms")
      .update({ status: "inactive", phone_number: null })
      .eq("id", firm.id);
    if (firmErr) {
      console.error("❌ Deprovisionering: kunne ikke saette firma inaktivt:", firmErr);
      throw firmErr;
    }

    console.log(
      paid
        ? `🔻 DEPROVISIONERET: firma ${firm.id} (${firm.name}) — nummer ${firm.phone_number} i karantaene til ${quarantinedUntil} (betalt kunde: ${days} dage)`
        : `🔻 DEPROVISIONERET: firma ${firm.id} (${firm.name}) — nummer ${firm.phone_number} frigivet STRAKS (proevekunde, ingen karantaene)`
    );
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

    // Find ledigt nummer i puljen (firm_id IS NULL) — og spring numre i
    // KARANTAENE over (reserveret til evt. vundet-tilbage kunder).
    const nowIso = new Date().toISOString();
    const { data: phoneRow, error: phoneErr } = await supabase
      .from("phone_numbers")
      .select("id, number")
      .is("firm_id", null)
      .or(`quarantined_until.is.null,quarantined_until.lt.${nowIso}`)
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

    // Generér en unik slug til den maskerede formular-URL
    // (opgave.ditdigitalekontor.dk/{slug}/{token}). Skal sættes ved oprettelse, ellers
    // bliver SMS-linket til nye firmaer …/null/{token}.
    const slug = await uniqueSlug(supabase, company);

    // Opret firma (samme felter som Shopify-flow)
    const { data: firm, error: firmErr } = await supabase
      .from("firms")
      .insert({
        name:                       company,
        slug,
        email,
        phone_number:               phoneRow.number,
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

    // Knyt nummeret til firmaet
    await supabase
      .from("phone_numbers")
      .update({ firm_id: firm.id })
      .eq("id", phoneRow.id);

    // Advar hvis puljen er ved at loebe toer (taeller kun REELT ledige numre
    // — karantaene-numre er ikke tilgaengelige for nye kunder)
    const LOW_POOL = Number(process.env.LOW_POOL_THRESHOLD) || 3;
    const { count: ledige } = await supabase
      .from("phone_numbers")
      .select("*", { count: "exact", head: true })
      .is("firm_id", null)
      .or(`quarantined_until.is.null,quarantined_until.lt.${nowIso}`);
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
      const mailResult = await sendWelcomeMail({ to: email, firmName: company, loginUrl, phoneNumber: phoneRow.number });
      if (mailResult?.blocked) {
        console.log("📧 Velkomstmail BLOKERET af staging-gaten (ikke sendt):", maskerMail(email));
      } else {
        console.log("✉️  Velkomstmail sendt til:", maskerMail(email));
      }
    } catch (mailErr) {
      console.error("❌ Mail fejlede:", mailErr);
      // Firma er oprettet — mail kan sendes igen manuelt
    }

    console.log("✅ Firma oprettet (Frisbii):", firm.id, "—", company, "→", maskerTlf(phoneRow.number));
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
    // event kan genbehandles ved Frisbiis naeste retry i stedet for at gaa tabt.
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
          // hasEverPaid doemmer "proevekunde" -> nummeret frigives straks.
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
          break; // oevrige events ignoreres bevidst — men markeres behandlet nedenfor
      }

      // Alt gik godt (eller eventet var bevidst ignoreret): bogfoer succes,
      // saa fremtidige dubletter/retries afvises som "processed".
      await markProcessed(body.id);
    } catch (err) {
      // Svaret er allerede sendt (200) — vi logger og bogfoerer fejlen.
      // processed_at forbliver NULL -> Frisbiis naeste retry genbehandler.
      console.error("❌ Frisbii efterbehandling fejlede (genbehandles ved naeste retry):", err);
      await markFailed(body.id, err.message || err);
    }
  });

  console.log("📡 Frisbii webhook registreret paa /webhook/frisbii");
};
