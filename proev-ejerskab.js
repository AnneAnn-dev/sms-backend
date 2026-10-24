// proev-ejerskab.js — toerkoersel af ejerskab.js.
//
//   node proev-ejerskab.js
//
// Ingen database, intet netvaerk, ingen omkostning. Supabase-klienten er en
// attrap, der skriver ned, hvad den blev bedt om — saa proeven kan se, at
// FILTERET er med, og ikke bare at kaldet gik igennem.
//
// Det er hele pointen med filen: hjaelperne findes, fordi et filter kan
// glemmes, og en proeve, der kun tjekker returvaerdien, ville ikke opdage, at
// `.eq("firm_id", ...)` var faldet ud.

"use strict";

const e = require("./ejerskab");

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  —  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  —  ${d}`));

function proev(navn, forventet, funktion) {
  try {
    const svar = funktion();
    if (forventet === "ok") ok(navn, typeof svar === "object" ? JSON.stringify(svar) : String(svar));
    else nej(navn, `forventede fejl '${forventet}', men kaldet gik igennem`);
  } catch (f) {
    if (forventet === f.kode) ok(navn, f.message.replace(/^Ejerskab: /, "").slice(0, 70));
    else if (forventet === "ok") nej(navn, `uventet fejl: ${f.message}`);
    else nej(navn, `forventede '${forventet}', fik '${f.kode}'`);
  }
}

async function proevA(navn, forventet, funktion) {
  try {
    const svar = await funktion();
    if (forventet === "ok") ok(navn, JSON.stringify(svar));
    else nej(navn, `forventede fejl '${forventet}', men kaldet gik igennem`);
  } catch (f) {
    if (forventet === f.kode) ok(navn, f.message.replace(/^Ejerskab: /, "").slice(0, 70));
    else if (forventet === "ok") nej(navn, `uventet fejl: ${f.message}`);
    else nej(navn, `forventede '${forventet}', fik '${f.kode}'`);
  }
}

// ─── Attrappen ───────────────────────────────────────────────────────────────
// Skriver hvert `.eq()` ned, saa proeven kan se filtrene bagefter.
function attrap({ data = null, error = null } = {}) {
  const log = { tabel: null, eq: {}, kolonner: null, aendringer: null, op: null };
  const kaede = {
    select(k) { log.kolonner = k; log.op = log.op || "select"; return kaede; },
    update(a) { log.aendringer = a; log.op = "update"; return kaede; },
    insert(a) { log.aendringer = a; log.op = "insert"; return kaede; },
    eq(k, v) { log.eq[k] = v; return kaede; },
    maybeSingle() { return Promise.resolve({ data, error }); },
  };
  return { log, klient: { from(t) { log.tabel = t; return kaede; } } };
}

const FIRMA = "11111111-1111-1111-1111-111111111111";
const ANDET = "22222222-2222-2222-2222-222222222222";
const ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

(async () => {
  console.log("\nmedFirma — oprettelse");
  proev("firm_id saettes paa", "ok", () => e.medFirma(FIRMA, { name: "Hansen" }));
  proev("felterne bevares", "ok", () => {
    const r = e.medFirma(FIRMA, { name: "Hansen", task: "tag" });
    if (r.name !== "Hansen" || r.task !== "tag") throw new Error("felter tabt");
    return r;
  });
  proev("tomme felter er lovlige", "ok", () => e.medFirma(FIRMA));
  proev("manglende firmaid afvises", "ejerskab_firma_mangler", () => e.medFirma(null, { name: "x" }));
  proev("tomt firmaid afvises", "ejerskab_firma_mangler", () => e.medFirma("", { name: "x" }));
  // Den vigtigste af dem: kommer firm_id ind med indholdet, bestemmer
  // KLIENTEN, hvis data raekken bliver. Det er praecis den fejl, filen findes
  // for at forhindre, og den ser harmloes ud i et code review.
  proev("firm_id i indholdet afvises", "ejerskab_firma_dobbelt",
    () => e.medFirma(FIRMA, { name: "x", firm_id: ANDET }));

  console.log("\nhentEgenRaekke — laesning foer skrivning");
  {
    const a = attrap({ data: { id: ID, firm_id: FIRMA } });
    await proevA("raekken hentes", "ok", () => e.hentEgenRaekke(a.klient, "leads", ID, FIRMA));
    // Returvaerdien beviser ingenting om sikkerheden. Filteret goer.
    proev("filteret er MED i forespoergslen", "ok", () => {
      if (a.log.eq.firm_id !== FIRMA) throw new Error("firm_id-filteret mangler");
      if (a.log.eq.id !== ID) throw new Error("id-filteret mangler");
      if (a.log.tabel !== "leads") throw new Error("forkert tabel");
      return a.log.eq;
    });
  }
  {
    const a = attrap({ data: null });
    await proevA("fremmed raekke giver ikke_fundet", "ejerskab_ikke_fundet",
      () => e.hentEgenRaekke(a.klient, "leads", ID, FIRMA));
  }
  {
    const a = attrap({ error: { message: "connection reset" } });
    // En nede database maa IKKE ligne "ikke din". Gjorde den det, ville man
    // lede efter et forkert id i stedet for efter databasen.
    await proevA("databasefejl er ikke ikke_fundet", "ejerskab_laesning",
      () => e.hentEgenRaekke(a.klient, "leads", ID, FIRMA));
  }
  await proevA("manglende firmaid afvises", "ejerskab_firma_mangler",
    () => e.hentEgenRaekke(attrap().klient, "leads", ID, null));
  await proevA("manglende id afvises", "ejerskab_id_mangler",
    () => e.hentEgenRaekke(attrap().klient, "leads", null, FIRMA));

  console.log("\nopdaterEgenRaekke");
  {
    const a = attrap({ data: { id: ID, firm_id: FIRMA, titel: "ny" } });
    await proevA("opdatering gaar igennem", "ok",
      () => e.opdaterEgenRaekke(a.klient, "leads", ID, FIRMA, { titel: "ny" }));
    proev("filteret er MED i opdateringen", "ok", () => {
      if (a.log.eq.firm_id !== FIRMA) throw new Error("firm_id-filteret mangler");
      if (a.log.eq.id !== ID) throw new Error("id-filteret mangler");
      if (a.log.op !== "update") throw new Error("det var ikke en update");
      return a.log.eq;
    });
  }
  // En opdatering maa aldrig kunne flytte en raekke til et andet firma —
  // heller ikke ved et uheld, heller ikke til ens eget.
  await proevA("firm_id kan ikke aendres med", "ejerskab_firma_flyttes",
    () => e.opdaterEgenRaekke(attrap().klient, "leads", ID, FIRMA, { firm_id: ANDET }));
  {
    const a = attrap({ data: null });
    await proevA("fremmed raekke kan ikke opdateres", "ejerskab_ikke_fundet",
      () => e.opdaterEgenRaekke(a.klient, "leads", ID, FIRMA, { titel: "ny" }));
  }

  console.log(`\n${bestaaet} bestaaet, ${fejlet} fejlet.`);
  if (fejlet) process.exitCode = 1;
  else {
    console.log("\nBemaerk: det her er en toerkoersel. Den beviser, at filtrene er");
    console.log("med i kaldene — ikke at RLS virker. Det beviser rls-isolation-test.js.");
  }
})();
