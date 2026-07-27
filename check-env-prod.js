// check-env-prod.js
// -----------------------------------------------------------------------------
// Doemmer om den lokale .env er en REN PROD-profil — modstykket til check-env.js
// (som godkender staging). Bruges FOER prod-koersler som provision-test-firm.js.
//
// Brug:
//   node check-env-prod.js          → statiske tjek (URL'er, noegleformater)
//   node check-env-prod.js --live   → + spoerger Supabase og Twilio "hvem er du?"
//
// Principper:
// - Blandede profiler (prod-database + staging-Twilio) er farligere end rene
//   fejl — derfor tjekkes ALLE akser, og een fejl = exit 1.
// - Scriptet aendrer INTET. Det laeser kun.
//
// ⚠️ OPDATERET 24/7-26 (Supabase-noeglemigrering):
// Tidligere kunne vi laese projekt-ref OG rolle ud af noeglens JWT-payload og
// afvise en staging-ref statisk. De nye noegler (sb_publishable_… / sb_secret_…)
// baerer INTET indhold. Den statiske miljoe-vagt hviler derfor nu paa
// SUPABASE_URL — og den ENDELIGE dom er --live: noeglerne er projekt-bundne,
// saa "virker mod prod-URL'en" ER beviset. En staging-noegle mod prod-URL
// giver 401 → fejler fail-closed, som vi vil have det.
// KOER ALTID --live FOER EN PROD-KOERSEL. Statisk groent er ikke laengere nok.
// -----------------------------------------------------------------------------

require("dotenv").config({ quiet: true });

const PROD_REF     = "glymuxqtrbpeyzmflilf";  // prod-Supabase-projektet
const STAGING_REF  = "hehrvdmtzokzbnbihcel";  // staging — maa IKKE optraede nogen steder
const PROD_RAILWAY = "sms-backend-production-5ee1.up.railway.app";

let fejl = 0;
let advarsler = 0;
const ok   = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); fejl++; };
const warn = (m) => { console.log(`  ⚠️  ${m}`); advarsler++; };
const info = (m) => console.log(`  ℹ️  ${m}`);

// Hvilken slags Supabase-noegle er det? (uden at afsloere vaerdien)
function noegleType(v) {
  if (!v)                              return "mangler";
  if (v.startsWith("sb_secret_"))      return "secret";
  if (v.startsWith("sb_publishable_")) return "publishable";
  if (v.startsWith("eyJ"))             return "legacy-jwt";
  return "ukendt";
}

console.log("\n🔎 check-env-prod — er .env en ren PROD-profil?\n");

// ── Supabase ────────────────────────────────────────────────────────────────
console.log("Supabase:");
const su = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
{
  if (!su) fail("SUPABASE_URL mangler");
  else if (su.includes(STAGING_REF)) fail("SUPABASE_URL peger paa STAGING — forkert profil!");
  else if (!su.includes(PROD_REF)) fail(`SUPABASE_URL peger paa ukendt projekt: ${su}`);
  else ok(`SUPABASE_URL: prod (${PROD_REF})`);
}

const srk     = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const srkType = noegleType(srk);
if (srkType === "secret") ok("SUPABASE_SERVICE_ROLE_KEY: ny secret-noegle (projekt afgoeres af --live)");
else if (srkType === "legacy-jwt") fail("SUPABASE_SERVICE_ROLE_KEY: LEGACY JWT — deaktiveret 24/7-26, hent en sb_secret_… i dashboardet");
else if (srkType === "publishable") fail("SUPABASE_SERVICE_ROLE_KEY: det er en PUBLISHABLE-noegle — ingen service-adgang");
else fail(`SUPABASE_SERVICE_ROLE_KEY: ${srkType === "mangler" ? "mangler" : "ukendt format"}`);

const anon     = process.env.SUPABASE_ANON_KEY || "";
const anonType = noegleType(anon);
if (anonType === "publishable") ok("SUPABASE_ANON_KEY: ny publishable-noegle");
else if (anonType === "secret") fail("SUPABASE_ANON_KEY: 🚨 DET ER EN SECRET-NOEGLE! app-config.js serverer den til BROWSEREN → RLS-bypass i PROD. SKIFT STRAKS.");
else if (anonType === "legacy-jwt") fail("SUPABASE_ANON_KEY: LEGACY JWT — deaktiveret 24/7-26, hent en sb_publishable_… i dashboardet");
else fail(`SUPABASE_ANON_KEY: ${anonType === "mangler" ? "mangler" : "ukendt format"}`);

info("Noeglerne baerer ikke laengere projekt-ref — kun --live kan bevise, at de hoerer til PROD");

// ── URL'er ──────────────────────────────────────────────────────────────────
console.log("\nURL'er:");
{
  const base = (process.env.BASE_URL || "").replace(/\/$/, "");
  if (!base) fail("BASE_URL mangler");
  else if (/staging/i.test(base)) fail(`BASE_URL ligner staging: ${base}`);
  else ok(`BASE_URL: ${base} (verificer selv at det er prod-domaenet)`);

  const voice = process.env.VOICE_URL || "";
  if (!voice) warn("VOICE_URL mangler — kun paakraevet for nummer-scripts (buy/configure)");
  else if (/staging/i.test(voice)) fail(`VOICE_URL peger paa staging: ${voice}`);
  else if (!voice.includes(PROD_RAILWAY)) warn(`VOICE_URL er hverken staging eller kendt prod-URL: ${voice}`);
  else ok("VOICE_URL: prod (/opkald)");
}

