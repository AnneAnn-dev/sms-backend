// check-env.js
// -----------------------------------------------------------------------------
// Verificerer at den LOKALE .env peger paa STAGING hele vejen rundt.
// Koer:  node check-env.js          (statiske tjek — ingen netvaerkskald)
//        node check-env.js --live   (+ spoerger Supabase/Twilio/Frisbii "hvem er du?")
//
// Viser ALDRIG selve noeglevaerdierne — kun domme (OK/FEJL) og metadata.
// Sikker at koere naar som helst; aendrer intet nogen steder.
//
// ⚠️ OPDATERET 24/7-26 (Supabase-noeglemigrering):
// De gamle anon/service_role-noegler var JWT'er med projekt-ref OG rolle
// indbygget — dem kunne vi doemme STATISK. De nye noegler (sb_publishable_… /
// sb_secret_…) er ugennemsigtige strenge uden indhold. Konsekvens:
//   - Statisk kan vi kun doemme FORMAT (og fange den farlige forveksling,
//     hvor en secret-noegle havner i ANON-variablen → laekker til browseren).
//   - PROJEKT og ROLLE kan KUN afgoeres af --live. Noeglerne er projekt-bundne,
//     saa "virker mod staging-URL'en" ER beviset for staging.
// Derfor: koer ALTID --live efter en noeglerotation. Statisk groent er ikke nok.
// -----------------------------------------------------------------------------
require("dotenv").config({ quiet: true });

// ─── FACIT: staging-miljoeets kendetegn ─────────────────────────────────────
const STAGING_SUPABASE_REF   = "hehrvdmtzokzbnbihcel";
const STAGING_BASE_URL       = "https://sms-backend-staging-908c.up.railway.app";
const FRISBII_STAGING_HANDLE = "lommekontor";               // staging-KONTOENS handle
const TWILIO_SUBACCOUNT_NAME = "ditdigitalekontor-staging"; // subkontoens friendly name

let fails = 0;
let warns = 0;

function check(name, ok, detail) {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails++;
}
function warn(name, detail) {
  console.log(`⚠️  ${name}${detail ? " — " + detail : ""}`);
  warns++;
}
function info(name, detail) {
  console.log(`ℹ️  ${name}${detail ? " — " + detail : ""}`);
}

// Hvilken slags Supabase-noegle er det? (uden at afsloere vaerdien)
function noegleType(v) {
  if (!v)                             return "mangler";
  if (v.startsWith("sb_secret_"))      return "secret";
  if (v.startsWith("sb_publishable_")) return "publishable";
  if (v.startsWith("eyJ"))             return "legacy-jwt";
  return "ukendt";
}

// ─── Statiske tjek ───────────────────────────────────────────────────────────
console.log("── Statiske tjek ──────────────────────────────────────────");

// Supabase URL — den ENESTE statiske kilde til projekt-identitet nu
const su = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
check("SUPABASE_URL peger paa staging-projektet",
  su.includes(STAGING_SUPABASE_REF),
  su ? (su.includes(STAGING_SUPABASE_REF) ? "staging-ref" : "en ANDEN ref!") : "MANGLER");

// Service role / secret key
const srk     = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const srkType = noegleType(srk);
if (srkType === "legacy-jwt") {
  check("SUPABASE_SERVICE_ROLE_KEY er en ny secret-noegle", false,
    "LEGACY JWT — legacy-noeglerne blev DEAKTIVERET 24/7-26. Hent en sb_secret_… i dashboardet (Settings → API Keys)");
} else if (srkType === "publishable") {
  check("SUPABASE_SERVICE_ROLE_KEY er en ny secret-noegle", false,
    "det er en PUBLISHABLE-noegle — backend faar ingen service-adgang");
} else {
  check("SUPABASE_SERVICE_ROLE_KEY er en ny secret-noegle",
    srkType === "secret", `type=${srkType}`);
}

