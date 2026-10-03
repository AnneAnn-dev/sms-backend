// audit-tjek.js - blokerende sikkerhedsgennemgang af produktionsafhaengigheder.
//
// Erstatter "npm audit --omit=dev --audit-level=high" i CI. Graensen er stadig
// HIGH: ethvert high- eller critical-fund blokerer - undtagen de ENKELTE
// advisories, der staar i UNDTAGELSER nedenfor, og kun i den pakke, de er
// skrevet til.
//
// Hvorfor ikke bare saenke graensen til critical (som ved S22)?
//   Saa slipper ALLE nye high-fund igennem, indtil nogen husker at haeve den
//   igen. Her undtages praecis et fund, og et nyt high-fund i morgen blokerer.
//
// Tre regler, der goer listen sikker frem for bekvem:
//   1. En undtagelse er bundet til GHSA-id OG pakke. Dukker samme id op i en
//      anden pakke, er den ikke undskyldt.
//   2. En undtagelse, der ikke laengere daekker noget, goer koerslen ROED.
//      Rettelsen er at slette linjen. En liste, der ikke rydder sig selv op,
//      ender med at undskylde fremtidige fejl.
//   3. Undtagelserne og deres begrundelse printes i HVER koersel.
//
// Fail-closed: kan npm audit ikke koeres eller svaret ikke laeses, er
// resultatet UAFKLARET (exit 2) - aldrig groent.
//
// Brug:
//   node audit-tjek.js                   koerer npm audit --omit=dev --json
//   node audit-tjek.js --fra-fil x.json  laeser et gemt svar (til test)
//
// Exit: 0 = ingen uundskyldte fund, 1 = uundskyldte fund eller foraeldet
//       undtagelse, 2 = UAFKLARET (kunne ikke maales).
//
// NY UNDTAGELSE: skriv foerst fundet ind i RISIKOREGISTER.md med re-trigger og
// dato. Derefter linjen her. Aldrig omvendt.

"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");

const UNDTAGELSER = [
  {
    id: "GHSA-ch52-4w7c-c8xp",
    pakke: "http-cache-semantics",
    dato: "2026-10-03",
    begrundelse:
      "Kun via @appsignal/nodejs > node-gyp > make-fetch-happen (maalt med " +
      "npm ls 3/10-26). node-gyp er AppSignals byggevaerktoej og koerer ved " +
      "installation, ikke i appen. Saarbarheden kraever en DELT HTTP-cache; " +
      "appen er ikke en. npm's 'fix' nedgraderer AppSignal til 1.3.2.",
    retrigger:
      "Rettet http-cache-semantics udgivet, ELLER AppSignal-version uden " +
      "node-gyp i traeet, ELLER pakken dukker op under en anden afhaengighed.",
  },
];

const BLOKERENDE = new Set(["high", "critical"]);

function afslut(kode, tekst) {
  if (tekst) console.log(tekst);
  process.exit(kode);
}

// --- argumenter (ukendte afvises) ---
const args = process.argv.slice(2);
let fraFil = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--fra-fil" && args[i + 1]) {
    fraFil = args[++i];
  } else {
    afslut(2, "UAFKLARET: ukendt argument: " + args[i]);
  }
}

// --- hent rapporten ---
let raa;
if (fraFil) {
  try {
    raa = fs.readFileSync(fraFil, "utf8");
  } catch (e) {
    afslut(2, "UAFKLARET: kunne ikke laese " + fraFil + ": " + e.message);
  }
} else {
  const r = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) afslut(2, "UAFKLARET: npm audit kunne ikke startes: " + r.error.message);
  raa = r.stdout;
}

let rapport;
try {
  rapport = JSON.parse(raa);
} catch (e) {
  afslut(2, "UAFKLARET: npm audit gav ikke gyldig JSON.");
}
if (rapport.error) {
  afslut(2, "UAFKLARET: npm audit fejlede: " + (rapport.error.summary || rapport.error.code || "ukendt"));
}
if (!rapport.vulnerabilities || typeof rapport.vulnerabilities !== "object") {
  afslut(2, "UAFKLARET: rapporten mangler 'vulnerabilities' - formatet er ukendt.");
}

// --- find de egentlige advisories ---
// Et fund i npm audit --json er enten selve saarbarheden (via indeholder et
// objekt med url) eller en pakke, der blot afhaenger af en saarbar pakke (via
// indeholder kun pakkenavne). Kun det foerste er en advisory; resten er
// konsekvenser, der forsvinder sammen med den.
const fund = []; // { id, pakke, severity, title, url }
for (const [pakke, v] of Object.entries(rapport.vulnerabilities)) {
  for (const via of v.via || []) {
    if (typeof via !== "object" || via === null) continue;
    const m = String(via.url || "").match(/GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i);
    fund.push({
      id: m ? m[0].toLowerCase() : "(intet GHSA-id: " + (via.url || via.source) + ")",
      pakke: via.name || pakke,
      severity: String(via.severity || v.severity || "").toLowerCase(),
      title: via.title || "",
      url: via.url || "",
    });
  }
}

// Samme advisory kan staa flere gange; tael hvert (id, pakke) en gang.
const unikke = new Map();
for (const f of fund) unikke.set(f.id + "|" + f.pakke, f);

const blokerende = [...unikke.values()].filter((f) => BLOKERENDE.has(f.severity));
const undtaget = [];
const uundskyldt = [];
for (const f of blokerende) {
  const u = UNDTAGELSER.find((x) => x.id.toLowerCase() === f.id && x.pakke === f.pakke);
  (u ? undtaget : uundskyldt).push(f);
}

const foraeldede = UNDTAGELSER.filter(
  (u) => !blokerende.some((f) => f.id === u.id.toLowerCase() && f.pakke === u.pakke)
);

// --- rapport ---
console.log("audit-tjek: graense = high (high og critical blokerer)");
console.log("Advisories i alt: " + unikke.size + "  heraf high/critical: " + blokerende.length);
console.log("");

console.log("Undtagelser i kraft (" + UNDTAGELSER.length + "):");
for (const u of UNDTAGELSER) {
  console.log("  - " + u.id + " i " + u.pakke + " (siden " + u.dato + ")");
  console.log("      Hvorfor:     " + u.begrundelse);
  console.log("      Re-trigger:  " + u.retrigger);
}
console.log("");

for (const f of undtaget) {
  console.log("UNDTAGET   [" + f.severity + "] " + f.id + " i " + f.pakke + " - " + f.title);
}
for (const f of uundskyldt) {
  console.log("BLOKERER   [" + f.severity + "] " + f.id + " i " + f.pakke + " - " + f.title + " " + f.url);
}
for (const u of foraeldede) {
  console.log("FORAELDET  " + u.id + " i " + u.pakke +
    " findes ikke laengere i rapporten. Slet linjen i UNDTAGELSER og luk punktet i registret.");
}
console.log("");

if (uundskyldt.length || foraeldede.length) {
  afslut(1, "FEJLET: " + uundskyldt.length + " uundskyldte fund, " + foraeldede.length + " foraeldede undtagelser.");
}
afslut(0, "OK: ingen uundskyldte high/critical-fund.");
