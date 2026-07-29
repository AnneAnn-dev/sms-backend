// buy-numbers.js
// -----------------------------------------------------------------------------
// Køb danske mobilnumre hos Twilio, sæt voice-webhooken i SAMME kald, og læg dem
// direkte i phone_numbers-puljen (firm_id = null = ledigt). Ingen manuel
// per-nummer-konfiguration bagefter — nummeret er klar til onboarding med det
// samme.
//
// Brug:
//   node buy-numbers.js 5 --dry-run      → vis 5 kandidater UDEN at købe (gratis)
//   DRY_RUN=1 node buy-numbers.js 5      → samme, via miljøvariabel
//   node buy-numbers.js 5                → KØB 5 numre (KOSTER penge pr. nummer)
//
// Scriptet AFVISER ukendte argumenter. Det er med vilje: en stavefejl i et
// dry-run-flag må ALDRIG resultere i et rigtigt køb.
//
// Kræver i miljøet (.env eller export):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   TWILIO_ADDRESS_SID     ← godkendt adresse (ADxxxx). DK-MOBIL kræver KUN en adresse.
//   TWILIO_SYSTEM_NUMBER   ← systemnummeret, så vagten kan holde det ude af puljen
//   VOICE_URL              ← den webhook numrene skal pege på i DETTE miljø
//   (valgfrit) TWILIO_BUNDLE_SID  ← bundle er IKKE nødvendig for DK-mobil; Twilio
//                                   afviser dem. Sættes kun hvis reglerne ændrer sig.
//   (valgfrit) SMS_URL
// -----------------------------------------------------------------------------

require("dotenv").config({ quiet: true });
const twilio = require("twilio");
const { createClient } = require("@supabase/supabase-js");

// -----------------------------------------------------------------------------
// Argumenter — FAIL-CLOSED
// -----------------------------------------------------------------------------
// Tidligere blev alt efter argv[2] ignoreret i tavshed. Det betød, at en
// stavefejl som `--dry_run` (understreg i stedet for bindestreg) blev læst som
// "køb rigtigt". Nu er reglen: alt vi ikke forstår, stopper scriptet.
const DRY_FLAGS  = new Set(["--dry-run", "--dry_run", "--dryrun", "-n"]);
const argv       = process.argv.slice(2);
const MAX_COUNT  = 10;

let COUNT   = null;
let DRY_RUN = process.env.DRY_RUN === "1";

for (const arg of argv) {
  if (DRY_FLAGS.has(arg.toLowerCase())) { DRY_RUN = true; continue; }
  if (/^\d+$/.test(arg) && COUNT === null) { COUNT = Number(arg); continue; }

  console.error(`⛔ Forstår ikke argumentet: ${arg}`);
  console.error("   Brug:  node buy-numbers.js <antal> [--dry-run]");
  console.error("   Scriptet stopper hellere end at gætte, når der er penge på spil.");
  process.exit(1);
}

if (COUNT === null) COUNT = 5;

