// configure-number.js
// -----------------------------------------------------------------------------
// Sæt voice-webhooken på et ALLEREDE KØBT nummer (købt manuelt i konsollen) og
// læg det i phone_numbers-puljen. Til numre der ikke gik gennem buy-numbers.js.
//
// Brug:
//   node configure-number.js PNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//
// Tager nummerets PN-SID (står på nummerets side i konsollen). Henter selv
// E.164-nummeret fra Twilio, så du ikke kan stave det forkert.
//
// Kræver i .env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SUPABASE_URL,
//                SUPABASE_SERVICE_ROLE_KEY, VOICE_URL
//                (valgfrit, men stærkt anbefalet: TWILIO_SYSTEM_NUMBER)
// -----------------------------------------------------------------------------

require("dotenv").config({ quiet: true });
const twilio = require("twilio");
const { createClient } = require("@supabase/supabase-js");

const SID       = process.argv[2];
// VOICE_URL er BEVIDST uden fallback: en hardcodet default ville i tavshed
// pege nummeret paa det forkerte miljoe, hvis .env mangler variablen. Scriptet
// naegter i stedet at koere (fail-closed, samme princip som MAIL_OVERRIDE_TO).
const VOICE_URL = process.env.VOICE_URL;

if (!SID || !SID.startsWith("PN")) {
  console.error("Angiv nummerets PN-SID, fx:\n  node configure-number.js PNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  process.exit(1);
}
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VOICE_URL"]) {
  if (!process.env[k]) { console.error(`Mangler ${k} i miljøet.`); process.exit(1); }
}

const client   = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Systemnummeret må ALDRIG ende i puljen (ellers kunne det tildeles en kunde).
const { normalizePhone } = require("./phone");
const SYSTEM_NUMBER = normalizePhone(process.env.TWILIO_SYSTEM_NUMBER);

// Vagten er FAIL-CLOSED: mangler TWILIO_SYSTEM_NUMBER i miljøet, kan vi ikke
// vide, om SID'et peger på systemnummeret — og så nægter scriptet at køre i
// stedet for at fortsætte uden beskyttelse. (Tidligere sprang vagten bare over,
// hvilket betød ingen beskyttelse netop når profilen var mangelfuld.)
if (!SYSTEM_NUMBER) {
  console.error("⛔ TWILIO_SYSTEM_NUMBER mangler i miljøet.");
  console.error("   Uden den kan scriptet ikke garantere, at systemnummeret holdes");
  console.error("   ude af puljen. Sæt variablen i din miljøprofil og prøv igen.");
  process.exit(1);
}

(async () => {
  // ---------------------------------------------------------------------------
  // 1) LÆS FØRST. Hent nummeret uden at ændre noget, så vagten kan nå at sige
  //    fra, INDEN vi rører Twilio. Rækkefølgen er hele pointen: et update-kald
  //    kan ikke rulles tilbage, og et overskrevet voiceUrl på systemnummeret
  //    ville sende systemopkald ind i pulje-flowet.
  // ---------------------------------------------------------------------------
  const eksisterende = await client.incomingPhoneNumbers(SID).fetch();
  const nummer       = eksisterende.phoneNumber;

  console.log(`Nummer:        ${nummer}`);
  console.log(`Nuværende URL: ${eksisterende.voiceUrl || "(tom)"}`);
  console.log(`Ny URL:        ${VOICE_URL}\n`);

  // ---------------------------------------------------------------------------
  // 2) VAGT — før enhver skrivning, hverken hos Twilio eller i databasen.
  // ---------------------------------------------------------------------------
  if (normalizePhone(nummer) === SYSTEM_NUMBER) {
    console.error(`⛔ ${nummer} er TWILIO_SYSTEM_NUMBER.`);
    console.error("   Der er IKKE rørt ved nummeret — hverken webhook, friendlyName");
    console.error("   eller database. Systemnummeret hører ikke til i puljen.");
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 3) Sæt voice-webhooken (+ tydelig friendlyName med selve nummeret, så det er
  //    let at se i konsollen at nummeret hører til pulje-rollen — samme format
  //    som buy-numbers.js bruger).
  // ---------------------------------------------------------------------------
  const num = await client.incomingPhoneNumbers(SID).update({
    voiceUrl:     VOICE_URL,
    voiceMethod:  "POST",
    friendlyName: `DDK pool ${nummer}`,
  });
  console.log(`✅ Voice-webhook sat på ${num.phoneNumber} → ${VOICE_URL}`);

  // ---------------------------------------------------------------------------
  // 4) Læg i puljen (firm_id null = ledigt). Undgå dublet hvis det allerede
  //    ligger der.
  // ---------------------------------------------------------------------------
  const { data: existing, error: lookupError } = await supabase
    .from("phone_numbers")
    .select("id, firm_id")
    .eq("number", num.phoneNumber)
    .maybeSingle();

  if (lookupError) {
    console.error("⚠️  Voice-webhook er sat, men opslag i phone_numbers fejlede:", lookupError.message);
    console.error("   Tjek selv om nummeret allerede ligger i puljen, før du indsætter.");
    process.exit(1);
  }

  if (existing) {
    const status = existing.firm_id ? `TILDELT firm_id=${existing.firm_id}` : "ledigt";
    console.log(`ℹ️  Nummeret ligger allerede i puljen (${status}) — springer insert over.`);
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
    process.exit(1);
  } else {
    console.log(`✅ Lagt i puljen som ledigt (${num.sid})`);
  }
})().catch((err) => {
  console.error("Fejl:", err.message);
  process.exit(1);
});
