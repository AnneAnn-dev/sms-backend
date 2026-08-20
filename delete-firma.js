/*
 * delete-firma.js — sletter ét firma permanent, med alt hvad der hænger på det.
 *
 * Dit Digitale Kontor. Skrevet 19/8-26 til J4 (RISIKOREGISTER.md) — første
 * kundeafvikling (9/8) viste, at der IKKE fandtes en sti til at slette et
 * firma: nummer + firm_users + Auth-bruger blev fjernet, men firms-rækken
 * (navn, e-mail) stod tilbage. Dette script er den sti.
 *
 * Dækker (bekræftet mod det faktiske FK-kort i skemaet, 19/8-26):
 *   calls                     NO ACTION  -- slettes EKSPLICIT herfra, ellers
 *                                           blokerer den `delete from firms`
 *   firm_users                CASCADE
 *   firm_whitelist             CASCADE
 *   firma_profil               CASCADE
 *   kunder                     CASCADE
 *   leads                      CASCADE
 *   messages                   CASCADE
 *   push_subscriptions         CASCADE
 *   referater                  CASCADE
 *   standardfelter              CASCADE
 *   tilbud                     CASCADE
 *   tilbud_linjer               CASCADE
 *   onboarding_sidevisninger   SET NULL   -- rækken bliver, firm_id nulstilles
 *   phone_numbers               SET NULL   -- nummeret lægges tilbage i puljen
 *
 * Storage (bekræftet ved grep af hele repoet 19/8-26 — ikke antaget):
 *   greetings/<firmId>/*       -- hilsen-lydfiler (tts.js). Ryddes eksplicit.
 *   lead-images/<leadId>/*     -- BEMÆRK: nøglet på lead.id, IKKE firm.id
 *                                  (server.js, /formular/:token). Lead-id'erne
 *                                  hentes derfor FØR sletning, ellers er
 *                                  koblingen væk, når CASCADE har ramt `leads`.
 *   "potentielle kunder"       -- IKKE fundet nogen steder i koden (grep gav
 *                                  0 hits). Formentlig ubrugt/forladt bucket.
 *                                  Røres IKKE automatisk af dette script —
 *                                  tjek selv i Storage-UI'en hvis i tvivl.
 *
 * Auth-bruger:
 *   Kan KUN findes via firm_users (firma -> bruger-koblingen). Hentes FØR
 *   sletning. Er firm_users allerede tom for firmaet (som 9/8-tilfældet, hvor
 *   den blev slettet i en tidligere, ufuldstændig afvikling), kan scriptet
 *   IKKE finde brugeren automatisk — det printes som en tydelig advarsel, og
 *   du må selv slå e-mailen op under Authentication -> Users.
 *
 * INGEN PERSONDATA I OUTPUT: scriptet printer kun id'er, tælletal og
 * tidsstempler — aldrig navn, e-mail eller telefonnummer. Det er bevidst,
 * jf. CLAUDE.md-reglen om ingen persondata i logs.
 *
 * BRUG (PowerShell, i repo-roden — kør skift-staging.ps1/skift-prod.ps1 FØRST
 * så .env peger det rigtige sted hen):
 *   node delete-firma.js --ref <project-ref> --firma <firm-id>              (tørkørsel, standard — intet skrives)
 *   node delete-firma.js --ref <project-ref> --firma <firm-id> --bekraeft   (udfører — beder om bekræftelse undervejs)
 *
 * --ref skal matche det Supabase-projekt, SUPABASE_URL i .env rent faktisk
 * peger på — samme mønster som dump-storage.js/restore-storage.js. Stemmer
 * de ikke, stopper scriptet FØR det rører noget.
 *
 * ÉT FIRMA AD GANGEN. Der findes bevidst ingen batch-/liste-tilstand — det
 * er en garanti om, at scriptet aldrig kan røre et andet firma end det, du
 * eksplicit har angivet (J4's krav).
 *
 * Rulles IKKE tilbage. Kør altid tørkørsel først og læs planen, før --bekraeft.
 */

require("dotenv").config();

const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");

function argv(navn) {
  const i = process.argv.indexOf(`--${navn}`);
  return i === -1 ? null : process.argv[i + 1];
}

const REF = argv("ref");
const FIRMA_ID = argv("firma");
const BEKRAEFT = process.argv.includes("--bekraeft");

const UUID_MOENSTER =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!REF || !FIRMA_ID) {
  console.error(
    "Brug: node delete-firma.js --ref <project-ref> --firma <firm-id> [--bekraeft]"
  );
  process.exit(1);
}

if (!UUID_MOENSTER.test(FIRMA_ID)) {
  console.error(`--firma ser ikke ud som et UUID: "${FIRMA_ID}". Stopper.`);
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mangler i .env.");
  process.exit(1);
}

