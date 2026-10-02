// proev-tekst-adapter.js — proever tekst-adapter.js uden at roere en rute.
//
//   node proev-tekst-adapter.js
//       Toerkoersel. Ingen netvaerk, ingen omkostning.
//
//   node proev-tekst-adapter.js "C:\Users\Bruger\proevebaenk\transskriptioner\<fil>.txt"
//       Rigtigt kald. KOSTER PENGE (ca. 7 oere pr. referat).
//       Koerer ogsaa teknik B paa resultatet, saa vaernet ses med det samme.
//
// Referatet skrives IKKE ud i fuld laengde: det er persondata (CLAUDE.md).

"use strict";

try { require("dotenv").config({ quiet: true }); } catch (e) {
  if (process.argv[2]) {
    console.log("ADVARSEL: dotenv kunne ikke indlaeses — .env bliver IKKE laest.");
  }
}

const fs = require("fs");
const path = require("path");
const a = require("./tekst-adapter");

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  —  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  —  ${d}`));

function proev(navn, forventet, funktion) {
  try {
    const svar = funktion();
    if (forventet === "ok") ok(navn, typeof svar === "object" ? JSON.stringify(svar) : String(svar));
    else nej(navn, `forventede fejl '${forventet}', men kaldet gik igennem`);
  } catch (e) {
    if (forventet === e.kode) ok(navn, e.message.replace(/^Referat(-konfiguration)?: /, ""));
    else if (forventet === "ok") nej(navn, `uventet fejl: ${e.message}`);
    else nej(navn, `forventede '${forventet}', fik '${e.kode}'`);
  }
}

const GRUND = {
  TILBUD_REFERAT_LEVERANDOER: "scaleway",
  TILBUD_REFERAT_URL: "https://api.scaleway.ai/11111111-2222-3333-4444-555555555555/v1",
  TILBUD_REFERAT_MODEL: "mistral-medium-3.5-128b",
  SCW_GENAI_SECRET_KEY: "test",
};

// Et gyldigt svar, som de oevrige bygges ud fra.
const GYLDIGT = { overskrift: "Byggemoede", punkter: ["noget med en vaeg"], fritekst: "Der skal mures." };
const J = (o) => JSON.stringify(o);

function form(navn, raat, forventetOk, forventetFejl) {
  const r = a.valider(raat);
  if (r.ok === forventetOk && (!forventetFejl || (r.fejl || []).some((f) => f.includes(forventetFejl)))) {
    ok(navn, r.ok ? "godkendt" : (r.fejl || []).join(" · "));
  } else {
    nej(navn, `fik ${r.ok ? "godkendt" : (r.fejl || []).join(" · ")}`);
  }
}

function toerkoersel() {
  console.log("\nKONFIGURATION — fail-closed som flags.js");
  for (const v of ["TILBUD_REFERAT_LEVERANDOER", "TILBUD_REFERAT_URL", "TILBUD_REFERAT_MODEL", "SCW_GENAI_SECRET_KEY"]) {
    proev(`${v} mangler`, "referat_konfiguration", () => a._hentKonfig({ ...GRUND, [v]: "" }));
  }
  proev("ukendt leverandoer", "referat_konfiguration", () =>
    a._hentKonfig({ ...GRUND, TILBUD_REFERAT_LEVERANDOER: "openai" }));
  proev("fuld konfiguration accepteres", "ok", () => a._hentKonfig(GRUND).model);

  console.log("\nD14 — modelstrengen maa ikke vaere et alias");
  for (const m of ["latest", "mistral-latest", "mistral:stable"]) {
    proev(`'${m}' afvises`, "referat_konfiguration", () => a._hentKonfig({ ...GRUND, TILBUD_REFERAT_MODEL: m }));
  }

  console.log("\nADRESSEN — samme faelde som 27/9");
  proev("access key i url afvises", "referat_konfiguration", () =>
    a._hentKonfig({ ...GRUND, TILBUD_REFERAT_URL: "https://api.scaleway.ai/SCW3ACMTX0SQH5B7ACVD/v1" }));
  proev("url uden projekt-id afvises", "referat_konfiguration", () =>
    a._hentKonfig({ ...GRUND, TILBUD_REFERAT_URL: "https://api.scaleway.ai/v1" }));

  console.log("\nPRISEN — fail-closed paa en ukendt model");
  proev("ukendt models pris afvises", "referat_konfiguration", () =>
    a._hentKonfig({ ...GRUND, TILBUD_REFERAT_MODEL: "mistral-stor-9.9-999b" }));
  const e = a.prisenhed(GRUND);
  ok("enheden er tokens, to takster", `ind ${e.indOerePrMio} / ud ${e.udOerePrMio} oere pr. mio.`);
  // De to maalinger fra proevebaenken. Reproducerer adapteren dem ikke, er
  // taksten eller omregningen forkert — og saa er hele budgettet forkert.
  const m1 = a.prisOere(1181, 1016, GRUND), m2 = a.prisOere(1290, 939, GRUND);
  Math.abs(m1 - 7.01) < 0.02 ? ok("maaling 1/10 reproduceres", `${m1.toFixed(2)} oere`) : nej("maaling 1/10", m1);
  Math.abs(m2 - 6.70) < 0.02 ? ok("maaling 2/10 reproduceres", `${m2.toFixed(2)} oere`) : nej("maaling 2/10", m2);
  const andel = (a.prisOere(0, 1000, GRUND) / a.prisOere(1000, 1000, GRUND)) * 100;
  ok("output er dyrest", `${andel.toFixed(0)} % af prisen ved lige mange tokens`);

  console.log("\nFORMVALIDERING (P5) — form og graenser, aldrig indhold");
  form("gyldigt svar godkendes", J(GYLDIGT), true);
  form("kodeblok-hegn taales", "```json\n" + J(GYLDIGT) + "\n```", true);
  form("tomt svar afvises", "", false, "tomt svar");
  form("ikke-JSON afvises", "her er dit referat!", false, "JSON kan ikke parses");
  form("en liste er ikke et objekt", "[1,2,3]", false, "ikke et objekt");
  form("manglende felt", J({ overskrift: "x", punkter: ["y"] }), false, "felt mangler: fritekst");
  form("opfundet felt", J({ ...GYLDIGT, dato: "2026-10-02" }), false, "opfundet felt: dato");
  form("tom overskrift", J({ ...GYLDIGT, overskrift: "  " }), false, "overskrift er tom");
  form("for lang overskrift", J({ ...GYLDIGT, overskrift: "a".repeat(101) }), false, "overskrift for lang");
  form("punkter er ikke en liste", J({ ...GYLDIGT, punkter: "et punkt" }), false, "ikke en liste");
  form("tom punktliste", J({ ...GYLDIGT, punkter: [] }), false, "punkter er tom");
  form("tomt punkt i listen", J({ ...GYLDIGT, punkter: ["a", "  "] }), false, "tomt punkt");
  form("20 punkter godkendes", J({ ...GYLDIGT, punkter: Array(20).fill("vaeg") }), true);
  form("21 punkter afvises", J({ ...GYLDIGT, punkter: Array(21).fill("vaeg") }), false, "for mange punkter: 21");
  form("tom fritekst", J({ ...GYLDIGT, fritekst: "" }), false, "fritekst er tom");
  form("engelsk svar afvises", J({ overskrift: "Meeting", punkter: ["wall"], fritekst: "We will build it." }),
    false, "dansk");
  form("svar over 8000 tegn", J({ ...GYLDIGT, fritekst: "a".repeat(8100) }), false, "svar over loftet");
}

async function rigtigtKald(fil) {
  if (!fs.existsSync(fil)) { console.log(`\nFEJL: filen findes ikke: ${fil}`); process.exitCode = 1; return; }
  const tekst = fs.readFileSync(fil, "utf8");
  console.log(`\nRIGTIGT KALD — ${path.basename(fil)}, ${tekst.length} tegn`);
  console.log("  (dette koster penge)");

  const ur = Date.now();
  let r;
  try { r = await a.referer({ tekst }); }
  catch (e) {
    console.log(`  FEJL  ${e.kode}: ${e.message}`);
    if (e.uddrag) console.log(`        ${e.uddrag}`);
    if (e.slags === "raesonnerende") console.log("        Skift TILBUD_REFERAT_MODEL til en instruct-model.");
    process.exitCode = 1;
    return;
  }
  const sek = (Date.now() - ur) / 1000;

  console.log(`  svartid         ${sek.toFixed(1)} sek.`);
  console.log(`  punkter         ${r.punkter.length}   (prompten sigter mod 15, graensen er 20)`);
  console.log(`  tokens          ${r.tokensInd} ind + ${r.tokensUd} ud`);
  console.log(`  pris            ${r.prisOere.toFixed(2)} oere`);
  console.log(`  model/prompt    ${r.model} / ${r.promptVersion}`);
  console.log(`\n  overskrift:     ${r.overskrift}`);
  console.log("  (punkter og fritekst vises ikke — referater er persondata)");

  // Vaernet med det samme, hvis det ligger ved siden af.
  try {
    const b = require("./teknik-b");
    const v = b.marker(tekst, r);
    console.log(`\n  TEKNIK B        ${v.antalMarkeringer} markering(er) · ${v.taethed} % taethed` +
      (v.ventil ? "  ⚠️ VENTIL UDLOEST" : ""));
    for (const m of v.markeringer) console.log(`     [${m.typer.join("+")}] "${m.tekst}"  (${m.felt})`);
  } catch (e) {
    console.log("\n  (teknik-b.js ikke fundet — vaernet blev ikke koert)");
  }
}

(async () => {
  const fil = process.argv[2];
  if (fil) return rigtigtKald(fil);
  toerkoersel();
  console.log(`\n${bestaaet} bestaaet, ${fejlet} fejlet.`);
  if (fejlet) process.exitCode = 1;
  else {
    console.log("\nNAESTE: koer mod en rigtig transskription:");
    console.log('  node proev-tekst-adapter.js "C:\\Users\\Bruger\\proevebaenk\\transskriptioner\\optagelse 1 toemrer.txt"');
  }
})();
