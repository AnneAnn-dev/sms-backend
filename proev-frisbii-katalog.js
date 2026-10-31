// proev-frisbii-katalog.js -- proever frisbii-katalog.js. Ingen netvaerk, ingen
// database, ingen miljoevariabler (koeres i CI via kor-proever.js).
//
//   node proev-frisbii-katalog.js
//
// Tre ting, der hver for sig ville blive roede, hvis de gled fra hinanden:
//  1. kataloget og MODULER (moduler.js)
//  2. MODULER og CHECK-reglen firma_moduler_modul i migrationerne
//  3. oversaettelsen plan + add-ons -> moduler, med de svar, vi har maalt
// Og kataloget proeves med vilje i stykker, saa tjekKatalog ses roed.
// Fase 3, T1a (28/10-26). Ren ASCII.
"use strict";

const fs = require("fs");
const path = require("path");
const { MODULER } = require("./moduler");
const kat = require("./frisbii-katalog");
const { KATALOG, modulerFraHandles, handleForModul, produkterTilSalg, tjekKatalog } = kat;

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  return a === b ? ok(n, a) : nej(n, `fik ${a}, forventede ${b}`);
};
const kopi = () => JSON.parse(JSON.stringify(KATALOG));

console.log("1. Kataloget i sig selv");
lig("tjekKatalog finder ingen fejl", tjekKatalog(), []);
lig("kataloget og MODULER naevner de samme moduler",
  Object.keys(KATALOG.MODUL_ADDONS).sort(), [...MODULER].sort());

console.log("\n2. MODULER og CHECK-reglen i databasen");
// Den SENESTE definition af firma_moduler_modul i migrationerne er den, der gaelder.
const migDir = path.join(__dirname, "supabase", "migrations");
let checkModuler = null, checkFil = null;
for (const f of fs.readdirSync(migDir).filter((x) => x.endsWith(".sql")).sort()) {
  const sql = fs.readFileSync(path.join(migDir, f), "utf8");
  const re = /firma_moduler_modul\s+check\s*\(\s*modul\s+in\s*\(([^)]*)\)/gi;
  let m;
  while ((m = re.exec(sql))) {
    checkModuler = m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean).sort();
    checkFil = f;
  }
}
if (!checkModuler) nej("CHECK-reglen firma_moduler_modul findes i en migration", "ikke fundet");
else lig(`CHECK-reglen (${checkFil}) og MODULER naevner de samme moduler`, checkModuler, [...MODULER].sort());

console.log("\n3. Plan + add-ons -> moduler");
const P = KATALOG.BASISPLAN;
const A = (m) => handleForModul(m);
lig("basisplan uden add-ons giver ingen moduler (kalderen haandterer 'mindst et')",
  modulerFraHandles(P, []), { moduler: [], ukendte: [], dobbelt: false });
lig("basisplan + Referathjaelper giver kun referat",
  modulerFraHandles(P, [A("referat")]).moduler, ["referat"]);
lig("basisplan + Telefonpasser + Referathjaelper",
  modulerFraHandles(P, [A("telefon"), A("referat")]).moduler, ["referat", "telefon"]);
lig("Hele pakken giver ALLE moduler i MODULER",
  modulerFraHandles(P, [KATALOG.HELE_PAKKEN.handle]).moduler, [...MODULER].sort());
lig("Hele pakken + et enkeltmodul melder dobbelt betaling",
  modulerFraHandles(P, [KATALOG.HELE_PAKKEN.handle, A("telefon")]).dobbelt, true);
lig("den gamle plan abonnement-standard uden add-ons giver telefon (DB Toemrer, sub-0071)",
  modulerFraHandles("abonnement-standard", undefined).moduler, ["telefon"]);
lig("et ukendt add-on bliver en ukendt, ikke et tomt saet",
  modulerFraHandles(P, [A("referat"), "fase3-maaling-a"]), { moduler: ["referat"], ukendte: ["add-on:fase3-maaling-a"], dobbelt: false });
