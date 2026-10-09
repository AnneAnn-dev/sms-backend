// proev-datafunktioner.js — gaar hele vejen gennem kunder, opgaver og referater.
//
//   $env:TILBUD_TEST_TOKEN = "eyJ..."
//   node proev-datafunktioner.js --base https://<staging>.up.railway.app
//
// TOKENET GIVES ALDRIG PAA KOMMANDOLINJEN (haendelse 30/9).
// Ryd op bagefter:  Remove-Item Env:TILBUD_TEST_TOKEN
//
// Koster INGENTING: ingen model bliver ringet op. Transskript og udkast er
// korte, opdigtede tekster - nok til at teknik B har noget at taelle.
//
// ⚠️ DEN RYDDER IKKE OP EFTER SIG. Der er ingen slette-ruter endnu (bevidst:
// delete-politikkerne venter paa en rigtig kunde). Alt, den opretter, hedder
// "PROEVE" og faar sit koerselsid med, og til sidst skriver den den SQL, der
// fjerner det igen. En proeve, der efterlader data uden at sige det, goer
// staging til et sted man ikke tror paa.

"use strict";

const args = process.argv.slice(2);
let base = "http://localhost:3000";
const b = args.indexOf("--base");
if (b !== -1) { base = args[b + 1]; args.splice(b, 2); }

const token = (process.env.TILBUD_TEST_TOKEN || "").trim();
if (!token) {
  console.log("\nTILBUD_TEST_TOKEN mangler.\n");
  console.log("  Hent det i browserkonsollen paa dashboardet:");
  console.log("    copy(JSON.parse(localStorage[Object.keys(localStorage)");
  console.log("      .find(k => k.endsWith('-auth-token'))]).access_token)\n");
  console.log("  Og saet det (SKRIV linjen, kopiér den ikke - saa overskriver du tokenet):");
  console.log('    $env:TILBUD_TEST_TOKEN = (Get-Clipboard).Trim()\n');
  process.exit(1);
}
if (!/^eyJ[\w-]+\.[\w-]+\./.test(token)) {
  console.log("TILBUD_TEST_TOKEN ligner ikke et JWT. Hentede du hele straengen?");
  process.exit(1);
}

const KOERSEL = Math.random().toString(36).slice(2, 8);
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

let bestaaet = 0, fejlet = 0;
const ok  = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  —  " + d : ""}`));
const nej = (n, d) => (fejlet++,  console.log(`  FEJL  ${n}  —  ${d}`));

async function kald(metode, sti, krop) {
  try {
    const svar = await fetch(base + sti, {
      method: metode, headers: H,
      body: krop === undefined ? undefined : JSON.stringify(krop),
    });
    let data = null;
    try { data = await svar.json(); } catch (_) { /* tom krop er lovligt */ }
    return { status: svar.status, data };
  } catch (e) {
    const k = e.cause?.code || e.code || "";
    const forklaring = {
      ECONNREFUSED: "ingen svarer — koerer serveren, og er --base rigtig?",
      ENOTFOUND: "adressen findes ikke — tjek stavemaaden i --base",
    }[k];
    console.log(`\nFEJL mod ${sti}: ${forklaring || e.message}`);
    process.exitCode = 1;
    return null;
  }
}

/** Forventer en bestemt status. Returnerer kroppen, eller null hvis det slog fejl. */
async function proev(navn, forventet, metode, sti, krop) {
  const s = await kald(metode, sti, krop);
  if (!s) { nej(navn, "ingen forbindelse"); return null; }
  if (s.status === forventet) {
    ok(navn, s.data && s.data.error ? s.data.error : String(s.status));
    return s.data;
  }
  nej(navn, `forventede ${forventet}, fik ${s.status} ${JSON.stringify(s.data).slice(0, 120)}`);
  return null;
}

const FALSK_ID = "00000000-0000-4000-8000-000000000000";

