// afstem-numre.js
// -----------------------------------------------------------------------------
// Afstemning mellem Twilios FAKTISKE nummerbeholdning og phone_numbers-puljen.
//
// Scriptet SKRIVER INTET — hverken hos Twilio eller i Supabase. Det læser begge
// sider, sammenligner, og printer hvad der ikke stemmer. Alle rettelser laver du
// selv bagefter, med åbne øjne.
//
// Brug:
//   node afstem-numre.js
//
// Kræver i miljøet (samme profil som buy-numbers.js):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   VOICE_URL              ← den webhook numrene BØR pege på i dette miljø
//   (valgfrit) TWILIO_SYSTEM_NUMBER
//
// VIGTIGT: scriptet afstemmer den Twilio-konto og den Supabase-database, som din
// AKTUELLE profil peger på. Kører du med staging-profilen, sammenligner du mod
// staging-databasen. Derfor printes begge adresser øverst — LÆS DEM.
// -----------------------------------------------------------------------------

require("dotenv").config({ quiet: true });
const twilio = require("twilio");
const { createClient } = require("@supabase/supabase-js");
const { normalizePhone } = require("./phone");

for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VOICE_URL"]) {
  if (!process.env[k]) { console.error(`Mangler ${k} i miljøet.`); process.exit(1); }
}

const VOICE_URL     = process.env.VOICE_URL;
const SYSTEM_NUMBER = normalizePhone(process.env.TWILIO_SYSTEM_NUMBER);

const client   = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Findings samles op, så vi kan give en samlet dom til sidst i stedet for at
// drukne signalet i løbende output.
const problemer = [];
const note = (linje) => problemer.push(linje);