if (!url.includes(REF)) {
  console.error(
    `--ref ${REF} matcher ikke SUPABASE_URL i .env (${url}).\n` +
      "Stopper — kør skift-staging.ps1/skift-prod.ps1 igen, eller ret --ref."
  );
  process.exit(1);
}

const supabase = createClient(url, key);

// Tabeller der CASCADE'r automatisk, når firms-rækken slettes — listes kun
// for at kunne TÆLLE dem i tørkørslen. Scriptet sletter dem ikke selv;
// Postgres gør det som en konsekvens af "delete from firms".
const CASCADE_TABELLER = [
  "firm_users",
  "firm_whitelist",
  "firma_profil",
  "kunder",
  "leads",
  "messages",
  "push_subscriptions",
  "referater",
  "standardfelter",
  "tilbud",
  "tilbud_linjer",
];

// Tabeller der nulstiller firm_id (SET NULL) — rækken består, kun koblingen
// til firmaet forsvinder.
const SET_NULL_TABELLER = ["phone_numbers", "onboarding_sidevisninger"];

async function taelForFirma(tabel) {
  const { count, error } = await supabase
    .from(tabel)
    .select("*", { count: "exact", head: true })
    .eq("firm_id", FIRMA_ID);
  if (error) throw new Error(`${tabel}: ${error.message}`);
  return count;
}

async function listStoragePraefiks(bucket, praefiks) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(praefiks, { limit: 1000 });
  if (error) {
    throw new Error(`storage ${bucket}/${praefiks}: ${error.message}`);
  }
  return (data || [])
    .filter((f) => f.id) // udelader evt. "mapper" uden filer
    .map((f) => `${praefiks}/${f.name}`);
}

function spoergBekraeft(sporgsmaal) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(sporgsmaal, (svar) => {
      rl.close();
      resolve(svar.trim());
    });
  });
}

