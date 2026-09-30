// proev-transskriber.js — sender rigtige lydfiler til POST /api/tilbud/transskriber.
//
// TOKENET GIVES ALDRIG PAA KOMMANDOLINJEN. Saet det i miljoeet foerst:
//
//   $env:TILBUD_TEST_TOKEN = "eyJ..."          (PowerShell, kun dette vindue)
//   node proev-transskriber.js <fil> [fil2 ...]
//   node proev-transskriber.js --base https://sms-backend-staging-xxx.up.railway.app <fil>
//
// Grunden (haendelse 30/9): et token paa kommandolinjen staar i PowerShells
// historik, i skaermbilleder og i det, man kopierer ind i en chat for at vise
// hvad man koerte. Et token ER et login. Ligger det i en variabel, forsvinder
// det, naar vinduet lukkes, og det kommer aldrig med i et klip.
//
// Ryd op bagefter:  Remove-Item Env:TILBUD_TEST_TOKEN
//
// KOSTER PENGE. Hver del afregnes som et rigtigt kald (ca. 6 oere pr. 2½ minut).
//
// Tokenet laeses af firmIdFromToken() fra "Authorization: Bearer <token>"
// (auth.js, bekraeftet 29/9). Det er en Supabase-session fra DET dashboard,
// miljoeet hoerer til - et staging-token virker ikke mod prod.

"use strict";

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
let base = "http://localhost:3000";
const b = args.indexOf("--base");
if (b !== -1) { base = args[b + 1]; args.splice(b, 2); }

const filer = args;
const token = (process.env.TILBUD_TEST_TOKEN || "").trim();

if (!token) {
  console.log("\nTILBUD_TEST_TOKEN mangler.\n");
  console.log("  Hent tokenet i browserens konsol paa dashboardet:");
  console.log("    JSON.parse(localStorage[Object.keys(localStorage)");
  console.log("      .find(k => k.endsWith('-auth-token'))]).access_token\n");
  console.log("  Saet det i DETTE vindue (ikke i en fil, ikke paa kommandolinjen):");
  console.log('    $env:TILBUD_TEST_TOKEN = "eyJ..."\n');
  process.exit(1);
}
if (!filer.length) {
  console.log("Brug: node proev-transskriber.js [--base <url>] <fil> [fil2 ...]");
  process.exit(1);
}
// Et token, der ikke ligner et token, skal fanges HER - ikke som en 401,
// der faar én til at lede efter fejlen i ruten.
if (!/^eyJ[\w-]+\.[\w-]+\./.test(token)) {
  console.log("TILBUD_TEST_TOKEN ligner ikke et JWT. Hentede du hele straengen?");
  process.exit(1);
}

(async () => {
  // 1. Kvoten FOER — samme spoergsmaal, som fanen stiller, foer han trykker optag
  const k = await fetch(`${base}/api/tilbud/kvote`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const kvote = await k.json();
  console.log(`\nKVOTE FOER  (${k.status})`);
  if (k.ok) {
    console.log(`  forbrugt i maaneden  ${(kvote.forbrugtOere / 100).toFixed(2)} kr af ${(kvote.loftOere / 100).toFixed(2)}`);
    console.log(`  forbrugt i dag       ${(kvote.forbrugtIDagOere / 100).toFixed(2)} kr af ${(kvote.dagsloftOere / 100).toFixed(2)}`);
    console.log(`  spaerret             ${kvote.spaerret}   naesten opbrugt: ${kvote.naestenOpbrugt}`);
  } else {
    console.log(" ", JSON.stringify(kvote));
  }

  // 2. Selve kaldet
  const krop = new FormData();
  let bytes = 0;
  for (const f of filer) {
    const data = fs.readFileSync(f);
    bytes += data.length;
    krop.append("dele", new Blob([data]), path.basename(f));
  }
  console.log(`\nSENDER ${filer.length} del(e), ${(bytes / 1e6).toFixed(1)} MB — dette koster penge`);

  const ur = Date.now();
  const r = await fetch(`${base}/api/tilbud/transskriber`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: krop,
  });
  const sek = (Date.now() - ur) / 1000;
  const svar = await r.json();

  console.log(`\nSVAR  ${r.status}   efter ${sek.toFixed(1)} sek.`);
  if (!r.ok) {
    console.log(`  fejl    ${svar.error}`);
    console.log(`  besked  ${svar.besked || "(ingen)"}`);
    process.exit(1);
  }
  console.log(`  dele            ${svar.dele.map((d) => `#${d.nr}: ${d.lydsekunder}s / ${d.tegn} tegn`).join(" · ")}`);
  console.log(`  lyd i alt       ${svar.lydsekunderIAlt} sek.`);
  console.log(`  forhold         1 : ${(svar.lydsekunderIAlt / sek).toFixed(0)}`);
  console.log(`  pris            ${svar.prisOere} oere`);
  console.log(`  rest paa loftet ${(svar.restOere / 100).toFixed(2)} kr`);
  console.log(`  tegn i alt      ${svar.tekst.length}`);
  console.log(`\n  foerste 120 tegn:  ${svar.tekst.slice(0, 120)}...`);
  console.log("\n  (resten vises ikke — transskriptioner er persondata)");

  // 3. Kvoten EFTER — beviser, at bogfoeringen skete
  const k2 = await fetch(`${base}/api/tilbud/kvote`, { headers: { Authorization: `Bearer ${token}` } });
  const kvote2 = await k2.json();
  const diff = kvote2.forbrugtOere - kvote.forbrugtOere;
  console.log(`\nKVOTE EFTER`);
  console.log(`  forbruget steg med ${diff} oere (kaldet kostede ${svar.prisOere})`);
  console.log(diff === svar.prisOere
    ? "  ✓ bogfoeringen stemmer"
    : "  ✗ BOGFOERINGEN STEMMER IKKE — se ai_forbrug");
})();
