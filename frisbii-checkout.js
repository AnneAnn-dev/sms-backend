// frisbii-checkout.js
// -----------------------------------------------------------------------------
// Starter en Frisbii Checkout-session (subscription) — broen mellem Simply-siden
// og Frisbii. Simply-siden kan IKKE linke direkte til en statisk Frisbii-URL:
// en checkout-session skal oprettes server-til-server FØRST (kræver den private
// API-nøgle, som aldrig må eksponeres client-side), og Frisbii returnerer en
// session-url, kunden derefter omdirigeres til (eller en session-id til JS-SDK'en,
// hvis I senere vil vise checkout som overlay i stedet for redirect).
//
// Indlaeses fra server.js med:  require("./frisbii-checkout")(app, supabase);
//
// Fase 3, T8b (31/10-26), kun med FASE3_SYNK:
//  - Kunden vaelger moduler (bestillingssiden /bestil). Abonnementet bliver
//    basisplanen + et add-on pr. modul (kataloget, frisbii-katalog.js) - maalt
//    31/10: Frisbiis checkout tager begge i samme session. Uden moduler saelges
//    Telefonpasser, saa en gammel knap virker uaendret.
//  - En kunde, hvis abonnement stadig koerer, faar 409 "har_konto" i stedet
//    for et nyt koeb (D91, Ann 31/10, beslutning 1). Siden tilbyder et
//    login-link via /onboarding/nyt-link. Svaret afsloerer, at e-mailen er
//    kunde; loftet herunder begraenser, hvor mange e-mails man kan proeve
//    (Ann 31/10: accepteret, staar i registret).
//  - GET /checkout/produkter: det, der saelges, med navne og priser fra
//    kataloget - saa siden aldrig har sine egne priser.
//  - GET /bestil: bestillingssiden (static/bestil.html).
// Slukket flag: praecis som foer (gammel plan, ingen opslag i databasen).
//
// Flow:  Simply-side -> POST /checkout/start -> denne route -> Frisbii API
//        -> { url } -> Simply-siden omdirigerer kunden -> kunde betaler
//        -> Frisbii sender invoice_settled-webhook (frisbii-webhook.js)
//
// Kraever Node 18+ (global fetch).
// -----------------------------------------------------------------------------

const path = require("path");
const { opretLoft, klientIp } = require("./ratelimit");
const { FASE3_SYNK } = require("./flags");
const { KATALOG, handleForModul } = require("./frisbii-katalog");
const { firmaerMedEmail } = require("./frisbii-kunde");

const FRISBII_CHECKOUT_API = "https://checkout-api.frisbii.com/v1";

