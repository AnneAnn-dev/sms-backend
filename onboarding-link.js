// onboarding-link.js
// -----------------------------------------------------------------------------
// "Send mig et nyt link"-endpoint for Dit Digitale Kontor.
//
// Lader en haandvaerker faa et frisk login-link hvis velkomstlinket er udloebet
// eller forsvundet — uden at skulle kontakte support. Linket genereres serverside
// og sendes via DIN egen Scaleway TEM med en SEPARAT rescue-skabelon
// (sendLoginLinkMail i mail.js) — IKKE velkomstmailen, som er forbeholdt nye
// kunder. Intet gaar via Supabases egen mailtjeneste (EU-sovereignty +
// ensartet afsender).
//
// Indlaeses fra server.js med:  require("./onboarding-link")(app, supabase);
// (express.json() er allerede sat globalt, praecis som for Frisbii-webhooken.)
//
// PREFETCH-SIKKERT: linket baerer kun token_hash og peger paa /onboarding.
// Selve verifikationen (verifyOtp) sker foerst naar brugerens browser kalder
// den — en mail-scanner der blot GET'er linket forbruger derfor IKKE tokenet.
// -----------------------------------------------------------------------------

const { sendLoginLinkMail } = require("./mail");
const { maskerMail }        = require("./phone");