(async () => {
  console.log(`\n=== Datafunktioner ===\nBase:       ${base}\nKoersels-id: ${KOERSEL}\n`);

  console.log("Afvisninger — ingen af dem maa oprette noget:");
  {
    // Uden token. Egen header, saa den rigtige ikke sendes med.
    const s = await fetch(base + "/api/tilbud/opgaver", { headers: { "Content-Type": "application/json" } });
    s.status === 401 ? ok("uden token: 401") : nej("uden token", `fik ${s.status}`);
  }
  await proev("kunde uden navn afvises",      400, "POST", "/api/tilbud/kunder",   { telefon: "+4512345678" });
  await proev("opgave uden felter afvises",   400, "POST", "/api/tilbud/opgaver",  {});
  await proev("referat uden opgave afvises",  400, "POST", "/api/tilbud/referater", { ai_udkast: "noget" });
  // Den vigtigste: et id, der ikke er firmaets, maa ikke kunne bruges.
  await proev("opgave paa fremmed kunde afvises", 404, "POST", "/api/tilbud/opgaver",
    { name: `PROEVE ${KOERSEL}`, address: "Testvej 1", task: "proeve", kunde_id: FALSK_ID });
  await proev("referat paa fremmed opgave afvises", 404, "POST", "/api/tilbud/referater",
    { lead_id: FALSK_ID, ai_udkast: "noget" });

  console.log("\nKunde:");
  const telefon = `+4590${Math.floor(100000 + Math.random() * 899999)}`;
  const k = await proev("oprettes", 201, "POST", "/api/tilbud/kunder",
    { navn: `PROEVE Kunde ${KOERSEL}`, telefon, er_erhverv: false });
  if (!k) return afslut();
  const kundeId = k.kunde.id;

  // Unikken paa telefon pr. firma (primeren, punkt 6) — den findes for at
  // lukke dublet-spoegelset. En 409 og ikke en 500.
  await proev("samme telefon igen giver 409", 409, "POST", "/api/tilbud/kunder",
    { navn: `PROEVE Dublet ${KOERSEL}`, telefon });

  await proev("rettes", 200, "PATCH", `/api/tilbud/kunder/${kundeId}`, { noter: "rettet af proeven" });
  await proev("fremmed kunde kan ikke rettes", 404, "PATCH", `/api/tilbud/kunder/${FALSK_ID}`, { noter: "nej" });

  console.log("\nOpgave:");
  const o = await proev("oprettes uden opkald", 201, "POST", "/api/tilbud/opgaver", {
    name: `PROEVE Opgave ${KOERSEL}`, address: "Testvej 1, 8000 Aarhus C",
    task: "Udskiftning af tagrende", kunde_id: kundeId,
  });
  if (!o) return afslut();
  const opgaveId = o.opgave.id;

  const liste = await proev("staar i listen", 200, "GET", "/api/tilbud/opgaver");
  if (liste) {
    const min = (liste.opgaver || []).find((x) => x.id === opgaveId);
    if (!min) nej("den nye opgave er i listen", "den blev oprettet, men kom ikke med");
    else if (!min.kunder || !min.kunder.navn) nej("kundens navn er med", "kunder(navn) kom ikke med");
    else ok("den nye opgave er i listen, med kundens navn", min.kunder.navn);
  }

  console.log("\nReferat:");
  // Teknik B skal have noget at finde: "OSB" og "7330" staar i udkastet og
  // IKKE i transskriptionen. Det er praecis den fejlklasse, vaernet findes for.
  const transskript = "Vi talte om taget og om at der skal nye plader paa i naeste uge.";
  const udkast = "- Nye OSB-plader paa taget i uge 7330\n\nAftalen blev bekraeftet paa stedet.";
  const r = await proev("gemmes", 201, "POST", "/api/tilbud/referater", {
    lead_id: opgaveId, titel: `PROEVE Referat ${KOERSEL}`,
    transskript, ai_udkast: udkast, varighed_sek: 95,
    ai_model: "mistral-medium-3.5-128b", ai_prompt_version: "2026-10-02",
  });
  if (r) {
    const m = r.referat.teknik_b_markeringer, ord = r.referat.teknik_b_ord;
    if (m == null || ord == null) nej("teknik B blev maalt", `markeringer=${m}, ord=${ord} — begge skal vaere tal`);
    else if (m < 1) nej("teknik B fandt noget", `${m} markeringer — OSB og 7330 staar ikke i transskriptionen`);
    else ok("teknik B blev maalt og gemt", `${m} markering(er) i ${ord} ord`);
    if (r.referat.status !== "kladde") nej("status er kladde fra start", `fik '${r.referat.status}'`);
    else ok("status er kladde fra start");
  }

  const hel = await proev("opgaven har referatet", 200, "GET", `/api/tilbud/opgaver/${opgaveId}`);
  if (hel) {
    const n = (hel.referater || []).length;
    n === 1 ? ok("ét referat paa opgaven") : nej("ét referat paa opgaven", `fandt ${n}`);
  }

  if (r) {
    await proev("indhold kan rettes", 200, "PATCH", `/api/tilbud/referater/${r.referat.id}`,
      { indhold: "Haandvaerkerens egen rettede version." });
    await proev("ukendt status afvises", 400, "PATCH", `/api/tilbud/referater/${r.referat.id}`,
      { status: "naesten" });
    // Kildematerialet maa ikke kunne rettes — ellers er sammenligningen med
    // `indhold` intet vaerd, og teknik B-tallene maaler noget andet end det,
    // modellen skrev.
    await proev("transskript kan IKKE rettes", 400, "PATCH", `/api/tilbud/referater/${r.referat.id}`,
      { transskript: "omskrevet" });
  }

  afslut(kundeId, opgaveId);

  function afslut(kId, oId) {
    console.log(`\n${bestaaet} bestaaet, ${fejlet} fejlet.`);
    if (fejlet) process.exitCode = 1;
    console.log("\nPROEVEN RYDDER IKKE OP. Koer dette i SQL-editoren bagefter:");
    console.log(`  delete from referater where titel like 'PROEVE%${KOERSEL}%';`);
    if (oId) console.log(`  delete from leads  where id = '${oId}';`);
    if (kId) console.log(`  delete from kunder where id = '${kId}';`);
    console.log("");
  }
})();
