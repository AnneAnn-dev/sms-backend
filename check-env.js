// check-env.js
// -----------------------------------------------------------------------------
// Verificerer at den LOKALE .env peger paa STAGING hele vejen rundt.
// Koer:  node check-env.js          (statiske tjek — ingen netvaerkskald)
//        node check-env.js --live   (+ spoerger Supabase/Twilio/Frisbii "hvem er du?")
//
// Viser ALDRIG selve noeglevaedierne — kun domme (OK/FEJL) og metadata.
// Sikker at koere naar som helst; aendrer intet nogen steder.
// -----------------------------------------------------------------------------
require("dotenv").config({ quiet: true });

// ─── FACIT: staging-miljoeets kendetegn ─────────────────────────────────────
const STAGING_SUPABASE_REF = "hehrvdmtzokzbnbihcel";
const STAGING_BASE_URL     = "https://sms-backend-staging-908c.up.railway.app";
const FRISBII_STAGING_HANDLE = "lommekontor";          // staging-KONTOENS handle
const TWILIO_SUBACCOUNT_NAME = "ditdigitalekontor-staging"; // subkontoens friendly name

let fails = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails++;
}

function decodeJwtPayload(jwt) {
  try {
    const p = jwt.split(".")[1];
    return JSON.parse(Buffer.from(p, "base64").toString("utf8"));
  } catch { return null; }
}

// ─── Statiske tjek ───────────────────────────────────────────────────────────
console.log("── Statiske tjek ──────────────────────────────────────────");

// Supabase URL
const su = process.env.SUPABASE_URL || "";
check("SUPABASE_URL peger paa staging-projektet",
  su.includes(STAGING_SUPABASE_REF),
  su ? `host indeholder ${su.includes(STAGING_SUPABASE_REF) ? "staging-ref" : "en ANDEN ref!"}` : "MANGLER");

// Service role key: rolle + projekt-ref laeses ud af selve JWT'en
const srk = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const srkPayload = decodeJwtPayload(srk);
check("SUPABASE_SERVICE_ROLE_KEY er en service_role-noegle",
  srkPayload?.role === "service_role",
  srkPayload ? `role=${srkPayload.role}` : "kan ikke afkodes (tom/ikke-JWT?)");
check("SUPABASE_SERVICE_ROLE_KEY hoerer til staging-projektet",
  srkPayload?.ref === STAGING_SUPABASE_REF,
  srkPayload ? `ref=${srkPayload.ref}` : "");

// Anon key
const anon = decodeJwtPayload(process.env.SUPABASE_ANON_KEY || "");
check("SUPABASE_ANON_KEY er anon + staging",
  anon?.role === "anon" && anon?.ref === STAGING_SUPABASE_REF,
  anon ? `role=${anon.role}, ref=${anon.ref}` : "kan ikke afkodes");

// BASE_URL
const bu = (process.env.BASE_URL || "").replace(/\/$/, "");
check("BASE_URL er staging-URL'en (uden trailing slash)",
  bu === STAGING_BASE_URL, bu || "MANGLER");

// Twilio: format-tjek (indholdet doemmes af --live)
const tsid = process.env.TWILIO_ACCOUNT_SID || "";
check("TWILIO_ACCOUNT_SID har AC-format (34 tegn)",
  /^AC[0-9a-f]{32}$/i.test(tsid), `laengde=${tsid.length}`);
const ttok = process.env.TWILIO_AUTH_TOKEN || "";
check("TWILIO_AUTH_TOKEN er 32 tegn uden whitespace",
  ttok.length === 32 && !/\s/.test(ttok), `laengde=${ttok.length}`);

// Mail-muren
check("MAIL_OVERRIDE_TO er sat (lokale koersler er mail-sikre)",
  !!process.env.MAIL_OVERRIDE_TO, process.env.MAIL_OVERRIDE_TO ? "sat" : "MANGLER — fail-closed blokerer al lokal mail");

// Frisbii: kun tilstedevaerelse statisk (kontoen doemmes af --live)
check("FRISBII_PRIVATE_KEY er sat", !!process.env.FRISBII_PRIVATE_KEY);
check("FRISBII_WEBHOOK_SECRET er sat", !!process.env.FRISBII_WEBHOOK_SECRET);

// ─── Live-tjek (--live): spoerg tjenesterne "hvem er du?" ────────────────────
async function live() {
  console.log("\n── Live-tjek ──────────────────────────────────────────────");

  // Supabase: kan vi laese firms i STAGING med service-noeglen?
  try {
    const res = await fetch(`${su}/rest/v1/firms?select=id&limit=1`, {
      headers: { apikey: srk, Authorization: `Bearer ${srk}` },
    });
    check("Supabase: service-noeglen kan laese firms i staging", res.ok, `HTTP ${res.status}`);
  } catch (e) { check("Supabase: forbindelse", false, e.message); }

  // Twilio: hvilken konto tilhoerer SID+token? (friendly name afsloerer subkontoen)
  try {
    const auth = Buffer.from(`${tsid}:${ttok}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tsid}.json`,
      { headers: { Authorization: `Basic ${auth}` } });
    const data = res.ok ? await res.json() : null;
    check("Twilio: creds hoerer til STAGING-subkontoen",
      data?.friendly_name === TWILIO_SUBACCOUNT_NAME,
      data ? `friendly_name="${data.friendly_name}"` : `HTTP ${res.status} (forkert SID/token?)`);
  } catch (e) { check("Twilio: forbindelse", false, e.message); }

  // Frisbii: hvilken konto tilhoerer den private noegle? (handle afsloerer det)
  try {
    const auth = Buffer.from(`${process.env.FRISBII_PRIVATE_KEY}:`).toString("base64");
    const res = await fetch("https://api.reepay.com/v1/account",
      { headers: { Authorization: `Basic ${auth}` } });
    const data = res.ok ? await res.json() : null;
    check("Frisbii: noeglen hoerer til STAGING-kontoen",
      data?.handle === FRISBII_STAGING_HANDLE,
      data ? `handle="${data.handle}"` : `HTTP ${res.status} (forkert noegle?)`);
  } catch (e) { check("Frisbii: forbindelse", false, e.message); }
}

(async () => {
  if (process.argv.includes("--live")) await live();
  console.log("\n" + (fails === 0
    ? "🏁 ALT GROENT — .env peger paa staging hele vejen rundt."
    : `⚠️  ${fails} tjek fejlede — ret dem foer lokale koersler.`));
  process.exit(fails === 0 ? 0 : 1);
})();