if (COUNT < 1) {
  console.error("⛔ Antal skal være mindst 1.");
  process.exit(1);
}
if (COUNT > MAX_COUNT) {
  console.error(`⛔ Antal (${COUNT}) overstiger grænsen på ${MAX_COUNT} numre pr. kørsel.`);
  console.error("   Grænsen findes for at et ekstra ciffer ikke bliver til en stor regning.");
  console.error("   Kør scriptet flere gange, hvis du virkelig skal bruge så mange.");
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Miljø
// -----------------------------------------------------------------------------
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

// FAIL-CLOSED: mangler variablen, er vagten nedenfor reelt slået fra. Samme
// princip som VOICE_URL — beskyttelse må ikke forsvinde, netop når profilen er
// mangelfuld.
if (!SYSTEM_NUMBER) {
  console.error("⛔ TWILIO_SYSTEM_NUMBER mangler i miljøet.");
  console.error("   Uden den kan scriptet ikke garantere, at systemnummeret holdes");
  console.error("   ude af puljen. Sæt variablen i din miljøprofil og prøv igen.");
  process.exit(1);
}

(async () => {
  // ---------------------------------------------------------------------------
  // 0) Vis miljøet FØR vi bruger penge. Det er billigere at læse to linjer end
  //    at opdage bagefter, at numrene peger på det forkerte miljø.
  // ---------------------------------------------------------------------------
  console.log("=".repeat(72));
  console.log(DRY_RUN ? "DRY RUN — der købes INTET" : `KØB — ${COUNT} nummer/numre, dette koster penge`);
  console.log("  Twilio-konto:", process.env.TWILIO_ACCOUNT_SID.slice(0, 8) + "…");
  console.log("  Supabase:    ", process.env.SUPABASE_URL);
  console.log("  voiceUrl:    ", VOICE_URL);
  console.log("=".repeat(72), "\n");

  // ---------------------------------------------------------------------------
  // 1) Find ledige danske MOBIL-numre (både voice og SMS — som appen kræver)
  // ---------------------------------------------------------------------------
  const available = await client.availablePhoneNumbers("DK").mobile.list({
    smsEnabled:   true,
    voiceEnabled: true,
    limit:        COUNT,
  });

  if (!available.length) {
    console.error("Ingen ledige DK-mobilnumre fundet lige nu. Prøv igen senere.");
    process.exit(1);
  }
  console.log(`Fandt ${available.length} kandidat(er).`);

  if (DRY_RUN) {
    console.log("DRY RUN — køber INTET. Kandidater:");
    available.slice(0, COUNT).forEach((c) => console.log("  ", c.phoneNumber));
    console.log("\nKør uden --dry-run for at købe dem.");
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

  let bought  = 0;
  let fejlede = 0;

  for (const cand of available.slice(0, COUNT)) {
    try {
      // -----------------------------------------------------------------------
      // 2) Vagt FØR køb: et systemnummer skal aldrig købes ind i puljen.
      //    (Kan i praksis ikke ske — man kan ikke købe et nummer, man ejer — men
      //    vagten står før handlingen, så rækkefølgen er den samme overalt.)
      // -----------------------------------------------------------------------
      if (normalizePhone(cand.phoneNumber) === SYSTEM_NUMBER) {
        console.error(`  ⛔ ${cand.phoneNumber} er TWILIO_SYSTEM_NUMBER — springes over.`);
        continue;
      }

      // -----------------------------------------------------------------------
      // 3) Køb nummeret OG sæt webhooks i samme kald
      // -----------------------------------------------------------------------
      const num = await client.incomingPhoneNumbers.create({
        phoneNumber:  cand.phoneNumber,
        voiceUrl:     VOICE_URL,
        voiceMethod:  "POST",
        ...(SMS_URL     ? { smsUrl: SMS_URL, smsMethod: "POST" } : {}),
        ...(BUNDLE_SID  ? { bundleSid:  BUNDLE_SID }  : {}),
        addressSid:   ADDRESS_SID,
        friendlyName: `DDK pool ${cand.phoneNumber}`,
      });

      // -----------------------------------------------------------------------
      // 4) Læg i puljen (firm_id null = ledigt til næste onboarding)
      // -----------------------------------------------------------------------
      const { error } = await supabase.from("phone_numbers").insert({
        number:     num.phoneNumber,  // E.164, fx +45XXXXXXXX
        twilio_sid: num.sid,          // PNxxxx — til senere styring/frigivelse
        firm_id:    null,
      });

      if (error) {
        console.error(`  ⚠️  ${num.phoneNumber} KØBT, men DB-insert fejlede: ${error.message}`);
        console.error(`      Ret med: node configure-number.js ${num.sid}`);
        fejlede++;
      } else {
        console.log(`  ✅ ${num.phoneNumber}  (${num.sid})`);
        bought++;
      }
    } catch (err) {
      console.error(`  ❌ Kunne ikke købe ${cand.phoneNumber}: ${err.message}`);
      fejlede++;
    }
  }

  console.log(`\nFærdig — ${bought} nummer/numre lagt i puljen.`);
  if (fejlede) {
    console.log(`${fejlede} fejlede. Kør 'node afstem-numre.js' og ryd op, før du går videre.`);
    process.exit(1);
  }
  console.log("Bekræft med: node afstem-numre.js");
})().catch((err) => {
  console.error("Fejl:", err.message);
  process.exit(1);
});
