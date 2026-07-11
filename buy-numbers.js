// buy-numbers.js
// -----------------------------------------------------------------------------
// Køb danske mobilnumre hos Twilio, sæt voice-webhooken i SAMME kald, og læg dem
// direkte i phone_numbers-puljen (firm_id = null = ledigt). Ingen manuel
// per-nummer-konfiguration.
//
// Brug:
//   DRY_RUN=1 node buy-numbers.js 5      → vis 5 kandidater UDEN at købe (gratis)
//   node buy-numbers.js 5                → køb 5 numre (KOSTER penge pr. nummer)
//
// Kræver i miljøet (.env eller export):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   TWILIO_ADDRESS_SID   ← godkendt adresse (ADxxxx). DK-MOBIL kræver KUN en adresse.
//   (valgfrit) TWILIO_BUNDLE_SID  ← bundle er IKKE nødvendig for DK-mobil; Twilio
//                                   afviser dem. Sættes kun hvis reglerne ændrer sig.
//   (valgfrit) VOICE_URL, SMS_URL
// -----------------------------------------------------------------------------

require("dotenv").config({ quiet: true });
const twilio = require("twilio");
const { createClient } = require("@supabase/supabase-js");

const COUNT       = Number(process.argv[2] || 5);
const DRY_RUN     = process.env.DRY_RUN === "1";
// VOICE_URL er BEVIDST uden fallback: en hardcodet default ville i tavshed
// pege numre paa det forkerte miljoe, hvis .env mangler variablen. Scriptet
// naegter i stedet at koere (fail-closed, samme princip som MAIL_OVERRIDE_TO).
// Saet i miljoeprofilen: staging -> .../sms-backend-staging-908c.up.railway.app/opkald
//                        prod    -> .../sms-backend-production-5ee1.up.railway.app/opkald
const VOICE_URL   = process.env.VOICE_URL;
const SMS_URL     = process.env.SMS_URL || "";            // sæt kun hvis du har en indgående SMS-handler
const BUNDLE_SID  = process.env.TWILIO_BUNDLE_SID || undefined;   // BUxxxx — IKKE nødvendig for DK-mobil
const ADDRESS_SID = process.env.TWILIO_ADDRESS_SID || undefined;  // ADxxxx — PÅKRÆVET for DK-mobil

for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VOICE_URL"]) {
  if (!process.env[k]) { console.error(`Mangler ${k} i miljøet.`); process.exit(1); }
}

const client   = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Systemnummeret må ALDRIG ende i puljen (ellers kunne det tildeles en kunde).
const { normalizePhone } = require("./phone");
const SYSTEM_NUMBER = normalizePhone(process.env.TWILIO_SYSTEM_NUMBER);

(async () => {
  // 1) Find ledige danske MOBIL-numre (både voice og SMS — som appen kræver)
  const available = await client.availablePhoneNumbers("DK").mobile.list({
    smsEnabled:   true,
    voiceEnabled: true,
    limit:        COUNT,
  });

  if (!available.length) {
    console.error("Ingen ledige DK-mobilnumre fundet lige nu. Prøv igen senere.");
    return;
  }
  console.log(`Fandt ${available.length} kandidat(er).`);

  if (DRY_RUN) {
    console.log("DRY RUN — køber INTET. Kandidater:");
    available.slice(0, COUNT).forEach((c) => console.log("  ", c.phoneNumber));
    return;
  }

  // DK-mobil kræver en godkendt adresse (men ingen bundle). Uden adresse vil
  // HVERT køb fejle hos Twilio — så vi stopper her i stedet for at spilde forsøg.
  if (!ADDRESS_SID) {
    console.error("⛔ TWILIO_ADDRESS_SID mangler — DK-mobilnumre kræver en godkendt adresse.");
    console.error("   Opret/find den i Console > Phone Numbers > Regulatory Compliance > Addresses");
    console.error("   (husk Customer Name, ingen postboks), og læg AD-SID'et i din .env.");
    process.exit(1);
  }

  let bought = 0;
  for (const cand of available.slice(0, COUNT)) {
    try {
      // 2) Køb nummeret OG sæt webhooks i samme kald
      const num = await client.incomingPhoneNumbers.create({
        phoneNumber:  cand.phoneNumber,
        voiceUrl:     VOICE_URL,
        voiceMethod:  "POST",
        ...(SMS_URL     ? { smsUrl: SMS_URL, smsMethod: "POST" } : {}),
        ...(BUNDLE_SID  ? { bundleSid:  BUNDLE_SID }  : {}),
        addressSid:   ADDRESS_SID,
        friendlyName: `DDK pool ${cand.phoneNumber}`,
      });

      // 3) Vagt: læg ALDRIG systemnummeret i puljen
      if (SYSTEM_NUMBER && normalizePhone(num.phoneNumber) === SYSTEM_NUMBER) {
        console.error(`  ⛔ ${num.phoneNumber} er TWILIO_SYSTEM_NUMBER — lægges IKKE i puljen.`);
        continue;
      }

      // 4) Læg i puljen (firm_id null = ledigt til næste onboarding)
      const { error } = await supabase.from("phone_numbers").insert({
        number:     num.phoneNumber,  // E.164, fx +45XXXXXXXX
        twilio_sid: num.sid,          // PNxxxx — til senere styring/frigivelse
        firm_id:    null,
      });

      if (error) {
        console.error(`  ⚠️  ${num.phoneNumber} KØBT, men DB-insert fejlede: ${error.message}`);
        console.error(`      Læg det manuelt i phone_numbers (sid ${num.sid}).`);
      } else {
        console.log(`  ✅ ${num.phoneNumber}  (${num.sid})`);
        bought++;
      }
    } catch (err) {
      console.error(`  ❌ Kunne ikke købe ${cand.phoneNumber}: ${err.message}`);
    }
  }

  console.log(`Færdig — ${bought} nummer/numre lagt i puljen.`);
})();
