// check-env-prod.js
// -----------------------------------------------------------------------------
// Doemmer om den lokale .env er en REN PROD-profil — modstykket til check-env.js
// (som godkender staging). Bruges FOER prod-koersler som provision-test-firm.js.
//
// Brug:
//   node check-env-prod.js          → statiske tjek (JWT-refs, roller, URL'er)
//   node check-env-prod.js --live   → + spoerger Supabase og Twilio "hvem er du?"
//
// Principper:
// - Supabase-noegler er JWT'er med projekt-ref OG rolle indbygget → vi laeser
//   dem direkte i stedet for at gaette. En staging-ref NOGET sted = FEJL.
// - Blandede profiler (prod-database + staging-Twilio) er farligere end rene
//   fejl — derfor tjekkes ALLE akser, og een fejl = exit 1.
// - Scriptet aendrer INTET. Det laeser kun.
// -----------------------------------------------------------------------------

require("dotenv").config({ quiet: true });

const PROD_REF    = "glymuxqtrbpeyzmflilf";  // prod-Supabase-projektet
const STAGING_REF = "hehrvdmtzokzbnbihcel";  // staging — maa IKKE optraede nogen steder
const PROD_RAILWAY = "sms-backend-production-5ee1.up.railway.app";

let fejl = 0;
let advarsler = 0;
const ok   = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); fejl++; };
const warn = (m) => { console.log(`  ⚠️  ${m}`); advarsler++; };
const info = (m) => console.log(`  ℹ️  ${m}`);

