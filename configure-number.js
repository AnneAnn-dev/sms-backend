// configure-number.js
// -----------------------------------------------------------------------------
// Sæt voice-webhooken på et ALLEREDE KØBT nummer (købt manuelt i konsollen) og
// læg det i phone_numbers-puljen. Til numre der ikke gik gennem buy-numbers.js.
//
// Brug:
//   node configure-number.js PN83d9ffceaa14d7b15ee3ec1af6b5316d
//
// Tager nummerets PN-SID (står på nummerets side i konsollen). Henter selv
// E.164-nummeret fra Twilio, så du ikke kan stave det forkert.
//
// Kræver i .env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SUPABASE_URL,
//                SUPABASE_SERVICE_ROLE_KEY
// -----------------------------------------------------------------------------

require("dotenv").config();
const twilio = require("twilio");
const { createClient } = require("@supabase/supabase-js");

const SID       = process.argv[2];
const VOICE_URL = process.env.VOICE_URL || "https://sms-backend-production-5ee1.up.railway.app/opkald";

if (!SID || !SID.startsWith("PN")) {
  console.error("Angiv nummerets PN-SID, fx:\n  node configure-number.js PN83d9ffceaa...");
  process.exit(1);
}
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) { console.error(`Mangler ${k} i miljøet.`); process.exit(1); }
}

const client   = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Systemnummeret må ALDRIG ende i puljen (ellers kunne det tildeles en kunde).
const { normalizePhone } = require("./phone");
const SYSTEM_NUMBER = normalizePhone(process.env.TWILIO_SYSTEM_NUMBER);

(async () => {
  // 1) Sæt voice-webhooken på nummeret (+ tydelig friendlyName, så det er let at
  //    se i konsollen at nummeret hører til pulje-rollen).
  const num = await client.incomingPhoneNumbers(SID).update({
    voiceUrl:     VOICE_URL,
    voiceMethod:  "POST",
    friendlyName: `LommeKontor pool ${SID}`,
  });
  console.log(`✅ Voice-webhook sat på ${num.phoneNumber} → ${VOICE_URL}`);

  // 2) Vagt: læg ALDRIG systemnummeret i puljen
  if (SYSTEM_NUMBER && normalizePhone(num.phoneNumber) === SYSTEM_NUMBER) {
    console.error(`⛔ ${num.phoneNumber} er TWILIO_SYSTEM_NUMBER — lægges IKKE i puljen.`);
    console.error("   (Voice-webhooken er sat, men nummeret holdes ude af puljen med vilje.)");
    return;
  }

  // 3) Læg i puljen (firm_id null = ledigt). Undgå dublet hvis det allerede ligger der.
  const { data: existing } = await supabase
    .from("phone_numbers")
    .select("id")
    .eq("number", num.phoneNumber)
    .maybeSingle();

  if (existing) {
    console.log("ℹ️  Nummeret ligger allerede i puljen — springer insert over.");
    return;
  }

  const { error } = await supabase.from("phone_numbers").insert({
    number:     num.phoneNumber,
    twilio_sid: num.sid,
    firm_id:    null,
  });
  if (error) {
    console.error("⚠️  Voice-webhook er sat, men DB-insert fejlede:", error.message);
    console.error("   (Læg nummeret manuelt i phone_numbers.)");
  } else {
    console.log(`✅ Lagt i puljen som ledigt (${num.sid})`);
  }
})();
