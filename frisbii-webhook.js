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
//
// FORUDSAETNING: koer frisbii-webhook-migration.sql i Supabase foerst (tilfoejer
// tabellen frisbii_webhook_events + kolonnen firms.billing_status_updated_at).
// -----------------------------------------------------------------------------

const crypto = require("crypto");
const { sendWelcomeMail, sendAdminAlert } = require("./mail");
const { uniqueSlug } = require("./slug");

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

  // ─── Replay-beskyttelse: har vi set dette webhook-id foer? ──────────────────
  // Frisbii dokumenterer selv at id+timestamp er det eneste signaturen daekker,
  // og anbefaler at modtageren gemmer id og ignorerer gensete id'er. Det er
  // OGSAA den officielle vej til idempotens ved netvaerksfejl/dobbelt-levering.
  // Returnerer true hvis webhooket er NYT (skal behandles), false hvis det er
  // set foer (skal ignoreres).
  async function claimWebhookEvent(body) {
    const { error } = await supabase
      .from("frisbii_webhook_events")
      .insert({ id: body.id, event_id: body.event_id, event_type: body.event_type });

    if (!error) return true; // nyt id, frit foer

    // Unique violation (Postgres-kode 23505) = vi har allerede set dette id.
    if (error.code === "23505") {
      console.log("ℹ️  Frisbii webhook allerede behandlet, ignorerer:", body.id);
      return false;
    }

    // Anden DB-fejl (forbindelse osv.) — vi kan ikke garantere idempotens lige
    // nu. Vi vælger at behandle webhooket alligevel (frem for at tabe det),
    // fordi provisionFirm() i sig selv er idempotent på frisbii_subscription.
    // Billing-status-opdateringerne er rene upserts, så en dobbelt-koersel
    // her er ufarlig, kun overfloedig.
    console.error("⚠️  Kunne ikke registrere webhook-id (fortsætter alligevel):", error);
    return true;
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

  // ─── Saet billing_status, men kun hvis dette webhook er NYERE end det ───────
  // sidste der opdaterede statussen. Frisbii garanterer FIFO-levering KUN hvis
  // intet fejler; en retry kan derfor ankomme efter en nyere webhook (fx en
  // forsinket "invoice_failed"-retry der dukker op efter en "invoice_settled"
  // der allerede har gjort kunden active igen). Uden dette tjek kan en gammel
  // retry skubbe en ellers sund kunde tilbage i past_due/cancelled.
  async function setBillingStatus(subscriptionHandle, status, webhookTimestamp) {
    const { data: firm, error: findErr } = await supabase
      .from("firms")
      .select("id, billing_status, billing_status_updated_at")
      .eq("frisbii_subscription", subscriptionHandle)
      .maybeSingle();

    if (findErr) {
      console.error("❌ Kunne ikke slå firma op for billing-opdatering:", findErr);
      return;
    }
    if (!firm) {
      // Sker for et abonnement der endnu ikke er provisioneret (race med
      // invoice_settled), eller for testdata uden tilhørende firma.
      console.warn("⚠️  Intet firma for frisbii_subscription:", subscriptionHandle, "— ignorerer", status);
      return;
    }

    if (firm.billing_status_updated_at && webhookTimestamp <= firm.billing_status_updated_at) {
      console.log(
        `ℹ️  Ignorerer aeldre/lige-gammel billing-webhook for firma ${firm.id} ` +
        `(${status} @ ${webhookTimestamp} <= sidst anvendt ${firm.billing_status_updated_at})`
      );
      return;
    }

    const { error: updateErr } = await supabase
      .from("firms")
      .update({ billing_status: status, billing_status_updated_at: webhookTimestamp })
      .eq("id", firm.id);
    if (updateErr) {
      console.error("❌ billing_status-opdatering fejlede:", updateErr);
      return;
    }
    console.log(`✅ billing_status -> ${status} for firma ${firm.id} (${subscriptionHandle})`);
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

    // Generér en unik slug til den maskerede formular-URL
    // (opgave.lommekontor.dk/{slug}/{token}). Skal sættes ved oprettelse, ellers
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

    // Replay/dublet-tjek FOER vi svarer. Dette er stadig hurtigt (ét insert),
    // og er den officielt anbefalede idempotens-mekanisme — se kommentar ved
    // claimWebhookEvent(). Et duplikeret webhook faar stadig 200 (Frisbii skal
    // ikke se det som en fejl og begynde at retry'e), men udløser ingen
    // sideeffekter anden gang.
    const isNew = await claimWebhookEvent(body);

    // Kvittér STRAKS med 200, FØR vi provisionerer. Saa kan en fejl i oprettelsen
    // (tom nummerpulje, mail-fejl, dublet-email osv.) aldrig faa Frisbii til at
    // disable webhooket. Provisioneringen koerer bagefter; fejl logges blot.
    res.status(200).send("ok");

    if (!isNew) return; // allerede behandlet — intet mere at gøre

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

        case "invoice_failed":
          await setBillingStatus(body.subscription, "past_due", body.timestamp);
          break;

        case "invoice_reactivate":
          // En tidligere failed/cancelled faktura er sat tilbage til pending.
          // Ikke noedvendigvis betalt endnu, men ikke laengere i en fejltilstand.
          await setBillingStatus(body.subscription, "active", body.timestamp);
          break;

        case "subscription_cancelled":
        case "subscription_expired":
          await setBillingStatus(body.subscription, "cancelled", body.timestamp);
          break;

        case "subscription_on_hold_dunning":
        case "subscription_expired_dunning":
          // Adskilt fra invoice_failed: her er hele ABONNEMENTET sat paa hold
          // / udloebet pga. mislykket dunning-proces, ikke kun en enkelt faktura.
          await setBillingStatus(
            body.subscription,
            body.event_type === "subscription_expired_dunning" ? "cancelled" : "past_due",
            body.timestamp
          );
          break;

        case "subscription_reactivated":
          // Et tidligere "on hold"-abonnement er saet aktivt igen (admin eller
          // kunden har rettet betalingsmetoden).
          await setBillingStatus(body.subscription, "active", body.timestamp);
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