// ── Twilio ──────────────────────────────────────────────────────────────────
console.log("\nTwilio (statisk — koer --live for facit):");
{
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  if (!sid) fail("TWILIO_ACCOUNT_SID mangler");
  else if (!/^AC[0-9a-f]{32}$/i.test(sid)) fail(`TWILIO_ACCOUNT_SID ligner ikke en konto-SID: ${sid.slice(0, 6)}…`);
  else info(`TWILIO_ACCOUNT_SID: ${sid.slice(0, 8)}… (hoved- vs subkonto kan kun --live afgoere)`);

  const tok = process.env.TWILIO_AUTH_TOKEN || "";
  if (!tok) fail("TWILIO_AUTH_TOKEN mangler");
  else if (tok.length !== 32 || /\s/.test(tok)) fail(`TWILIO_AUTH_TOKEN ser forkert ud (laengde=${tok.length})`);
  else info("TWILIO_AUTH_TOKEN: 32 tegn — HUSK: hoved- og subkonto har HVER sit token");

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
    info("APPSIGNAL_APP_ENV=production → MAIL_OVERRIDE_TO er INAKTIV: mails gaar til AEGTE modtagere.");
    info("Det er meningen ved pilot-provisionering (velkomstmailen skal naa piloten) — men vid det.");
  } else {
    warn(`APPSIGNAL_APP_ENV='${env}' → mail-override AKTIV${override ? ` (alt gaar til ${override})` : ""}. En prod-profil har normalt 'production' her.`);
  }
}

// ── Live-tjek ───────────────────────────────────────────────────────────────
async function supaFetch(path, key) {
  const url = `${su}${path}`;
  let res = await fetch(url, { headers: { apikey: key } });
  if (res.status === 401) {
    res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  }
  return res;
}

(async () => {
  if (process.argv.includes("--live")) {
    console.log("\nLive-tjek:");

    // 1) Hoerer secret-noeglen til PROD-projektet? (projekt-bundet → succes = bevis)
    try {
      const res = await supaFetch("/rest/v1/firms?select=id&limit=1", srk);
      res.ok ? ok(`Supabase: secret-noeglen kan laese firms i PROD (${PROD_REF})`)
             : fail(`Supabase: secret-noeglen afvist (HTTP ${res.status}) — deaktiveret legacy-noegle, eller noegle fra et ANDET projekt`);
    } catch (e) { fail(`Supabase unreachable: ${e.message}`); }

    // 2) Er det virkelig service-niveau? (admin-endpointet svarer kun paa service)
    try {
      const res = await supaFetch("/auth/v1/admin/users?page=1&per_page=1", srk);
      res.ok ? ok("Supabase: secret-noeglen har service-niveau (admin-adgang)")
             : fail(`Supabase: secret-noeglen har IKKE service-niveau (HTTP ${res.status})`);
    } catch (e) { fail(`Supabase admin-tjek: ${e.message}`); }

    // 3) Sikkerhedstjek: anon-noeglen maa ALDRIG have admin-adgang
    try {
      const res = await supaFetch("/auth/v1/admin/users?page=1&per_page=1", anon);
      res.ok ? fail("Supabase: 🚨 anon-noeglen HAR admin-adgang — der ligger en SECRET-noegle i ANON-variablen (og den serveres til browseren i PROD)")
             : ok(`Supabase: anon-noeglen er uden admin-adgang (HTTP ${res.status} — sikker i browseren)`);
    } catch (e) { fail(`Supabase anon-sikkerhedstjek: ${e.message}`); }

    // 4) Twilio: hvem er du? (friendly name afgoer hoved- vs subkonto)
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
        headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64") },
      });
      if (!r.ok) fail(`Twilio svarede ${r.status} — SID og token skal komme fra SAMME konto (hver konto har sit eget auth-token)`);
      else {
        const konto = await r.json();
        /staging/i.test(konto.friendly_name || "")
          ? fail(`Twilio-kontoen hedder '${konto.friendly_name}' — det er SUBKONTOEN (staging)!`)
          : ok(`Twilio-konto: '${konto.friendly_name}' (verificer selv: er det HOVEDKONTOEN?)`);
      }
    } catch (e) { fail(`Twilio unreachable: ${e.message}`); }
  } else {
    console.log("\n  ℹ️  Koer med --live foer enhver prod-koersel:  node check-env-prod.js --live");
    console.log("     (projekt/rolle for Supabase kan ikke afgoeres statisk laengere)");
  }

  console.log("\n────────────────────────────────────────");
  if (fejl) {
    console.log(`❌ ${fejl} fejl${advarsler ? ` (+ ${advarsler} advarsler)` : ""} — .env er IKKE en ren prod-profil. Koer INTET mod prod.`);
    process.exit(1);
  }
  console.log(`✅ Ren prod-profil${advarsler ? ` (${advarsler} advarsler — laes dem)` : ""}. Husk: skift TILBAGE til staging bagefter (check-env.js skal melde groent igen).`);
})();