// Anon / publishable key — her er den FARLIGE forveksling
const anon     = process.env.SUPABASE_ANON_KEY || "";
const anonType = noegleType(anon);
if (anonType === "secret") {
  check("SUPABASE_ANON_KEY er en publishable-noegle", false,
    "🚨 DET ER EN SECRET-NOEGLE! app-config.js serverer denne til BROWSEREN → total RLS-bypass. SKIFT STRAKS.");
} else if (anonType === "legacy-jwt") {
  check("SUPABASE_ANON_KEY er en publishable-noegle", false,
    "LEGACY JWT — deaktiveret 24/7-26. Hent en sb_publishable_… i dashboardet");
} else {
  check("SUPABASE_ANON_KEY er en publishable-noegle",
    anonType === "publishable", `type=${anonType}`);
}

info("Projekt + rolle for Supabase-noegler kan KUN afgoeres af --live",
  "de nye noegleformater baerer ingen ref/role");

// BASE_URL
const bu = (process.env.BASE_URL || "").replace(/\/$/, "");
check("BASE_URL er staging-URL'en (uden trailing slash)",
  bu === STAGING_BASE_URL, bu || "MANGLER");

// VOICE_URL (kodeopgave 7 — scriptenes nummer-konfiguration bruger den)
const vu = process.env.VOICE_URL || "";
if (!vu) {
  warn("VOICE_URL mangler", "kun paakraevet for nummer-scripts (buy/configure)");
} else {
  check("VOICE_URL peger paa staging og ender paa /opkald",
    vu.includes(STAGING_BASE_URL.replace(/^https:\/\//, "")) && /\/opkald\/?$/.test(vu),
    vu);
}

// Twilio: format-tjek (indholdet doemmes af --live)
const tsid = process.env.TWILIO_ACCOUNT_SID || "";
check("TWILIO_ACCOUNT_SID har AC-format (34 tegn)",
  /^AC[0-9a-f]{32}$/i.test(tsid), `laengde=${tsid.length}`);
const ttok = process.env.TWILIO_AUTH_TOKEN || "";
check("TWILIO_AUTH_TOKEN er 32 tegn uden whitespace",
  ttok.length === 32 && !/\s/.test(ttok), `laengde=${ttok.length}`);

// TWILIO_SYSTEM_NUMBER (kodeopgave 7 — vagten koerte stumt uden den)
const tsys = process.env.TWILIO_SYSTEM_NUMBER || "";
check("TWILIO_SYSTEM_NUMBER er sat i E.164 DK-format",
  /^\+45\d{8}$/.test(tsys), tsys || "MANGLER — systemnummer-vagten koerer stumt");

// Mail-muren
check("MAIL_OVERRIDE_TO er sat (lokale koersler er mail-sikre)",
  !!process.env.MAIL_OVERRIDE_TO,
  process.env.MAIL_OVERRIDE_TO ? "sat" : "MANGLER — fail-closed blokerer al lokal mail");

// VAPID (roteret 24/7-26 — begge skal foelges ad, ellers doer push tavst)
const vapidPub = process.env.VAPID_PUBLIC_KEY || "";
const vapidPriv = process.env.VAPID_PRIVATE_KEY || "";
check("VAPID-noeglepar er sat (begge dele)",
  !!vapidPub && !!vapidPriv,
  !vapidPub && !vapidPriv ? "begge MANGLER" : (!vapidPub ? "PUBLIC mangler" : (!vapidPriv ? "PRIVATE mangler" : "ok")));

// Frisbii: kun tilstedevaerelse statisk (kontoen doemmes af --live)
check("FRISBII_PRIVATE_KEY er sat", !!process.env.FRISBII_PRIVATE_KEY);
check("FRISBII_WEBHOOK_SECRET er sat", !!process.env.FRISBII_WEBHOOK_SECRET);

// ─── Live-tjek (--live): spoerg tjenesterne "hvem er du?" ────────────────────

// De nye noegler sendes i apikey-headeren. Nogle gateway-stier vil ogsaa se
// dem som Bearer — vi proever apikey alene foerst og faldbakker til begge,
// saa et 401 betyder "noeglen duer ikke", ikke "vi brugte forkert header".
async function supaFetch(path, key) {
  const url = `${su}${path}`;
  let res = await fetch(url, { headers: { apikey: key } });
  if (res.status === 401) {
    res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  }
  return res;
}

async function live() {
  console.log("\n── Live-tjek ──────────────────────────────────────────────");

  // 1) Virker secret-noeglen mod STAGING-projektet?
  //    Noeglerne er projekt-bundne → succes her ER beviset for staging.
  try {
    const res = await supaFetch("/rest/v1/firms?select=id&limit=1", srk);
    check("Supabase: secret-noeglen kan laese firms i staging", res.ok,
      res.ok ? `HTTP ${res.status} (= noeglen hoerer til ${STAGING_SUPABASE_REF})`
             : `HTTP ${res.status} — forkert/deaktiveret noegle, eller noegle fra et ANDET projekt`);
  } catch (e) { check("Supabase: forbindelse", false, e.message); }

  // 2) Er det virkelig en SERVICE-noegle? Admin-endpointet svarer kun paa
  //    service-niveau. Erstatter det gamle role-tjek i JWT'en.
  try {
    const res = await supaFetch("/auth/v1/admin/users?page=1&per_page=1", srk);
    check("Supabase: secret-noeglen har service-niveau (admin-adgang)", res.ok,
      `HTTP ${res.status}`);
  } catch (e) { check("Supabase: admin-tjek", false, e.message); }

  // 3) SIKKERHEDSTJEK: anon-noeglen maa IKKE have admin-adgang.
  //    Fanger den katastrofale forveksling, hvor en secret-noegle serveres
  //    til browseren via app-config.js.
  try {
    const res = await supaFetch("/auth/v1/admin/users?page=1&per_page=1", anon);
    check("Supabase: anon-noeglen har IKKE admin-adgang (sikker i browseren)",
      !res.ok, res.ok ? "🚨 DEN SVARER 200 — der ligger en SECRET-noegle i ANON-variablen!" : `HTTP ${res.status} (afvist som forventet)`);
  } catch (e) { check("Supabase: anon-sikkerhedstjek", false, e.message); }

  // 4) Twilio: hvilken konto tilhoerer SID+token? (friendly name afsloerer subkontoen)
  try {
    const auth = Buffer.from(`${tsid}:${ttok}`).toString("base64");
    const res  = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tsid}.json`,
      { headers: { Authorization: `Basic ${auth}` } });
    const data = res.ok ? await res.json() : null;
    check("Twilio: creds hoerer til STAGING-subkontoen",
      data?.friendly_name === TWILIO_SUBACCOUNT_NAME,
      data ? `friendly_name="${data.friendly_name}"`
           : `HTTP ${res.status} — SID og token skal komme fra SAMME konto (subkontoen har sit EGET auth-token)`);
  } catch (e) { check("Twilio: forbindelse", false, e.message); }

  // 5) Frisbii: hvilken konto tilhoerer den private noegle? (handle afsloerer det)
  try {
    const auth = Buffer.from(`${process.env.FRISBII_PRIVATE_KEY}:`).toString("base64");
    const res  = await fetch("https://api.reepay.com/v1/account",
      { headers: { Authorization: `Basic ${auth}` } });
    const data = res.ok ? await res.json() : null;
    check("Frisbii: noeglen hoerer til STAGING-kontoen",
      data?.handle === FRISBII_STAGING_HANDLE,
      data ? `handle="${data.handle}"` : `HTTP ${res.status} (forkert noegle?)`);
  } catch (e) { check("Frisbii: forbindelse", false, e.message); }
}

(async () => {
  if (process.argv.includes("--live")) {
    await live();
  } else {
    console.log("\nℹ️  Koer med --live efter enhver noeglerotation:");
    console.log("   node check-env.js --live");
    console.log("   (projekt/rolle for Supabase kan ikke afgoeres statisk laengere)");
  }

  console.log("\n" + (fails === 0
    ? `🏁 ALT GROENT${warns ? ` (${warns} advarsler — laes dem)` : ""} — .env peger paa staging hele vejen rundt.`
    : `⚠️  ${fails} tjek fejlede${warns ? ` (+ ${warns} advarsler)` : ""} — ret dem foer lokale koersler.`));
  process.exit(fails === 0 ? 0 : 1);
})();