async function main() {
  console.log("=========================================================");
  console.log("  delete-firma.js — Dit Digitale Kontor");
  console.log("=========================================================");
  console.log("  PROJEKT-REF : " + REF);
  console.log("  FIRMA-ID    : " + FIRMA_ID);
  console.log(
    "  TILSTAND    : " + (BEKRAEFT ? "UDFØRER (--bekraeft)" : "TØRKØRSEL")
  );
  console.log("=========================================================\n");

  // Trin 1 — findes firmaet?
  const { data: firma, error: firmaErr } = await supabase
    .from("firms")
    .select("id, status, billing_status, created_at")
    .eq("id", FIRMA_ID)
    .maybeSingle();

  if (firmaErr) {
    throw new Error(`Kunne ikke slå firma op: ${firmaErr.message}`);
  }
  if (!firma) {
    console.error(`Fandt intet firma med id ${FIRMA_ID}. Stopper.`);
    process.exit(1);
  }

  console.log("Firma fundet (kun ikke-personhenførbare felter vist):");
  console.log(`  status          : ${firma.status}`);
  console.log(`  billing_status  : ${firma.billing_status}`);
  console.log(`  oprettet        : ${firma.created_at}`);
  console.log("");
  console.log(
    "Tjek selv i Supabase-UI'en at dette ER det firma, du mener, FØR du kører --bekraeft.\n"
  );

  // Trin 2 — tæl afhængige rækker (kun til rapporten)
  console.log("Rækker der forsvinder ved sletning (CASCADE):");
  for (const tabel of CASCADE_TABELLER) {
    const n = await taelForFirma(tabel);
    console.log(`  ${tabel.padEnd(20)} ${n}`);
  }
  const antalCalls = await taelForFirma("calls");
  console.log(
    `  ${"calls".padEnd(20)} ${antalCalls}  (slettes EKSPLICIT — NO ACTION, ikke CASCADE)`
  );

  console.log("\nRækker der nulstilles (firm_id -> null, rækken består):");
  for (const tabel of SET_NULL_TABELLER) {
    const n = await taelForFirma(tabel);
    console.log(`  ${tabel.padEnd(24)} ${n}`);
  }

  // Trin 3 — hent lead-id'er og bruger-id'er FØR noget slettes, ellers er
  // koblingerne væk, når CASCADE har ramt `leads`/`firm_users`.
  const { data: leadRows, error: leadErr } = await supabase
    .from("leads")
    .select("id")
    .eq("firm_id", FIRMA_ID);
  if (leadErr) throw new Error(`leads: ${leadErr.message}`);
  const leadIds = (leadRows || []).map((r) => r.id);

  const { data: brugerRows, error: brugerErr } = await supabase
    .from("firm_users")
    .select("user_id")
    .eq("firm_id", FIRMA_ID);
  if (brugerErr) throw new Error(`firm_users: ${brugerErr.message}`);
  const brugerIds = (brugerRows || []).map((r) => r.user_id);

  if (brugerIds.length === 0) {
    console.log(
      "\n⚠️  Ingen firm_users-række fundet — Auth-brugeren kan IKKE findes automatisk."
    );
    console.log(
      "    Tjek manuelt under Authentication -> Users på e-mail, hvis brugeren skal væk."
    );
  } else {
    console.log(
      `\nAuth-brugere der slettes: ${brugerIds.length} stk. (kun id'er, ingen e-mail vist her)`
    );
  }

  // Trin 4 — find storage-objekter
  const greetingsObjekter = await listStoragePraefiks("greetings", FIRMA_ID);
  console.log(
    `\nStorage "greetings/${FIRMA_ID}/": ${greetingsObjekter.length} fil(er)`
  );

  let leadImageObjekter = [];
  for (const leadId of leadIds) {
    const objekter = await listStoragePraefiks("lead-images", leadId);
    leadImageObjekter = leadImageObjekter.concat(objekter);
  }
  console.log(
    `Storage "lead-images/<lead-id>/": ${leadImageObjekter.length} fil(er) på tværs af ${leadIds.length} lead(s)`
  );
  console.log(
    '\n"potentielle kunder"-bucketten røres IKKE — ikke fundet i kode (grep 19/8). Tjek selv i Storage-UI\'en hvis relevant.'
  );

  if (!BEKRAEFT) {
    console.log(
      "\n— TØRKØRSEL FÆRDIG. Intet er slettet. Kør igen med --bekraeft for at udføre. —"
    );
    return;
  }

  // Ekstra bremseklods, fordi dette ikke kan fortrydes.
  console.log("");
  const svar = await spoergBekraeft(
    `Skriv firma-id'et igen for at bekræfte SLETNING (${FIRMA_ID}): `
  );
  if (svar !== FIRMA_ID) {
    console.error("Matchede ikke — stopper uden at røre noget.");
    process.exit(1);
  }

  // Trin 5 — udfør
  console.log("\n>>> UDFØRER — dette kan ikke fortrydes <<<\n");

  if (greetingsObjekter.length > 0) {
    const { error } = await supabase.storage
      .from("greetings")
      .remove(greetingsObjekter);
    if (error) throw new Error(`Sletning af greetings fejlede: ${error.message}`);
    console.log(`Slettet ${greetingsObjekter.length} fil(er) fra greetings/.`);
  }

  if (leadImageObjekter.length > 0) {
    const { error } = await supabase.storage
      .from("lead-images")
      .remove(leadImageObjekter);
    if (error) {
      throw new Error(`Sletning af lead-images fejlede: ${error.message}`);
    }
    console.log(`Slettet ${leadImageObjekter.length} fil(er) fra lead-images/.`);
  }

  const { error: callsErr } = await supabase
    .from("calls")
    .delete()
    .eq("firm_id", FIRMA_ID);
  if (callsErr) throw new Error(`Sletning af calls fejlede: ${callsErr.message}`);
  console.log(`Slettet ${antalCalls} række(r) fra calls (eksplicit, NO ACTION).`);

  const { error: firmaSlettetErr } = await supabase
    .from("firms")
    .delete()
    .eq("id", FIRMA_ID);
  if (firmaSlettetErr) {
    throw new Error(`Sletning af firms-rækken fejlede: ${firmaSlettetErr.message}`);
  }
  console.log("firms-rækken slettet — CASCADE har ryddet de tilknyttede tabeller.");

  for (const uid of brugerIds) {
    const { error } = await supabase.auth.admin.deleteUser(uid);
    if (error) {
      console.error(`  ⚠️  Kunne ikke slette Auth-bruger ${uid}: ${error.message}`);
    } else {
      console.log(`  Auth-bruger ${uid} slettet.`);
    }
  }

  // Trin 6 — efterkontrol
  console.log("\nEfterkontrol (alle bør være 0):");
  for (const tabel of [...CASCADE_TABELLER, "calls"]) {
    const n = await taelForFirma(tabel);
    console.log(`  ${tabel.padEnd(20)} ${n}${n > 0 ? "  ⚠️ IKKE TOM" : ""}`);
  }
  const { data: firmaEfter } = await supabase
    .from("firms")
    .select("id")
    .eq("id", FIRMA_ID)
    .maybeSingle();
  console.log(`  firms-rækken selv    ${firmaEfter ? "FINDES STADIG ⚠️" : "væk ✓"}`);

  console.log("\n— FÆRDIG. —");
}

main().catch((err) => {
  console.error("\nFEJL:", err.message);
  process.exit(1);
});
