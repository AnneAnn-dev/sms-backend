// proev-asr-adapter.js — prøver asr-adapter.js uden at røre en rute.
//
// To tilstande:
//
//   node proev-asr-adapter.js
//       Tørkørsel. Ingen netværk, ingen omkostning. Prøver det, der kan gå
//       galt i konfigurationen og i normaliseringen — altså det, der er dyrt
//       at opdage i produktion.
//
//   node proev-asr-adapter.js "C:\Users\Bruger\proevebaenk\lydfiler\optagelse 1 toemrer.m4a"
//       Rigtigt kald mod leverandøren. KOSTER PENGE (ca. 6 øre for 2½ minut).
//       Kræver TILBUD_ASR_* og nøglen i miljøet.
//
// Teksten skrives IKKE ud i fuld længde: transskriptioner er persondata
// (CLAUDE.md, Sikkerhed). Der vises de første 120 tegn, så du kan se, at der
// kom dansk retur — resten er tal om formen.

"use strict";

// Et selvstaendigt script kalder ikke server.js's opstart, saa dotenv skal
// indlaeses her. Uden denne linje ser scriptet ingen af TILBUD_ASR_*, uanset
// om de staar i .env. (Fundet 27/9 ved foerste rigtige kald.)
//
// try/catch, fordi toerkoerslen skal kunne koere uden node_modules — den
// laeser ingen variabler og skal kunne bruges som et rent syntakstjek.
try {
  require("dotenv").config({ quiet: true });
} catch (e) {
  if (process.argv[2]) {
    console.log("ADVARSEL: dotenv kunne ikke indlaeses — .env bliver IKKE laest.");
    console.log("          Koer scriptet fra repo-roden, hvor node_modules findes.");
  }
}

const fs = require("fs");
const path = require("path");
const a = require("./asr-adapter");

let bestaaet = 0;
let fejlet = 0;

function proev(navn, forventet, funktion) {
  // forventet: "ok" eller en fejlkode, der SKAL komme
  try {
    const svar = funktion();
    if (forventet === "ok") {
      ok(navn, typeof svar === "object" ? JSON.stringify(svar) : String(svar));
    } else {
      nej(navn, `forventede fejl '${forventet}', men kaldet gik igennem`);
    }
  } catch (e) {
    if (forventet === e.kode) ok(navn, e.message.replace("ASR-konfiguration: ", ""));
    else if (forventet === "ok") nej(navn, `uventet fejl: ${e.message}`);
    else nej(navn, `forventede '${forventet}', fik '${e.kode}'`);
  }
}

function ok(navn, detalje) {
  bestaaet++;
  console.log(`  OK    ${navn}${detalje ? "  —  " + detalje : ""}`);
}
function nej(navn, detalje) {
  fejlet++;
  console.log(`  FEJL  ${navn}  —  ${detalje}`);
}

const GRUND = {
  TILBUD_ASR_LEVERANDOER: "scaleway",
  TILBUD_ASR_URL: "https://api.scaleway.ai/projekt-id/v1/",
  TILBUD_ASR_MODEL: "whisper-large-v3",
  SCW_ASR_SECRET_KEY: "test",
};
const SYV = {
  TILBUD_ASR_LEVERANDOER: "syv.ai",
  TILBUD_ASR_URL: "https://platform.syv.ai/v1",
  TILBUD_ASR_MODEL: "syv-transcribe",
  SYVAI_API_KEY: "test",
};

