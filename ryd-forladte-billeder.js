/*
 * ryd-forladte-billeder.js — sletter billedfiler i Storage, hvis opgave ikke
 * findes længere (D96, RISIKOREGISTER.md).
 *
 * Dit Digitale Kontor. Skrevet 29/10-26. Baggrund: `lead_images` følger
 * opgaven med CASCADE, men filerne i bucket'en `lead-images` gør ikke. Målt
 * 29/10: prod 36 filer i 24 mapper uden opgave (maj–juni 2026), staging 22
 * filer i 8 mapper (20–23/10).
 *
 * Stien er `lead-images/<opgave-id>/<fil>` (billeder.js — eneste skriver,
 * grep 29/10). En mappe er FORLADT, når ALLE disse holder:
 *   1. mappenavnet er et UUID,
 *   2. der findes ingen række i `leads` med det id,
 *   3. ingen række i `lead_images` peger ind i mappen,
 *   4. mappens nyeste fil er ældre end --min-alder-timer (standard 24).
 * Punkt 2 og 3 tjekkes IGEN for hver mappe lige før sletning.
 * Mapper, der ikke er et UUID, røres aldrig — de nævnes kun i rapporten.
 *
 * INGEN PERSONDATA I OUTPUT: kun mappe-id'er (opgave-id'er), antal og datoer —
 * aldrig filnavne.
 *
 * BRUG (PowerShell, i repo-roden — kør skift-staging.ps1/skift-prod.ps1 FØRST):
 *   node ryd-forladte-billeder.js --ref <project-ref>               (tørkørsel, standard)
 *   node ryd-forladte-billeder.js --ref <project-ref> --bekraeft    (sletter efter bekræftelse)
 *   [--min-alder-timer <n>]
 *
 * --ref skal matche SUPABASE_URL i .env (samme mønster som delete-firma.js).
 * Rulles IKKE tilbage. Kør altid tørkørsel først.
 */

require("dotenv").config();

const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");

const BUCKET = "lead-images";
const UUID_MOENSTER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIDE = 100;

function argv(navn) {
  const i = process.argv.indexOf(`--${navn}`);
  return i === -1 ? null : process.argv[i + 1];
}

function spoerg(tekst) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(tekst, (svar) => { rl.close(); ok(svar.trim()); }));
}