module.exports = (app, supabase) => {
  const BASE_URL = process.env.BASE_URL;

  // ─── Simpel in-memory cooldown ──────────────────────────────────────────────
  // Maks ét link pr. email og pr. IP hvert COOLDOWN_MS. Beskytter mod at nogen
  // spammer en kundes indbakke / braender din Scaleway-kvote. Railway koerer
  // normalt én instans; mappet nulstilles ved redeploy — helt fint til formaalet.
  const COOLDOWN_MS = Number(process.env.RELINK_COOLDOWN_MS) || 60 * 1000;
  const lastSent = new Map(); // key -> timestamp (ms)

  // ⚠️ 10/9-26: hed foer rateLimited() og returnerede true/false — og den
  // afviste bestilling fik SAMME kvittering som en, der lykkedes. Kunden fik
  // altsaa groent lys paa "Vi har sendt en NY kode", uden at der var sendt
  // noget, og uden at den forrige kode var doed. Ann ramte det 10/9 kl. 07:02:
  // hun var sikker paa at have bedt om en kode, og hverken Railway, Supabase
  // eller Scaleway kendte til den. Den blev slugt her.
  //
  // Delt i to, saa et tryk der blokeres af IP-loftet ikke ogsaa braender
  // e-mail-vinduet: vi KIGGER foerst paa begge, og saetter foerst stemplerne,
  // naar bestillingen faktisk gaar igennem.
  function restTid(key) {
    const prev = lastSent.get(key) || 0;
    return Math.max(0, COOLDOWN_MS - (Date.now() - prev));
  }

  function markerSendt(key) {
    const now = Date.now();
    lastSent.set(key, now);
    // Ryd gamle noegler en gang imellem, saa mappet ikke vokser uendeligt.
    if (lastSent.size > 5000) {
      for (const [k, t] of lastSent) if (now - t > COOLDOWN_MS) lastSent.delete(k);
    }
  }

  // ─── Byg et prefetch-sikkert login-link (token_hash, ikke action_link) ──────
  //
  // `trin` er valgfri og HVIDLISTET af kalderen til den ene kendte vaerdi,
  // foer den naar hertil. Vi bygger en URL, der lander i en kundes indbakke;
  // et frit felt fra klienten maa aldrig kunne skrive i den. Hvidlistning er
  // den rigtige form for validering her — ikke escaping af noget vilkaarligt.
  async function buildMagicLink(email, trin) {
    const { data, error } = await supabase.auth.admin.generateLink({
      type:    "magiclink",
      email,
      options: { redirectTo: `${BASE_URL}/onboarding` },
    });
    if (error) throw error;
    const tokenHash = data?.properties?.hashed_token;
    // Samme token i to former: linket (hashed_token) OG en 6-cifret engangskode
    // (email_otp). Koden er vejen ind i den INSTALLEREDE app, hvor mail-linket
    // ellers ville aabne i Safari (delt-lager-faelden, kodeopgave 1 i runbook).
    // Begge er engangsbrug — bruges den ene, doer den anden. Det er fint.
    const otpCode   = data?.properties?.email_otp || null;
    if (!tokenHash) throw new Error("generateLink gav intet hashed_token");
    // ?trin=app fortaeller /onboarding, at kunden er midt i at laegge appen
    // paa telefonen. Uden det lander hun i dashboardet efter et link-login,
    // fordi firmaet er `active` efter verifikationen — og saa er
    // installationsguiden uopnaaelig (fundet 6/9-26). Koden i mailen har
    // ikke problemet, for der bliver kunden paa siden; det er LINKET, der
    // taber hensigten, og derfor skal maerket med her.
    const trinDel = trin ? `&trin=${encodeURIComponent(trin)}` : "";
    return {
      url: `${BASE_URL}/onboarding?token_hash=${encodeURIComponent(tokenHash)}&type=email${trinDel}`,
      otpCode,
    };
  }

  // ─── Endpoint ────────────────────────────────────────────────────────────────
  app.post("/onboarding/nyt-link", async (req, res) => {
    const email = (req.body?.email || "").toLowerCase().trim();

    // Kun ÉN kendt vaerdi accepteres. Alt andet — ogsaa noget der ligner —
    // bliver til null og ignoreres. Feltet kommer fra klienten og ender i en
    // URL i en kundes indbakke.
    const trin = req.body?.trin === "app" ? "app" : null;

    // Svar ALTID 200 med samme generiske besked — vi roeber aldrig om en email
    // er kunde eller ej (beskytter mod email-enumeration). Selve afsendelsen
    // sker kun hvis firmaet faktisk findes.
    const generiskSvar = {
      ok: true,
      message: "Hvis der findes en konto med den e-mail, har vi sendt et nyt link.",
    };

    // Tom eller aabenlyst ugyldig email -> samme svar, ingen handling.
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(200).json(generiskSvar);
    }

    // Cooldown pr. email + pr. IP (foerste IP i x-forwarded-for paa Railway).
    const ip = (req.headers["x-forwarded-for"] || req.ip || "")
      .toString().split(",")[0].trim();
    const rest = Math.max(restTid(`email:${email}`), ip ? restTid(`ip:${ip}`) : 0);
    if (rest > 0) {
      const sek = Math.ceil(rest / 1000);
      // Loggen skal kende til en bestilling, der IKKE blev til en mail.
      // Uden denne linje er en afvisning usynlig for alle — ogsaa for os.
      console.log("⏳ Nyt-link afvist af cooldown (INGEN mail sendt):", maskerMail(email), `— ${sek}s tilbage`);
      // `cooldown` roeber ingenting om kontoen: vinduet er sat af kaldernes
      // EGET forrige tryk, ikke af om e-mailen findes. Enumeration-beskyttelsen
      // er uroert — beskeden er stadig den generiske.
      return res.status(200).json({ ...generiskSvar, cooldown: sek });
    }
    markerSendt(`email:${email}`);
    if (ip) markerSendt(`ip:${ip}`);

    try {
      // Findes firmaet? Vi skal kun bruge eksistensen — rescue-mailen
      // indeholder bevidst hverken firmanavn eller telefonnummer.
      //
      // ⚠️ VERSALFOELSOMHED (fundet 5/9-26). `.eq()` bliver til `=` i Postgres,
      // og inputtet er gjort til smaa bogstaver ovenfor. Er raekken skrevet med
      // stort, rammer opslaget forbi, og endpointet svarer "ukendt email" uden
      // at nogen kan se det. Eksponeringen er SMALLERE end den lyder:
      // frisbii-webhook.js lowercaser selv (linje 307), saa en almindelig
      // kunde er ikke ramt — det er testfirmaer fra provision-test-firm.js
      // (som indsatte --email ordret) og manuelt oprettede raekker.
      //
      // Rettelsen sidder hos SKRIVERNE, ikke her: provision-test-firm.js
      // normaliserer nu, og migrationen 20260905090000 retter de raekker, der
      // allerede staar med stort. Laeseren beholder `.eq()`.
      //
      // FRAVALGT: `.ilike()`, som ville vaere versal-uafhaengig uden datafix.
      // `_` og `%` er wildcards i ILIKE, saa "ann_b@x.dk" ville ogsaa matche
      // "annXb@x.dk" — og korrekt escaping gennem PostgREST er ny
      // query-semantik paa login-redningsvejen. To dage foer go-live er det
      // ikke en byttehandel vaerd; datafixet er entydigt og kan efterproeves.
      const { data: firm, error: opslagFejl } = await supabase
        .from("firms")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      // `error` blev foer kastet vaek i destruktureringen. Fejlede opslaget —
      // RLS, netvaerk, skema-cache — saa det ud PRAECIS som "ukendt email":
      // ingen mail, generisk svar til kunden, og en loglinje der paastod noget
      // forkert. Samme fejlmaade som D23: noget saa faerdigt ud uden at vaere
      // det. Kunden faar stadig det generiske svar (ingen enumeration), men
      // loggen siger nu sandheden.
      if (opslagFejl) {
        console.error("❌ Firma-opslag fejlede — INGEN mail sendt (kunden fik generisk svar):", opslagFejl.message);
        return res.status(200).json(generiskSvar);
      }

      if (firm) {
        const { url: loginUrl, otpCode } = await buildMagicLink(email, trin);
        const mailResult = await sendLoginLinkMail({ to: email, loginUrl, otpCode });
        if (mailResult?.blocked) {
          console.log("📧 Login-link-mail BLOKERET af staging-gaten (ikke sendt):", maskerMail(email));
        } else {
          // Scaleway giver et message-id tilbage, og det blev foer smidt vaek:
          // loggen sagde "sendt" uden at sige HVAD, saa en savnet mail kunne
          // kun findes ved at gaette ud fra klokkeslaet. Nu kan den slaas op.
          const mailId = mailResult?.emails?.[0]?.message_id
                      || mailResult?.emails?.[0]?.id
                      || mailResult?.message_id
                      || mailResult?.id
                      || "ukendt-id";
          console.log("✉️  Nyt login-link sendt til:", maskerMail(email), "— Scaleway-id:", mailId);
        }
      } else {
        // Ukendt email: log internt, men svar stadig generisk (ingen laekage).
        console.log("ℹ️  Nyt-link anmodet for ukendt email (ingen mail sendt):", maskerMail(email));
      }
    } catch (err) {
      // Vi svarer stadig 200 generisk — fejlen logges blot, intet laekkes til klienten.
      console.error("❌ Kunne ikke sende nyt link:", err.message);
    }

    return res.status(200).json(generiskSvar);
  });

  console.log("🔗 Nyt-link endpoint registreret paa /onboarding/nyt-link");
};
