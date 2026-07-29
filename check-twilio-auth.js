// check-twilio-auth.js
// -----------------------------------------------------------------------------
// Diagnose af 401/20003. Rører INTET — henter kun kontoens egen ressource og
// printer Twilios rå svar, som indeholder den faktiske årsag (suspenderet konto
// vs. forkerte credentials giver forskellige beskeder i body'en).
//
// Brug:  node check-twilio-auth.js
// -----------------------------------------------------------------------------

require("dotenv").config({ quiet: true });

const SID   = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;

if (!SID || !TOKEN) {
  console.error("Mangler TWILIO_ACCOUNT_SID og/eller TWILIO_AUTH_TOKEN i miljøet.");
  process.exit(1);
}

// Fingeraftryk uden at lække hemmeligheder — så du kan se OM det er den nøgle,
// du tror, uden at have tokenet i terminal-historikken.
const mask = (s) => `${s.slice(0, 4)}…${s.slice(-4)} (længde ${s.length})`;
console.log("SID:   ", mask(SID), SID.startsWith("AC") ? "" : "⚠️ starter ikke med AC");
console.log("TOKEN: ", mask(TOKEN), TOKEN.length === 32 ? "" : "⚠️ auth tokens er normalt 32 tegn");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL || "(ikke sat)");
console.log("VOICE_URL:   ", process.env.VOICE_URL   || "(ikke sat)");
console.log("");

(async () => {
  const auth = Buffer.from(`${SID}:${TOKEN}`).toString("base64");
  const res  = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}.json`, {
    headers: { Authorization: `Basic ${auth}` },
  });

  const body = await res.text();
  console.log("HTTP-status:", res.status);
  console.log("Svar:", body);

  if (res.ok) {
    const acct = JSON.parse(body);
    console.log(`\nKontostatus: ${acct.status}   (type: ${acct.type})`);
    if (acct.status !== "active") {
      console.log("⛔ Kontoen er IKKE aktiv — det er årsagen til 20003, ikke nøglen.");
    } else {
      console.log("✅ Kontoen er aktiv og nøglen virker. Så var 401'eren miljø-/profilrelateret.");
    }
  } else {
    console.log("\n→ 401 her betyder enten forkert token ELLER suspenderet konto.");
    console.log("  Log ind på console.twilio.com og se efter banner øverst.");
  }
})();