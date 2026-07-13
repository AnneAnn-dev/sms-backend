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

module.exports = (app, supabase) => {
  const BASE_URL = process.env.BASE_URL;

  // ─── Simpel in-memory cooldown ──────────────────────────────────────────────
  // Maks ét link pr. email og pr. IP hvert COOLDOWN_MS. Beskytter mod at nogen
  // spammer en kundes indbakke / braender din Scaleway-kvote. Railway koerer
  // normalt én instans; mappet nulstilles ved redeploy — helt fint til formaalet.
  const COOLDOWN_MS = Number(process.env.RELINK_COOLDOWN_MS) || 60 * 1000;
  const lastSent = new Map(); // key -> timestamp (ms)

  function rateLimited(key) {
    const now  = Date.now();
    const prev = lastSent.get(key) || 0;
    if (now - prev < COOLDOWN_MS) return true;
    lastSent.set(key, now);
    // Ryd gamle noegler en gang imellem, saa mappet ikke vokser uendeligt.
    if (lastSent.size > 5000) {
      for (const [k, t] of lastSent) if (now - t > COOLDOWN_MS) lastSent.delete(k);
    }
    return false;
  }

  // ─── Byg et prefetch-sikkert login-link (token_hash, ikke action_link) ──────
  async function buildMagicLink(email) {
    const { data, error } = await supabase.auth.admin.generateLink({
      type:    "magiclink",
      email,
      options: { redirectTo: `${BASE_URL}/onboarding` },
    });
    if (error) throw error;
    const tokenHash = data?.properties?.hashed_token;
    if (!tokenHash) throw new Error("generateLink gav intet hashed_token");
    return `${BASE_URL}/onboarding?token_hash=${encodeURIComponent(tokenHash)}&type=email`;
  }

  // ─── Endpoint ────────────────────────────────────────────────────────────────
  app.post("/onboarding/nyt-link", async (req, res) => {
    const email = (req.body?.email || "").toLowerCase().trim();

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
    if (rateLimited(`email:${email}`) || (ip && rateLimited(`ip:${ip}`))) {
      return res.status(200).json(generiskSvar);
    }

    try {
      // Findes firmaet? Vi skal kun bruge eksistensen — rescue-mailen
      // indeholder bevidst hverken firmanavn eller telefonnummer.
      const { data: firm } = await supabase
        .from("firms")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (firm) {
        const loginUrl = await buildMagicLink(email);
        const mailResult = await sendLoginLinkMail({ to: email, loginUrl });
        if (mailResult?.blocked) {
          console.log("📧 Login-link-mail BLOKERET af staging-gaten (ikke sendt):", email);
        } else {
          console.log("✉️  Nyt login-link sendt til:", email);
        }
      } else {
        // Ukendt email: log internt, men svar stadig generisk (ingen laekage).
        console.log("ℹ️  Nyt-link anmodet for ukendt email (ingen mail sendt):", email);
      }
    } catch (err) {
      // Vi svarer stadig 200 generisk — fejlen logges blot, intet laekkes til klienten.
      console.error("❌ Kunne ikke sende nyt link:", err.message);
    }

    return res.status(200).json(generiskSvar);
  });

  console.log("🔗 Nyt-link endpoint registreret paa /onboarding/nyt-link");
};
