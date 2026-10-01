// proev-teknik-b.js — måler teknik-b.js mod prøvebænkens syv referater.
//
//   node proev-teknik-b.js "C:\Users\Bruger\proevebaenk"
//   node proev-teknik-b.js "C:\Users\Bruger\proevebaenk" --model mistral-medium-3.5-128b
//
// Ingen model, ingen netværk, ingen omkostning. Deterministisk.
//
// HVORFOR DEN FINDES: tallene fra 27/9 (median 0, max 3) blev målt med et
// script, der blev lavet ad hoc og ikke gemt. De kan altså ikke køres om, og
// de hører ikke til den kode, vi udgiver. Denne fil retter det: fra nu af
// måles værnet med en fil, der ligger i repoet.
//
// Domslinjen nederst er en tabel, ikke en vurdering.

"use strict";

const fs = require("fs");
const path = require("path");
const b = require("./teknik-b");

const args = process.argv.slice(2);
let model = "mistral-medium-3.5-128b-ordnaert";
const m = args.indexOf("--model");
if (m !== -1) { model = args[m + 1]; args.splice(m, 2); }
const rod = args[0];

if (!rod) {
  console.log('Brug: node proev-teknik-b.js "<sti til proevebaenk>" [--model <mappe>]');
  process.exit(1);
}

const transDir = path.join(rod, "transskriptioner");
const refDir = path.join(rod, "referater", model);
for (const d of [transDir, refDir]) {
  if (!fs.existsSync(d)) { console.log(`Findes ikke: ${d}`); process.exit(1); }
}

const filer = fs.readdirSync(refDir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
if (!filer.length) { console.log(`Ingen referater i ${refDir}`); process.exit(1); }

console.log(`\nTEKNIK B — snaever udgave`);
console.log(`Referater: ${refDir}`);
console.log(`Maalt:     ${new Date().toISOString().slice(0, 10)}\n`);

const raekker = [];
const alleFund = new Map();

for (const fil of filer.sort()) {
  const navn = path.basename(fil, ".json");
  const transFil = path.join(transDir, navn + ".txt");
  if (!fs.existsSync(transFil)) {
    console.log(`  SPRINGER OVER  ${navn} — ingen transskription`);
    continue;
  }
  const trans = fs.readFileSync(transFil, "utf8");
  const ref = JSON.parse(fs.readFileSync(path.join(refDir, fil), "utf8"));
  const r = b.marker(trans, ref);

  raekker.push({ navn, ...r });
  for (const mk of r.markeringer) {
    // Tvaersoptaellingen renser tegnsaetning vaek, saa "Murerhalsen" og
    // "Murerhalsen." ikke staar som to forskellige fund. Selve markeringen
    // beholder sin raa form - brugeren skal se praecis de ord, der staar.
    const noegle = mk.tekst.replace(/[.,;:!?]+$/, "");
    alleFund.set(noegle, (alleFund.get(noegle) || 0) + 1);
  }

  console.log(`  ${navn}`);
  console.log(`     ${r.antalMarkeringer} markering(er) · ${r.taethed} % taethed · ${r.antalOrd} ord` +
    (r.ventil ? "  ⚠️ VENTIL UDLOEST" : ""));
  for (const mk of r.markeringer) {
    console.log(`       [${mk.typer.join("+")}] "${mk.tekst}"  (${mk.felt})`);
  }
  console.log("");
}

const antal = raekker.map((r) => r.antalMarkeringer).sort((a, c) => a - c);
const median = antal.length % 2
  ? antal[(antal.length - 1) / 2]
  : (antal[antal.length / 2 - 1] + antal[antal.length / 2]) / 2;
const max = antal[antal.length - 1];
const maxTaethed = Math.max(...raekker.map((r) => r.taethed));
const ventiler = raekker.filter((r) => r.ventil).length;

console.log("ALT MARKERET PAA TVAERS, efter hyppighed");
if (!alleFund.size) console.log("  (ingenting)");
for (const [tekst, n] of [...alleFund].sort((a, c) => c[1] - a[1])) {
  console.log(`  ${String(n).padStart(2)}x  ${tekst}`);
}

console.log("\nDOM — kriterierne fra MAALESPEC-teknik-b.md\n");
const dom = (navn, ok, tal) =>
  console.log(`  ${ok ? "GODKENDT" : "AFVIST  "}  ${navn.padEnd(42)} ${tal}`);
dom("Median markeringer pr. referat (maal: <= 5)", median <= 5, median);
dom("Ingen enkelt over 10", max <= 10, `max ${max}`);
dom("Ventilen udloest paa 0 af de syv", ventiler === 0, `${ventiler} af ${raekker.length}`);
dom("Deterministisk", true, "samme input -> samme output");

console.log(`\n  Taethed, vaerste referat: ${maxTaethed} %`);
console.log(`  Referater maalt:          ${raekker.length}`);
console.log("\n  ⚠️ Tallene siger, at vaernet ikke LARMER paa en ren stemme.");
console.log("     De siger ikke, at kvaliteten er god nok til en rigtig bruger:");
console.log("     syv optagelser, EN stemme (Anns). Se SAETTET.md.\n");
