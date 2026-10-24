// kor-proever.js -- koerer alle proev-*.js, ligesom CI goer (18/10-26).
//
//   node kor-proever.js
//
// Hver proeve koeres for sig med `node <fil>` fra repoets rod, UDEN dine
// miljoevariabler og med en tidsgraense.
//
// FORBEHOLD (maalt 18/10): en proeve, der selv laeser .env med dotenv, faar
// alligevel noeglerne lokalt - .env ligger paa disken, ikke i miljoeet.
// Lokalt groent er derfor ikke det samme som groent i CI, hvor der ingen
// .env er. Det var saadan proev-forloeb og proev-moduler slap igennem
// lokalt og blev roede i CI. CI-koerslen er facit.
//
// TO LISTER, OG ALLE PROEVER SKAL STAA PAA EN AF DEM:
//   KOERES    - koeres i CI; en fejl goer koerslen roed.
//   IKKE_I_CI - bevidst udeladt, med en begrundelse.
// Ligger der en proev-*.js i roden, som ikke staar paa nogen af dem, er
// koerslen roed. En ny proeve fra en anden chat kan dermed ikke glemmes.
//
// Exit 0 = alt groent. Exit 1 = en proeve fejlede, eller en fil mangler paa
// listerne (eller staar paa en liste uden at findes).
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const KOERES = [
  "proev-asr-adapter.js",
  "proev-ejerskab.js",
  "proev-formular-graenser.js",
  "proev-indtal-mere.js",
  "proev-kundenoegle.js",
  "proev-kvote.js",
  "proev-login-maaling.js",
  "proev-optager-besked.js",
  "proev-optager-fravalg.js",
  "proev-optager.js",
  "proev-referat-graenseflade.js",
  "proev-referat-minimum.js",
  "proev-referat-ret.js",
  "proev-referat-udkast.js",
  "proev-ret-kunde.js",
  "proev-servergraense.js",
  "proev-tekst-adapter.js",
  "proev-ventetid.js",
];

// { fil: "begrundelse" } - fx en proeve, der kalder staging over nettet.
const IKKE_I_CI = {
  "proev-datafunktioner.js": "kalder staging over nettet med TILBUD_TEST_TOKEN (maalt 18/10)",
  "proev-referat-rute.js":   "kalder staging over nettet med TILBUD_TEST_TOKEN (maalt 18/10)",
  "proev-transskriber.js":   "kalder staging over nettet med TILBUD_TEST_TOKEN (maalt 18/10)",
  "proev-teknik-b.js":       "kraever stien til proevebaenken som argument (maalt 18/10)",
  "proev-forloeb.js":        "laeser Supabase-noegler fra .env og kalder databasen (roed i CI 18/10)",
  "proev-moduler.js":        "laeser Supabase-noegler og BASE_URL fra .env og kalder databasen (roed i CI 18/10)",
  "proev-kunde-telefoner.js": "laeser Supabase-noegler fra .env og kalder databasen; kraever --bekraeft (D88, 18/10)",
  "proev-kundematch.js":     "laeser Supabase-noegler fra .env og kalder databasen; kraever --bekraeft (D88 trin 1b, 19/10)",
  "proev-formular-engangs.js": "laeser Supabase-noegler fra .env, kalder staging-databasen; kraever --bekraeft (S34, 19/10)",
  "proev-leads-skriveret.js": "kalder staging som indlogget bruger med TILBUD_TEST_TOKEN; kraever --bekraeft (S35, 21/10)",
};

const TIDSGRAENSE_MS = 120000;

// Kun det, node og operativsystemet selv skal bruge. Alt andet (noegler,
// tokens, DATABASE_URL ...) tages bevidst IKKE med.
const BEHOLD = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC",
  "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "LANG"];
const env = {};
for (const k of BEHOLD) if (process.env[k] !== undefined) env[k] = process.env[k];

const ROD = __dirname;
const paaDisk = fs.readdirSync(ROD).filter((f) => /^proev-.*\.js$/.test(f)).sort();
let roed = false;

const ukendte = paaDisk.filter((f) => !KOERES.includes(f) && !(f in IKKE_I_CI));
const vaek = KOERES.concat(Object.keys(IKKE_I_CI)).filter((f) => !paaDisk.includes(f));
if (ukendte.length) {
  roed = true;
  console.log("FEJL  proever, der ikke staar paa nogen liste i kor-proever.js:");
  ukendte.forEach((f) => console.log("        " + f));
  console.log("      Saet dem i KOERES - eller i IKKE_I_CI med en begrundelse.\n");
}
if (vaek.length) {
  roed = true;
  console.log("FEJL  paa listen, men findes ikke:");
  vaek.forEach((f) => console.log("        " + f));
  console.log("");
}

for (const [f, grund] of Object.entries(IKKE_I_CI)) {
  console.log("SPRUNGET OVER  " + f + "  -- " + grund);
}

const resultater = [];
for (const f of KOERES) {
  if (!paaDisk.includes(f)) continue;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [f], { cwd: ROD, env, encoding: "utf8", timeout: TIDSGRAENSE_MS });
  const ms = Date.now() - t0;
  const ud = (r.stdout || "") + (r.stderr || "");
  const m = ud.match(/^\s*(\d+)\/(\d+)\s*$/m);
  const tal = m ? m[1] + "/" + m[2] : "";
  const ok = r.status === 0 && !r.error;
  resultater.push({ f, ok, ms, tal });
  console.log((ok ? "OK    " : "FEJL  ") + f.padEnd(32) + (tal || "").padEnd(8) + Math.round(ms / 100) / 10 + " s" +
    (r.error ? "  (" + (r.error.code === "ETIMEDOUT" ? "over " + TIDSGRAENSE_MS / 1000 + " s" : r.error.message) + ")" : ""));
  if (!ok) {
    roed = true;
    // De sidste linjer, saa aarsagen kan ses direkte i CI-loggen.
    console.log(ud.trim().split("\n").slice(-15).map((l) => "        | " + l).join("\n"));
  }
}

const fejlede = resultater.filter((x) => !x.ok).length;
console.log("\n" + (resultater.length - fejlede) + " af " + resultater.length + " proever groenne" +
  (Object.keys(IKKE_I_CI).length ? ", " + Object.keys(IKKE_I_CI).length + " sprunget over" : "") + ".");
process.exit(roed ? 1 : 0);