(async () => {
  console.log("=".repeat(72));
  console.log("AFSTEMNING AF NUMRE — læs disse to linjer, før du læser resten:");
  console.log("  Supabase:  ", process.env.SUPABASE_URL);
  console.log("  Forventet voiceUrl:", VOICE_URL);
  console.log("  Twilio-konto:", process.env.TWILIO_ACCOUNT_SID.slice(0, 8) + "…");
  console.log("=".repeat(72), "\n");

  // ---------------------------------------------------------------------------
  // 1) Hent begge sider
  // ---------------------------------------------------------------------------
  const twilioNumre = await client.incomingPhoneNumbers.list({ limit: 1000 });

  const { data: dbNumre, error } = await supabase
    .from("phone_numbers")
    .select("id, number, twilio_sid, firm_id")
    .order("number");

  if (error) {
    console.error("Kunne ikke læse phone_numbers:", error.message);
    process.exit(1);
  }

  console.log(`Twilio:   ${twilioNumre.length} nummer/numre på kontoen`);
  console.log(`Supabase: ${dbNumre.length} række(r) i phone_numbers\n`);

  // Indeksér begge sider på normaliseret nummer, så sammenligningen ikke falder
  // over formatforskelle (+45 vs 45 vs mellemrum).
  const twilioMap = new Map();
  for (const n of twilioNumre) twilioMap.set(normalizePhone(n.phoneNumber), n);

  const dbMap = new Map();
  const dubletter = [];
  for (const r of dbNumre) {
    const key = normalizePhone(r.number);
    if (dbMap.has(key)) dubletter.push(r.number);
    else dbMap.set(key, r);
  }

  // ---------------------------------------------------------------------------
  // 2) SPØGELSER: ligger i puljen, findes ikke hos Twilio
  //    Det farligste af alt — onboarding kan tildele en kunde et dødt nummer.
  // ---------------------------------------------------------------------------
  console.log("── Spøgelser (i puljen, men IKKE hos Twilio) ".padEnd(72, "─"));
  let spoegelser = 0;
  for (const [key, r] of dbMap) {
    if (!twilioMap.has(key)) {
      const tildelt = r.firm_id ? `TILDELT firm_id=${r.firm_id}` : "ledigt";
      console.log(`  ❌ ${r.number}  (${tildelt})  db-id=${r.id}`);
      note(`Spøgelse: ${r.number} findes ikke hos Twilio, men ligger i puljen${r.firm_id ? " OG er tildelt et firma" : ""}.`);
      spoegelser++;
    }
  }
  if (!spoegelser) console.log("  ✅ ingen");
  console.log("");

  // ---------------------------------------------------------------------------
  // 3) FORÆLDRELØSE: købt hos Twilio, men ikke i puljen
  //    Du betaler abonnement for numre, ingen kan få tildelt.
  // ---------------------------------------------------------------------------
  console.log("── Forældreløse (hos Twilio, men IKKE i puljen) ".padEnd(72, "─"));
  let foraeldreloese = 0;
  for (const [key, n] of twilioMap) {
    if (dbMap.has(key)) continue;
    if (SYSTEM_NUMBER && key === SYSTEM_NUMBER) {
      console.log(`  ℹ️  ${n.phoneNumber}  systemnummer — skal IKKE i puljen, alt vel`);
      continue;
    }
    console.log(`  ⚠️  ${n.phoneNumber}  (${n.sid})  "${n.friendlyName}"`);
    note(`Forældreløst: ${n.phoneNumber} koster abonnement, men er ikke i puljen.`);
    foraeldreloese++;
  }
  if (!foraeldreloese) console.log("  ✅ ingen");
  console.log("");

  // ---------------------------------------------------------------------------
  // 4) FORKERT WEBHOOK: nummeret findes begge steder, men ringer det rigtige sted hen?
  //    Det her er fejlen, der ikke larmer: nummeret ser rigtigt ud i puljen,
  //    men opkald lander i et andet miljø — eller ingen steder.
  // ---------------------------------------------------------------------------
  console.log("── Webhook-afvigelser ".padEnd(72, "─"));
  let webhookfejl = 0;
  for (const [key, r] of dbMap) {
    const n = twilioMap.get(key);
    if (!n) continue;

    if (n.voiceUrl !== VOICE_URL) {
      console.log(`  ⚠️  ${r.number}`);
      console.log(`        er:   ${n.voiceUrl || "(tom)"}`);
      console.log(`        bør:  ${VOICE_URL}`);
      note(`Forkert voiceUrl: ${r.number} peger på ${n.voiceUrl || "(tom)"}.`);
      webhookfejl++;
    } else if ((n.voiceMethod || "").toUpperCase() !== "POST") {
      console.log(`  ⚠️  ${r.number}  voiceMethod=${n.voiceMethod} (bør være POST)`);
      note(`Forkert voiceMethod på ${r.number}: ${n.voiceMethod}.`);
      webhookfejl++;
    }
  }
  if (!webhookfejl) console.log("  ✅ alle numre i puljen peger på den forventede webhook");
  console.log("");

  // ---------------------------------------------------------------------------
  // 5) SID-afvigelser og dubletter — stille datarod, der bider ved frigivelse
  // ---------------------------------------------------------------------------
  console.log("── SID-afvigelser og dubletter ".padEnd(72, "─"));
  let smaating = 0;
  for (const [key, r] of dbMap) {
    const n = twilioMap.get(key);
    if (!n) continue;
    if (r.twilio_sid && r.twilio_sid !== n.sid) {
      console.log(`  ⚠️  ${r.number}  db-sid=${r.twilio_sid}  twilio-sid=${n.sid}`);
      note(`SID stemmer ikke for ${r.number}.`);
      smaating++;
    }
    if (!r.twilio_sid) {
      console.log(`  ⚠️  ${r.number}  mangler twilio_sid i databasen (Twilio: ${n.sid})`);
      note(`Manglende twilio_sid på ${r.number}.`);
      smaating++;
    }
  }
  for (const d of dubletter) {
    console.log(`  ⚠️  ${d} optræder flere gange i phone_numbers`);
    note(`Dublet i puljen: ${d}.`);
    smaating++;
  }
  if (SYSTEM_NUMBER && dbMap.has(SYSTEM_NUMBER)) {
    console.log(`  ⛔ SYSTEMNUMMERET ligger i puljen — kan blive tildelt en kunde!`);
    note("Systemnummeret ligger i phone_numbers og skal fjernes derfra.");
    smaating++;
  }
  if (!smaating) console.log("  ✅ ingen");
  console.log("");

  // ---------------------------------------------------------------------------
  // 6) Puljestatus — hvor mange ledige numre har du reelt tilbage?
  // ---------------------------------------------------------------------------
  const ledige   = dbNumre.filter((r) => !r.firm_id).length;
  const tildelte = dbNumre.length - ledige;
  console.log("── Puljestatus ".padEnd(72, "─"));
  console.log(`  ${ledige} ledige, ${tildelte} tildelt`);
  if (ledige === 0) console.log("  ⛔ INGEN ledige numre — næste onboarding vil fejle.");
  else if (ledige <= 2) console.log("  ⚠️  Lavt lager — køb flere før næste pilotkunde.");
  console.log("");

  // ---------------------------------------------------------------------------
  // 7) Dom
  // ---------------------------------------------------------------------------
  console.log("=".repeat(72));
  if (!problemer.length) {
    console.log("✅ Alt stemmer. Twilio og puljen er enige.");
    process.exit(0);
  }
  console.log(`⚠️  ${problemer.length} ting kræver din opmærksomhed:`);
  problemer.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  console.log("");
  console.log("Scriptet har IKKE rettet noget. Ret selv, ét punkt ad gangen.");
  process.exit(1);
})().catch((err) => {
  console.error("Afstemning fejlede:", err.message);
  process.exit(1);
});