// ─── Vindueloft (S12) ────────────────────────────────────────────────────────
// Routen er offentlig og uautentificeret, og hvert kald bruger den private
// Frisbii-noegle. Uden loft kan hvem som helst fylde Frisbii med skraldekunder.
// Eksponeringen begyndte, da Ø5 trin 1+2 gik i luften — routen svarer ikke
// laengere 404.
//
// Vaerdierne kan overstyres via env, men fail-closed: er en env-variabel sat og
// ulaeselig, braender det ved boot i stedet for tavst at falde tilbage til
// standarden. Et loft, man tror er 5, men som i virkeligheden er noget andet,
// er vaerre end intet loft.
function heltalFraEnv(navn, standard) {
  const raa = process.env[navn];
  if (raa === undefined || raa === "") return standard;
  const n = Number(raa);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${navn} er sat til "${raa}" — skal vaere et heltal >= 1`);
  }
  return n;
}

const CHECKOUT_LOFT_MAKS       = heltalFraEnv("CHECKOUT_LOFT_MAKS", 5);
const CHECKOUT_LOFT_VINDUE_MIN = heltalFraEnv("CHECKOUT_LOFT_VINDUE_MIN", 10);

const checkoutLoft = opretLoft({
  navn: "checkout",
  maks: CHECKOUT_LOFT_MAKS,
  vinduetMs: CHECKOUT_LOFT_VINDUE_MIN * 60 * 1000,
});

// Maskerer en e-mail til loggen: "anne@firma.dk" -> "an***@firma.dk".
// Runbogens punkt 12(b): loggen skrev hele adressen i klartekst. Bekraeftet i
// praksis 13/8 under S16-testen. Domaenet beholdes, saa en fejl stadig kan
// diagnosticeres. ⚠️ `onboarding-link.js` har samme problem og er endnu ikke
// rettet — bliver der brug for maskeringen et tredje sted, flyttes den til et
// delt modul frem for at blive kopieret igen.
function maskerEmail(s) {
  if (typeof s !== "string" || !s.includes("@")) return "(ugyldig)";
  const [lokal, domaene] = s.split("@");
  const synlig = lokal.slice(0, 2);
  return `${synlig}${"*".repeat(Math.max(1, lokal.length - 2))}@${domaene}`;
}

// ─── T8b: de moduler, der kan koebes nu (kataloget: saelges = true) ─────────
function tilSalg(katalog = KATALOG) {
  return Object.entries(katalog.MODUL_ADDONS)
    .filter(([, a]) => a.saelges)
    .map(([modul, a]) => ({ modul, navn: a.navn, prisOere: a.prisOere }));
}

// Kundens valg -> { ok, moduler } eller { ok: false, fejl }. Tager en liste
// eller en kommasepareret tekst (fra linket ?moduler=telefon,referat).
// Intet valg = Telefonpasser (som foer T8b). Kun moduler, der saelges.
function vaelgModuler(input, katalog = KATALOG) {
  let liste;
  if (input === undefined || input === null || input === "") liste = ["telefon"];
  else if (Array.isArray(input)) liste = input;
  else if (typeof input === "string") liste = input.split(",");
  else return { ok: false, fejl: "ugyldige_moduler" };
  const valgt = [...new Set(liste.map((m) => String(m).trim().toLowerCase()).filter(Boolean))];
  if (!valgt.length) return { ok: false, fejl: "ingen_moduler" };
  const salg = new Set(tilSalg(katalog).map((p) => p.modul));
  const ukendte = valgt.filter((m) => !salg.has(m));
  if (ukendte.length) return { ok: false, fejl: "ukendt_modul", ukendte };
  return { ok: true, moduler: valgt.sort() };
}

// Har kunden allerede et abonnement, der koerer? Et udloebet firma (inactive)
// og en pilot uden abonnement maa gerne koebe - dem tager webhooken (T8a).
function harKoerendeKonto(firmaer) {
  return (firmaer || []).some((f) => f.status !== "inactive" && !!f.frisbii_subscription);
}

function checkoutModul(app, supabase) {
  const PRIVATE_KEY  = process.env.FRISBII_PRIVATE_KEY;   // samme noegle som frisbii-webhook.js bruger til frisbiiGet
  const PLAN_HANDLE  = process.env.FRISBII_PLAN_HANDLE;   // pr. 15/8-26: "abonnement-standard" — IKKE en test-plan i produktion
  const SIMPLY_BASE_URL = process.env.SIMPLY_BASE_URL;    // Simply-sidens domæne, til accept_url/cancel_url

  function requireConfig() {
    const missing = [];
    if (!PRIVATE_KEY)     missing.push("FRISBII_PRIVATE_KEY");
    if (!PLAN_HANDLE)     missing.push("FRISBII_PLAN_HANDLE");
    if (!SIMPLY_BASE_URL) missing.push("SIMPLY_BASE_URL");
    return missing;
  }

  // Meget simpel e-mail-sanity-tjek — den egentlige validering (RFC 822) sker
  // hos Frisbii selv, når de opretter kunden. Vi vil bare undgå at sende et
  // tomt/åbenlyst forkert felt og få en kryptisk Frisbii-fejl tilbage.
  function looksLikeEmail(s) {
    return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  app.post("/checkout/start", async (req, res) => {
    const missing = requireConfig();
    if (missing.length) {
      console.error("❌ /checkout/start: mangler env vars:", missing.join(", "));
      return res.status(500).json({ error: "server_misconfigured" });
    }

    const { name, email, phone, company, moduler: modulInput } = req.body || {};

    if (!looksLikeEmail(email)) {
      return res.status(400).json({ error: "invalid_email" });
    }
    // Navn er ikke strengt nødvendigt for Frisbii (de kan splitte first/last
    // fra company senere), men vi kræver det her, så der altid er en person
    // at skrive til i velkomstmailen.
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "missing_name" });
    }
    // ⚠️ D33: firmanavnet er OBLIGATORISK (Anns beslutning 16/8). Det er ikke
    // bare et felt i databasen: provisionFirm() bruger det til firms.name,
    // sluggen, velkomstmailen og — vigtigst — greeting_text, som PRÆRENDERES
    // til lyd. Mangler det, falder webhooken tilbage på personens navn
    // (`company || "fornavn efternavn" || email`), og håndværkerens
    // telefonsvarer siger hans eget navn i stedet for firmaets. Det er en
    // fuldt gyldig provisionering med et forkert produkt i den anden ende,
    // og rettelsen bagefter kræver ny TTS-rendering — ikke bare en update.
    // Derfor afvises det ved indgangen.
    //
    // ⚠️ Bemærk: Frisbiis egen hostede betalingsside går UDEN OM denne rute
    // og dermed uden om valideringen, og feltet kan ikke gøres obligatorisk
    // dér. Denne linje lukker vores dør, ikke den anden. Se D33.
    if (!company || typeof company !== "string" || !company.trim()) {
      return res.status(400).json({ error: "missing_company" });
    }

    // ─── Loftet ligger HER med vilje ─────────────────────────────────────────
    // Efter begge valideringer, foer alt arbejde. To grunde:
    //  1) `smoke.js` sender tomt body og kraever 400 invalid_email. Laa loftet
    //     foerst, ville gentagne roegtestkoersler fra samme IP faa 429 i stedet,
    //     og et groent tjek ville blive roedt af sig selv.
    //  2) Fagligt rigtigt: det, der skal beskyttes, er kaldet mod Frisbii med
    //     den private noegle — ikke serverens evne til at afvise tomt input.
    const ip = klientIp(req);
    if (ip) {
      const loft = checkoutLoft.tjek(`ip:${ip}`);
      if (loft.blokeret) {
        console.warn(
          `⚠️  /checkout/start: loft ramt — ip=${ip} email=${maskerEmail(email)} ` +
          `(${loft.brugt}/${loft.maks} inden for ${CHECKOUT_LOFT_VINDUE_MIN} min., aabner om ${loft.nulstillerOm}s)`
        );
        res.set("Retry-After", String(loft.nulstillerOm));
        return res.status(429).json({ error: "rate_limited", retry_after_sekunder: loft.nulstillerOm });
      }
    } else {
      // Sker reelt kun lokalt uden proxy foran. Logges frem for at ignoreres
      // tavst: forsvinder headeren i produktion, skal det vaere synligt.
      console.warn("⚠️  /checkout/start: ingen x-forwarded-for — loftet er sprunget over for dette kald");
    }

    // ─── T8b: moduler og "har allerede en konto" (kun med FASE3_SYNK) ────────
    let valg = null;
    if (FASE3_SYNK) {
      valg = vaelgModuler(modulInput);
      if (!valg.ok) return res.status(400).json({ error: valg.fejl });
      if (supabase) {
        try {
          const firmaer = await firmaerMedEmail(supabase, email.toLowerCase().trim());
          if (harKoerendeKonto(firmaer)) {
            console.log("ℹ️  /checkout/start: kunden har allerede en konto - intet nyt koeb:", maskerEmail(email));
            return res.status(409).json({ error: "har_konto" });
          }
        } catch (err) {
          // Fail-open: koebet maa gerne gaa igennem - webhooken (T8a) opretter
          // alligevel intet nyt firma for en kunde med et koerende abonnement.
          console.error("⚠️  /checkout/start: kunne ikke slaa kunden op - fortsaetter:", err.message);
        }
      }
    }

    // E.164-tjek er bevidst løst her (kun præfiks) — phone er valgfri for
    // Frisbii (de prefilder kun Vipps/MobilePay-signup-siden med den), og
    // jeres egen owner_phone-validering sker først rigtigt i onboarding trin 1.
    const cleanPhone = typeof phone === "string" && phone.trim() ? phone.trim() : undefined;

    const auth = Buffer.from(`${PRIVATE_KEY}:`).toString("base64");

    const payload = {
      prepare_subscription: {
        // T8b: basisplanen + et add-on pr. valgt modul. Slukket flag: den gamle plan.
        plan: valg ? KATALOG.BASISPLAN : PLAN_HANDLE,
        ...(valg ? { add_ons: valg.moduler.map((m) => ({ add_on: handleForModul(m) })) } : {}),
        // ⚠️ Ø6: abonnementet skal have SIT EGET handle. `generate_handle` inde i
        // create_customer gælder kun kundens handle — uden denne linje afviser
        // Frisbii hvert kald med 400 "handle is required", og det gjorde den fra
        // dag ét uden at nogen opdagede det. Verificeret 16/8 mod staging:
        // uden linjen 400, med linjen 200 + session.url.
        generate_handle: true,
        create_customer: {
          email: email.toLowerCase().trim(),
          first_name: name.trim(),
          company: company.trim(), // garanteret til stede, jf. valideringen ovenfor
          phone: cleanPhone,
          generate_handle: true, // lad Frisbii generere et unikt customer-handle
        },
      },
      // ⚠️ Ø6: `payment_methods` er BEVIDST udeladt. Feltet stod som
      // ["vipps_recurring"] — en metode kontoen ikke har (Vipps/MobilePay kræver
      // MSN + indløsningsaftale, go-live-gate 2). Frisbii svarede 400
      // "No payment methods found", og kunden ville have fået en tavs 502.
      //
      // Uden feltet bestemmer KONTOEN: staging kører på testkort i dag, prod
      // tilbyder kort når indløsningsaftalen lander, og MobilePay dukker op ved
      // siden af når MSN'et kommer — uden kodeændring på hver af de to datoer.
      // Verificeret 16/8: uden feltet 200, med feltet 400. Kontrollen ligger i
      // Frisbii-dashboardet, hvor aftalerne administreres i forvejen.
      accept_url: `${SIMPLY_BASE_URL}/tak`,
      cancel_url: `${SIMPLY_BASE_URL}/afbrudt`,
      // Prefilder kundens telefonnummer på Vipps/MobilePay-signup-siden, hvis givet.
      ...(cleanPhone ? { phone: cleanPhone } : {}),
    };

    // Payloaden logges IKKE. Den midlertidige payload-logning fra Ø6 er fjernet
    // (registrets opgave 8, 23/10-26): den skrev kundens navn i klartekst og var
    // kun ment som diagnose, til checkout havde kørt et stykke tid. Skal en
    // payload fejlsøges igen, så kald Frisbii direkte med test-oe6-*.ps1 mod
    // staging — ikke ved at sætte logningen tilbage her.
    const kropp = JSON.stringify(payload);

    let frisbiiRes;
    try {
      frisbiiRes = await fetch(`${FRISBII_CHECKOUT_API}/session/subscription`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: kropp,
      });
    } catch (err) {
      console.error("❌ /checkout/start: netværksfejl mod Frisbii:", err.message);
      return res.status(502).json({ error: "frisbii_unreachable" });
    }

    const bodyText = await frisbiiRes.text();
    if (!frisbiiRes.ok) {
      // Frisbii returnerer en struktureret fejl (code/error/message) — log den
      // fulde tekst, så en evt. plan/MSN-fejlkonfiguration er let at se i
      // Railway-loggen, men eksponer kun en generisk fejl til Simply-siden.
      // ⚠️ Denne tekst kan indeholde kundens e-mail, hvis Frisbii ekkoer den
      // tilbage. Beholdt som den er — diagnostikken vejer tungere her — men
      // det er et bevidst valg og ikke en overset detalje.
      console.error(`❌ /checkout/start: Frisbii afviste (HTTP ${frisbiiRes.status}):`, bodyText);
      return res.status(502).json({ error: "frisbii_rejected_session" });
    }

    let session;
    try {
      session = JSON.parse(bodyText);
    } catch {
      console.error("❌ /checkout/start: kunne ikke parse Frisbii-svar:", bodyText);
      return res.status(502).json({ error: "frisbii_invalid_response" });
    }

    if (!session.url) {
      console.error("❌ /checkout/start: Frisbii-svar uden url:", bodyText);
      return res.status(502).json({ error: "frisbii_missing_url" });
    }

    console.log("🧾 Checkout-session oprettet:", session.id, "for", maskerEmail(email), valg ? `[${valg.moduler.join(", ")}]` : "");
    res.json({ url: session.url, session_id: session.id });
  });

  // ─── T8b: produkterne og bestillingssiden ───────────────────────────────────
  // Uden flaget findes de ikke (404), saa ingen kan bestille moduler, foer
  // webhooken kan haandtere dem.
  if (FASE3_SYNK) {
    app.get("/checkout/produkter", (req, res) => {
      res.set("Cache-Control", "no-store");
      res.json({ proevedage: KATALOG.PROEVEDAGE, produkter: tilSalg() });
    });
    app.get("/bestil", (req, res) => res.sendFile(path.join(__dirname, "static", "bestil.html")));
  }

  console.log(
    `🧾 Frisbii checkout-rute registreret paa /checkout/start ` +
    `(loft: ${CHECKOUT_LOFT_MAKS} kald pr. IP pr. ${CHECKOUT_LOFT_VINDUE_MIN} min.)`
  );
}

module.exports = checkoutModul;
module.exports.vaelgModuler = vaelgModuler;
module.exports.tilSalg = tilSalg;
module.exports.harKoerendeKonto = harKoerendeKonto;