function toerkoersel() {
  console.log("\nKONFIGURATION — fail-closed, som flags.js");
  proev("fuld konfiguration accepteres", "ok", () => a._hentKonfig(GRUND).model);
  proev("leverandoer mangler", "asr_konfiguration", () =>
    a._hentKonfig({ ...GRUND, TILBUD_ASR_LEVERANDOER: "" })
  );
  proev("ukendt leverandoer", "asr_konfiguration", () =>
    a._hentKonfig({ ...GRUND, TILBUD_ASR_LEVERANDOER: "openai" })
  );
  proev("url mangler", "asr_konfiguration", () => a._hentKonfig({ ...GRUND, TILBUD_ASR_URL: "" }));
  proev("model mangler", "asr_konfiguration", () =>
    a._hentKonfig({ ...GRUND, TILBUD_ASR_MODEL: "" })
  );
  proev("noeglen hedder leverandoerens navn", "asr_konfiguration", () =>
    a._hentKonfig({ ...GRUND, SCW_ASR_SECRET_KEY: "" })
  );
  proev("syv.ai kraever SIN egen noegle", "asr_konfiguration", () =>
    a._hentKonfig({ ...SYV, SYVAI_API_KEY: "" })
  );

  console.log("\nD14 — modelstrengen maa ikke vaere et alias");
  for (const m of ["latest", "whisper-latest", "whisper:latest", "stable"]) {
    proev(`'${m}' afvises`, "asr_konfiguration", () =>
      a._hentKonfig({ ...GRUND, TILBUD_ASR_MODEL: m })
    );
  }
  proev("'whisper-large-v3' accepteres", "ok", () => a._hentKonfig(GRUND).model);

  console.log("\nPRISEN ER EN ENHED, IKKE EN KONSTANT");
  proev("scaleway afregner pr. lydminut", "ok", () => a.prisenhed(GRUND));
  proev("syv.ai afregner pr. lydtime", "ok", () => a.prisenhed(SYV));
  const s = a.prisOere(161, GRUND);
  const y = a.prisOere(161, SYV);
  ok("2 min 41 sek. koster", `${s.toFixed(2)} oere hos scaleway, ${y.toFixed(2)} oere hos syv.ai`);
  if (Math.abs(s - 6.01) > 0.05) nej("scaleway-prisen", `forventede ca. 6,01 oere, fik ${s}`);

  console.log("\nNORMALISERING — alt leverandoerspecifikt stopper i adapteren");
  const k = a._hentKonfig(GRUND);
  const r = a._normaliser(
    {
      text: "  Der var byggemoede i dag.  ",
      language: "da",
      duration: 161.7,
      segments: [
        { start: 0, end: 18.3, text: " Der var byggemoede", no_speech_prob: 0, avg_logprob: -0.16 },
        { start: 18.3, end: 45.6, text: " i dag." },
      ],
    },
    k
  );
  r.tekst === "Der var byggemoede i dag."
    ? ok("teksten trimmes")
    : nej("teksten trimmes", r.tekst);
  r.segmenter.length === 2 ? ok("segmenter bevares") : nej("segmenter bevares", r.segmenter.length);
  r.segmenter[1].konfidens === null && r.segmenter[1].ingenTaleSandsynlighed === null
    ? ok("manglende konfidens giver null, ikke en fejl")
    : nej("manglende konfidens", JSON.stringify(r.segmenter[1]));
  r.lydsekunder === 161.7 ? ok("lydsekunder er grundlaget for prisen") : nej("lydsekunder", r.lydsekunder);
  r.leverandoer === "scaleway" && r.model === "whisper-large-v3"
    ? ok("leverandoer og model foelger med svaret")
    : nej("leverandoer/model", JSON.stringify(r));

  const tom = a._normaliser({ text: "hej" }, k);
  tom.segmenter.length === 0 && tom.varighedSek === null
    ? ok("svar uden segmenter faelder ikke adapteren")
    : nej("svar uden segmenter", JSON.stringify(tom));

  console.log("\nORDLISTEN — tages imod, kastes vaek hos den der ikke kan bruge den");
  a._LEVERANDOERER["scaleway"].stoetterOrdliste === false
    ? ok("scaleway: ingen ordliste")
    : nej("scaleway", "burde ikke stoette ordliste");
  a._LEVERANDOERER["syv.ai"].stoetterOrdliste === true
    ? ok("syv.ai: Vocabulary")
    : nej("syv.ai", "burde stoette ordliste");
}

async function rigtigtKald(fil) {
  if (!fs.existsSync(fil)) {
    console.log(`\nFEJL: filen findes ikke: ${fil}`);
    process.exit(1);
  }
  const lyd = fs.readFileSync(fil);
  const navn = path.basename(fil);
  console.log(`\nRIGTIGT KALD — ${navn}, ${(lyd.length / 1e6).toFixed(1)} MB`);
  console.log("  (dette koster penge)");

  const ur = Date.now();
  let svar;
  try {
    svar = await a.transskriber({ lyd, filnavn: navn, sprog: "da" });
  } catch (e) {
    console.log(`  FEJL  ${e.kode}: ${e.message}`);
    if (e.uddrag) console.log(`        ${e.uddrag}`);
    if (e.kode === "asr_konfiguration") {
      console.log("");
      console.log("  Variablerne saettes i .env.staging — ALDRIG i .env direkte —");
      console.log("  og derefter koeres skift-staging.ps1:");
      console.log("");
      console.log("    TILBUD_ASR_LEVERANDOER=scaleway");
      console.log("    TILBUD_ASR_URL=https://api.scaleway.ai/<projekt-id>/v1");
      console.log("    TILBUD_ASR_MODEL=whisper-large-v3");
      console.log("    SCW_ASR_SECRET_KEY=<noeglen fra IAM-applicationen>");
      console.log("");
      console.log("  Projekt-id og noegle er de samme, som proevebaenken bruger.");
      console.log("  Bekraeft bagefter med:  node check-env.js --live");
    }
    process.exit(1);
  }
  const sek = (Date.now() - ur) / 1000;

  console.log(`  svartid            ${sek.toFixed(1)} sek.`);
  console.log(`  lydsekunder        ${svar.lydsekunder}`);
  console.log(`  forhold            1 : ${(svar.lydsekunder / sek).toFixed(0)}`);
  console.log(`  segmenter          ${svar.segmenter.length}`);
  console.log(`  tegn i teksten     ${svar.tekst.length}`);
  console.log(`  leverandoer/model  ${svar.leverandoer} / ${svar.model}`);
  console.log(`  pris               ${a.prisOere(svar.lydsekunder).toFixed(2)} oere`);
  const medKonfidens = svar.segmenter.filter((s) => s.konfidens !== null).length;
  console.log(`  segmenter m. konfidens  ${medKonfidens} af ${svar.segmenter.length}`);
  console.log(`\n  foerste 120 tegn:  ${svar.tekst.slice(0, 120)}...`);
  console.log("\n  (resten vises ikke — transskriptioner er persondata)");
}

(async () => {
  const fil = process.argv[2];
  if (fil) {
    await rigtigtKald(fil);
    return;
  }
  toerkoersel();
  console.log(`\n${bestaaet} bestaaet, ${fejlet} fejlet.`);
  if (fejlet) process.exit(1);
  console.log("\nNAESTE: koer mod en rigtig fil for at se formen fra leverandoeren:");
  console.log('  node proev-asr-adapter.js "C:\\Users\\Bruger\\proevebaenk\\lydfiler\\<fil>.m4a"');
})();