lig("en ukendt plan bliver en ukendt",
  modulerFraHandles("findes-ikke", []).ukendte, ["plan:findes-ikke"]);
lig("samme add-on to gange giver et modul",
  modulerFraHandles(P, [A("referat"), A("referat")]).moduler, ["referat"]);
// Hele pakken omfatter ogsaa fremtidige moduler: med et ottende modul i listen
// skal pakken give otte - uden at kataloget roeres.
lig("Hele pakken foelger MODULER (et fremtidigt modul kommer automatisk med)",
  modulerFraHandles(P, [KATALOG.HELE_PAKKEN.handle], KATALOG, [...MODULER, "fremtid"]).moduler,
  [...MODULER, "fremtid"].sort());

console.log("\n4. Det, der skal findes i Frisbii");
const salg = produkterTilSalg();
lig("basisplanen: 0 kr. og 7 dages proeve", salg.plan, { handle: P, prisOere: 0, proevedage: 7 });
lig("kun Telefonpasser og Referat saelges (Ann 31/10: Hele pakken venter paa flere moduler)",
  salg.addOns.map((a) => a.handle).sort(),
  [A("referat"), A("telefon")].sort());
lig("priserne ekskl. moms: 500 og 400 kr.",
  salg.addOns.map((a) => [a.handle, a.prisOere]).sort(),
  [[A("referat"), 40000], [A("telefon"), 50000]].sort());
lig("de aftalte navne og priser (Ann 31/10)",
  Object.entries(KATALOG.MODUL_ADDONS).filter(([m]) => m !== "booking").map(([m, x]) => [m, x.navn, x.prisOere]),
  [["telefon", "Telefonpasser", 50000], ["referat", "Referat", 40000], ["tilbud", "Tilbud", 50000], ["faktura", "Faktura", 50000],
   ["svar", "Kundehenvendelser", 20000], ["facebook", "SoMe-v\u00e6rkt\u00f8j", 20000]]);
lig("Hele pakken giver stadig alle moduler, hvis et gammelt abonnement har den",
  modulerFraHandles(P, [KATALOG.HELE_PAKKEN.handle]).moduler, [...MODULER].sort());

console.log("\n5. Roedt med vilje: tjekKatalog skal se et oedelagt katalog");
let k = kopi(); delete k.MODUL_ADDONS.svar;
tjekKatalog(k).length ? ok("et modul mangler i kataloget -> fejl", tjekKatalog(k)[0]) : nej("et modul mangler -> fejl", "ingen fejl fundet");
k = kopi(); k.MODUL_ADDONS.svar.handle = k.MODUL_ADDONS.referat.handle;
tjekKatalog(k).some((f) => f.includes("to gange")) ? ok("samme handle to gange -> fejl") : nej("samme handle to gange -> fejl", JSON.stringify(tjekKatalog(k)));
k = kopi(); k.MODUL_ADDONS.telefon.prisOere = 0;
tjekKatalog(k).some((f) => f.includes("prisOere")) ? ok("pris 0 paa et modul -> fejl") : nej("pris 0 -> fejl", JSON.stringify(tjekKatalog(k)));
k = kopi(); k.MODUL_ADDONS.telefon.handle = "Modul Telefon";
tjekKatalog(k).some((f) => f.includes("ugyldigt handle")) ? ok("handle med stort bogstav og mellemrum -> fejl") : nej("ugyldigt handle -> fejl", JSON.stringify(tjekKatalog(k)));
k = kopi(); k.GAMLE_PLANER["abonnement-standard"] = ["telefonpasser"];
tjekKatalog(k).some((f) => f.includes("ukendt modul")) ? ok("gammel plan med ukendt modulnavn -> fejl") : nej("gammel plan ukendt modul -> fejl", JSON.stringify(tjekKatalog(k)));
lig("et katalog med et modul, MODULER ikke kender -> fejl",
  tjekKatalog(KATALOG, MODULER.filter((m) => m !== "facebook")).length > 0, true);

console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
process.exit(fejlet ? 1 : 0);