// JWT-payload uden verifikation (vi laeser kun ref/rolle, signaturen er Supabases sag)
function jwtPayload(token) {
  try {
    const p = token.split(".")[1];
    return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch { return null; }
}

function tjekSupabaseNoegle(navn, forventetRolle) {
  const v = process.env[navn];
  if (!v) return fail(`${navn} mangler`);
  const p = jwtPayload(v);
  if (!p) return fail(`${navn}: ikke en laesbar JWT`);
  if (p.ref === STAGING_REF) return fail(`${navn}: peger paa STAGING (${p.ref}) — forkert profil!`);
  if (p.ref !== PROD_REF)    return fail(`${navn}: ukendt projekt-ref '${p.ref}' (forventede ${PROD_REF})`);
  if (p.role !== forventetRolle) return fail(`${navn}: rolle '${p.role}' (forventede '${forventetRolle}')`);
  ok(`${navn}: prod-ref + rolle '${forventetRolle}'`);
}

console.log("\n🔎 check-env-prod — er .env en ren PROD-profil?\n");

// ── Supabase ────────────────────────────────────────────────────────────────
console.log("Supabase:");
{
  const url = process.env.SUPABASE_URL || "";
  if (!url) fail("SUPABASE_URL mangler");
  else if (url.includes(STAGING_REF)) fail(`SUPABASE_URL peger paa STAGING`);
  else if (!url.includes(PROD_REF)) fail(`SUPABASE_URL peger paa ukendt projekt: ${url}`);
  else ok(`SUPABASE_URL: prod (${PROD_REF})`);
}
tjekSupabaseNoegle("SUPABASE_SERVICE_ROLE_KEY", "service_role");
tjekSupabaseNoegle("SUPABASE_ANON_KEY", "anon");

// ── URL'er ──────────────────────────────────────────────────────────────────
console.log("\nURL'er:");
{
  const base = process.env.BASE_URL || "";
  if (!base) fail("BASE_URL mangler");
  else if (/staging/i.test(base)) fail(`BASE_URL ligner staging: ${base}`);
  else ok(`BASE_URL: ${base} (verificer selv at det er prod-domaenet)`);

  const voice = process.env.VOICE_URL || "";
  if (!voice) warn("VOICE_URL mangler — kun paakraevet for nummer-scripts (buy/configure)");
  else if (/staging/i.test(voice)) fail(`VOICE_URL peger paa staging: ${voice}`);
  else if (!voice.includes(PROD_RAILWAY)) warn(`VOICE_URL er hverken staging eller kendt prod-URL: ${voice}`);
  else ok(`VOICE_URL: prod (/opkald)`);
}

// ── Twilio ──────────────────────────────────────────────────────────────────
console.log("\nTwilio (statisk — koer --live for facit):");
{
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  if (!sid) fail("TWILIO_ACCOUNT_SID mangler");
  else if (!sid.startsWith("AC")) fail(`TWILIO_ACCOUNT_SID ligner ikke en konto-SID: ${sid.slice(0, 6)}…`);
  else info(`TWILIO_ACCOUNT_SID: ${sid.slice(0, 8)}… (hoved- vs subkonto kan kun --live afgoere)`);
  if (!process.env.TWILIO_AUTH_TOKEN) fail("TWILIO_AUTH_TOKEN mangler");

  const sys = process.env.TWILIO_SYSTEM_NUMBER || "";
  if (!sys) fail("TWILIO_SYSTEM_NUMBER mangler (scriptenes systemnummer-vagt koerer ellers stumt)");
  else if (!/^\+45\d{8}$/.test(sys)) warn(`TWILIO_SYSTEM_NUMBER ikke E.164 DK-format: '${sys}'`);
  else ok(`TWILIO_SYSTEM_NUMBER: ${sys} (prods systemnummer bor i HOVEDKONTOEN)`);
}

// ── Mail-adfaerd (informativt, ikke en fejl) ────────────────────────────────
console.log("\nMail-adfaerd:");
{
  const env = process.env.APPSIGNAL_APP_ENV || "(ikke sat)";
  const override = process.env.MAIL_OVERRIDE_TO;
  if (env === "production") {
    info(`APPSIGNAL_APP_ENV=production → MAIL_OVERRIDE_TO er INAKTIV: mails gaar til AEGTE modtagere.`);
    info(`Det er meningen ved pilot-provisionering (velkomstmailen skal naa piloten) — men vid det.`);
  } else {
    warn(`APPSIGNAL_APP_ENV='${env}' → mail-override AKTIV${override ? ` (alt gaar til ${override})` : ""}. En prod-profil har normalt 'production' her.`);
  }
}

// ── Live-tjek ───────────────────────────────────────────────────────────────
(async () => {
  if (process.argv.includes("--live")) {
    console.log("\nLive-tjek:");
    // Supabase: svarer prod-projektet paa anon-noeglen?
    try {
      const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/health`, {
        headers: { apikey: process.env.SUPABASE_ANON_KEY || "" },
      });
      r.ok ? ok(`Supabase ${PROD_REF} svarer (auth health ${r.status})`)
           : fail(`Supabase health svarede ${r.status} — noegle/URL-mismatch?`);
    } catch (e) { fail(`Supabase unreachable: ${e.message}`); }

    // Twilio: hvem er du? (friendly name afgoer hoved- vs subkonto)
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
        headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64") },
      });
      if (!r.ok) fail(`Twilio svarede ${r.status} — forkerte credentials?`);
      else {
        const konto = await r.json();
        /staging/i.test(konto.friendly_name || "")
          ? fail(`Twilio-kontoen hedder '${konto.friendly_name}' — det er SUBKONTOEN (staging)!`)
          : ok(`Twilio-konto: '${konto.friendly_name}' (verificer selv: er det HOVEDKONTOEN?)`);
      }
    } catch (e) { fail(`Twilio unreachable: ${e.message}`); }
  }

  console.log("\n────────────────────────────────────────");
  if (fejl) {
    console.log(`❌ ${fejl} fejl${advarsler ? ` (+ ${advarsler} advarsler)` : ""} — .env er IKKE en ren prod-profil. Koer INTET mod prod.`);
    process.exit(1);
  }
  console.log(`✅ Ren prod-profil${advarsler ? ` (${advarsler} advarsler — laes dem)` : ""}. Husk: skift TILBAGE til staging bagefter (check-env.js skal melde groent igen).`);
})();
