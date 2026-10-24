// proev-referat-rute.js — proever POST /api/tilbud/referat mod et rigtigt miljoe.
//
//   $env:TILBUD_TEST_TOKEN = "eyJ..."
//   node proev-referat-rute.js --base https://<staging>.up.railway.app "<transskription>.txt"
//
// TOKENET GIVES ALDRIG PAA KOMMANDOLINJEN — samme grund som i
// proev-transskriber.js (haendelse 30/9): et token paa kommandolinjen staar i
// PowerShells historik, i skaermbilleder og i det, man kopierer ind i en chat.
// Ryd op bagefter:  Remove-Item Env:TILBUD_TEST_TOKEN
//
// KOSTER PENGE. Ca. 7 oere pr. referat.
//
// Referatet skrives IKKE ud i fuld laengde — det er persondata (CLAUDE.md).
// Markeringerne vises derimod ordret: de ER pointen, og de er faa.

"use strict";

const fs = require("fs");

const args = process.argv.slice(2);
let base = "http://localhost:3000";
const b = args.indexOf("--base");
if (b !== -1) { base = args[b + 1]; args.splice(b, 2); }

const fil = args[0];
const token = (process.env.TILBUD_TEST_TOKEN || "").trim();

if (!token) {
  console.log("\nTILBUD_TEST_TOKEN mangler.\n");
  console.log("  Hent tokenet i browserens konsol paa dashboardet:");
  console.log("    JSON.parse(localStorage[Object.keys(localStorage)");
  console.log("      .find(k => k.endsWith('-auth-token'))]).access_token\n");
  console.log('  Saet det i DETTE vindue:  $env:TILBUD_TEST_TOKEN = "eyJ..."\n');
  process.exit(1);
}
if (!/^eyJ[\w-]+\.[\w-]+\./.test(token)) {
  console.log("TILBUD_TEST_TOKEN ligner ikke et JWT. Hentede du hele straengen?");
  process.exit(1);
}
if (!fil) {
  console.log('Brug: node proev-referat-rute.js [--base <url>] "<transskription>.txt"');
  process.exit(1);
}
if (!fs.existsSync(fil)) {
  console.log(`FEJL: filen findes ikke: ${fil}`);
  process.exit(1);
}

// Samme oversaettelse som i proev-transskriber.js: en raa stak paa tredive
// linjer, hvor det eneste brugbare ord er ECONNREFUSED, er ikke en fejlbesked.
async function hent(url, indstillinger) {
  try {
    return await fetch(url, indstillinger);
  } catch (e) {
    const k = e.cause?.code || e.code || "";
    const forklaring = {
      ECONNREFUSED: "ingen svarer paa adressen — koerer serveren, og er --base rigtig?",
      ENOTFOUND: "adressen findes ikke — tjek stavemaaden i --base",
      ECONNRESET: "forbindelsen blev afbrudt undervejs",
      UND_ERR_CONNECT_TIMEOUT: "ingen forbindelse inden for tidsgraensen",
    }[k];
    console.log(`\nFEJL mod ${url}`);
    console.log("  " + (forklaring || e.message));
    process.exitCode = 1;
    return null;
  }
}

const H = { Authorization: `Bearer ${token}` };
const kr = (oere) => (oere / 100).toFixed(2);

(async () => {
  const tekst = fs.readFileSync(fil, "utf8");
  console.log(`\nTRANSSKRIPTION   ${tekst.length} tegn fra ${fil}`);

  // ── Kvoten foer ───────────────────────────────────────────────────────────
  const foerSvar = await hent(`${base}/api/tilbud/kvote`, { headers: H });
  if (!foerSvar) return;
  const foer = await foerSvar.json();
  if (!foerSvar.ok) {
    console.log(`\nKVOTE FOER  (${foerSvar.status})  ${JSON.stringify(foer)}`);
    return;
  }
  console.log(`\nKVOTE FOER  (${foerSvar.status})`);
  console.log(`  forbrugt i maaneden  ${kr(foer.forbrugtOere)} kr af ${kr(foer.loftOere)}`);
  console.log(`  spaerret             ${foer.spaerret}`);
  const forbrugtFoer = foer.forbrugtOere;

  // ── Kaldet ────────────────────────────────────────────────────────────────
  console.log(`\nSENDER — dette koster penge`);
  const t0 = Date.now();
  const svar = await hent(`${base}/api/tilbud/referat`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ transskription: tekst }),
  });
  if (!svar) return;
  const sek = ((Date.now() - t0) / 1000).toFixed(1);
  const r = await svar.json().catch(() => ({}));

  console.log(`\nSVAR  ${svar.status}   efter ${sek} sek.`);
  if (!svar.ok) {
    console.log(`  fejl    ${r.error}`);
    console.log(`  besked  ${r.besked}`);
    process.exitCode = 1;
    return;
  }

  console.log(`  punkter         ${r.punkter.length}   (prompten sigter mod 15, graensen er 20)`);
  console.log(`  pris            ${r.prisOere} oere`);
  console.log(`  rest paa loftet ${kr(r.restOere)} kr`);
  console.log(`  model/prompt    ${r.model} / ${r.promptVersion}`);
  console.log(`\n  overskrift:     ${r.overskrift}`);
  console.log("  (punkter og fritekst vises ikke — referater er persondata)");

  // ── Vaernet ───────────────────────────────────────────────────────────────
  console.log(`\nTEKNIK B        ${r.markeringer.length} markering(er) · ${r.taethed} % taethed`);
  for (const m of r.markeringer) {
    console.log(`   [${m.typer.join("+")}] "${m.tekst}"  (${m.felt})`);
  }
  if (r.taethed === null) {
    console.log("   ⚠️ vaernet kunne ikke koere — se serverens log. Referatet er stadig gyldigt.");
  }

  // ── Kvoten efter ──────────────────────────────────────────────────────────
  // Det afgoerende tjek. Et referat, der er leveret uden at vaere bogfoert,
  // er et referat, kvoten ikke ved findes — og saa holder loftet ikke.
  const efterSvar = await hent(`${base}/api/tilbud/kvote`, { headers: H });
  if (!efterSvar) return;
  const efter = await efterSvar.json();
  const steg = efter.forbrugtOere - forbrugtFoer;
  console.log(`\nKVOTE EFTER`);
  console.log(`  forbruget steg med ${steg.toFixed(2)} oere (kaldet kostede ${r.prisOere})`);
  if (Math.abs(steg - r.prisOere) < 0.01) {
    console.log("  ✓ bogfoeringen stemmer");
  } else {
    console.log("  ✗ BOGFOERINGEN STEMMER IKKE — stop og find ud af hvorfor");
    process.exitCode = 1;
  }
})();