// Hele listen under et præfiks, side for side. Poster uden id er mapper.
async function listAlt(supabase, praefiks) {
  const ud = [];
  for (let offset = 0; ; offset += SIDE) {
    const { data, error } = await supabase.storage.from(BUCKET)
      .list(praefiks, { limit: SIDE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`storage ${BUCKET}/${praefiks}: ${error.message}`);
    ud.push(...(data || []));
    if (!data || data.length < SIDE) return ud;
  }
}

async function opgaveFindes(supabase, id) {
  const { data, error } = await supabase.from("leads").select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(`leads: ${error.message}`);
  return !!data;
}

async function raekkerPegerInd(supabase, id) {
  const { count, error } = await supabase.from("lead_images")
    .select("id", { count: "exact", head: true })
    .like("image_url", `%/${BUCKET}/${id}/%`);
  if (error) throw new Error(`lead_images: ${error.message}`);
  return count || 0;
}

async function kortlaeg(supabase, minAlderMs, nu) {
  const rod = await listAlt(supabase, "");
  const mapper = rod.filter((p) => !p.id).map((p) => p.name);
  const loese = rod.filter((p) => p.id).length;
  const ikkeUuid = mapper.filter((m) => !UUID_MOENSTER.test(m));
  const forladte = [], for_nye = [];
  let medOpgave = 0;
  for (const mappe of mapper.filter((m) => UUID_MOENSTER.test(m))) {
    if (await opgaveFindes(supabase, mappe)) { medOpgave++; continue; }
    if (await raekkerPegerInd(supabase, mappe)) { medOpgave++; continue; }
    const filer = (await listAlt(supabase, mappe)).filter((f) => f.id);
    const nyeste = filer.reduce((m, f) => Math.max(m, Date.parse(f.created_at || f.updated_at || 0) || 0), 0);
    const post = { mappe, filer: filer.map((f) => `${mappe}/${f.name}`), nyeste };
    if (!filer.length) continue;
    if (nu - nyeste < minAlderMs) for_nye.push(post); else forladte.push(post);
  }
  return { mapper: mapper.length, loese, ikkeUuid, medOpgave, forladte, for_nye };
}

async function koer({ supabase, ref, bekraeft, minAlderTimer = 24, spoergFn = spoerg, log = console.log, nu = Date.now() }) {
  log("=========================================================");
  log("  ryd-forladte-billeder.js — Dit Digitale Kontor (D96)");
  log("  PROJEKT-REF : " + ref);
  log("  TILSTAND    : " + (bekraeft ? "SLETTER (--bekraeft)" : "TØRKØRSEL"));
  log("  MIN. ALDER  : " + minAlderTimer + " timer");
  log("=========================================================\n");

  const k = await kortlaeg(supabase, minAlderTimer * 3600e3, nu);
  const antal = k.forladte.reduce((s, p) => s + p.filer.length, 0);
  log(`Mapper i ${BUCKET}/: ${k.mapper} (heraf ${k.medOpgave} med en opgave)`);
  if (k.loese) log(`  ⚠️  ${k.loese} fil(er) direkte i roden — røres ikke`);
  if (k.ikkeUuid.length) log(`  ⚠️  ${k.ikkeUuid.length} mappe(r), hvis navn ikke er et opgave-id — røres ikke`);
  if (k.for_nye.length) log(`  ${k.for_nye.length} mappe(r) uden opgave, men med en fil yngre end ${minAlderTimer} timer — røres ikke`);
  log(`\nForladte mapper: ${k.forladte.length}, filer: ${antal}`);
  for (const p of k.forladte) log(`  ${p.mappe}  ${String(p.filer.length).padStart(3)} fil(er)  nyeste ${new Date(p.nyeste).toISOString().slice(0, 10)}`);

  if (!bekraeft) { log("\n— TØRKØRSEL FÆRDIG. Intet er slettet. Kør igen med --bekraeft. —"); return { slettet: 0, antal }; }
  if (!antal) { log("\nIntet at slette."); return { slettet: 0, antal }; }

  const svar = await spoergFn(`\nSkriv antallet af filer (${antal}) for at slette dem: `);
  if (svar !== String(antal)) { log("Matchede ikke — stopper uden at røre noget."); return { slettet: 0, antal, afbrudt: true }; }

  let slettet = 0, sprunget = 0, fejl = 0;
  for (const p of k.forladte) {
    // Tjek igen lige før sletning: er opgaven kommet til i mellemtiden?
    if (await opgaveFindes(supabase, p.mappe) || await raekkerPegerInd(supabase, p.mappe)) {
      log(`  sprunget over ${p.mappe}: har nu en opgave`); sprunget++; continue;
    }
    const { error } = await supabase.storage.from(BUCKET).remove(p.filer);
    if (error) { log(`  ⚠️  ${p.mappe}: ${error.message}`); fejl++; continue; }
    slettet += p.filer.length;
  }
  log(`\nSlettet ${slettet} fil(er). Sprunget over: ${sprunget} mappe(r). Fejl: ${fejl}.`);

  const efter = await kortlaeg(supabase, minAlderTimer * 3600e3, Date.now());
  const tilbage = efter.forladte.reduce((s, p) => s + p.filer.length, 0);
  log(`Efterkontrol: forladte filer tilbage: ${tilbage} (bør være 0)`);
  return { slettet, antal, tilbage, fejl };
}

module.exports = { koer, kortlaeg };

if (require.main === module) {
  const ref = argv("ref");
  const minAlder = argv("min-alder-timer");
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ref) { console.error("Brug: node ryd-forladte-billeder.js --ref <project-ref> [--bekraeft] [--min-alder-timer <n>]"); process.exit(1); }
  if (minAlder !== null && !/^\d+$/.test(minAlder)) { console.error("--min-alder-timer skal være et helt tal."); process.exit(1); }
  if (!url || !key) { console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mangler i .env."); process.exit(1); }
  if (!url.includes(ref)) { console.error(`--ref ${ref} matcher ikke SUPABASE_URL i .env. Stopper — kør skift-staging.ps1/skift-prod.ps1 igen.`); process.exit(1); }
  koer({ supabase: createClient(url, key), ref, bekraeft: process.argv.includes("--bekraeft"),
         minAlderTimer: minAlder === null ? 24 : Number(minAlder) })
    .then((r) => process.exit(r.fejl || r.tilbage ? 1 : 0))
    .catch((e) => { console.error("FEJL:", e.message); process.exit(1); });
}
