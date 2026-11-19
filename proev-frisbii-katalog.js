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
   ["svar", "Kundehenvendelser", 20000], ["facebook", "SoMe-v\u00e6rkt\u00f8j", 20000], ["kunder", "Kunder og opgaver", 20000]]);
lig("Hele pakken giver stadig alle moduler, hvis et gammelt abonnement har den",
  modulerFraHandles(P, [KATALOG.HELE_PAKKEN.handle]).moduler, [...MODULER].sort());

console.log("\n4b. Pakken \"Skrivehjaelp og SoMe med kunder\" (Fase 4 8/11, salg 17/11)");
const PK = KATALOG.PAKKER["svar-some"];
lig("handle, navn, pris og moduler", [PK.handle, PK.navn, PK.prisOere, PK.moduler],
  ["modul-svar-some", "Skrivehj\u00e6lp og SoMe med kunder", 20000, ["svar", "facebook", "kunder"]]);
lig("pakken saelges ikke endnu, men vises som kommer", [PK.saelges, PK.kommer], [false, true]);
lig("svar, facebook og kunder vises ikke for sig (hverken saelges eller kommer)",
  ["svar", "facebook", "kunder"].map((m) => [!!KATALOG.MODUL_ADDONS[m].saelges, !!KATALOG.MODUL_ADDONS[m].kommer]), [[false, false], [false, false], [false, false]]);
lig("pakken giver svar, facebook og kunder",
  modulerFraHandles(P, [PK.handle]), { moduler: ["facebook", "kunder", "svar"], ukendte: [], dobbelt: false });
lig("pakken + Telefonpasser: fire moduler, ikke dobbelt",
  modulerFraHandles(P, [PK.handle, A("telefon")]), { moduler: ["facebook", "kunder", "svar", "telefon"], ukendte: [], dobbelt: false });
lig("pakken + modul-svar: kunden betaler to gange for svar",
  modulerFraHandles(P, [PK.handle, A("svar")]).dobbelt, true);
lig("Hele pakken + pakken: dobbelt",
  modulerFraHandles(P, [KATALOG.HELE_PAKKEN.handle, PK.handle]).dobbelt, true);
lig("varer: moduler og pakken, Hele pakken ikke",
  kat.varer().map((v) => v.noegle), ["telefon", "referat", "tilbud", "faktura", "booking", "svar", "facebook", "kunder", "svar-some", "svar-some-uden-kunder"]);
lig("handleForVare kender baade modul og pakke",
  [kat.handleForVare("referat"), kat.handleForVare("svar-some"), kat.handleForVare("findes-ikke")], ["modul-referat", "modul-svar-some", null]);
lig("pakken oprettes ikke i Frisbii, foer den saelges", produkterTilSalg().addOns.some((a) => a.handle === PK.handle), false);
const kp = kopi(); kp.PAKKER["svar-some"].saelges = true;
lig("... og kommer med, naar den saelges", produkterTilSalg(kp).addOns.filter((a) => a.pakke).map((a) => [a.pakke, a.handle, a.prisOere]),
  [["svar-some", "modul-svar-some", 20000]]);

console.log("\n4c. Pakken \"Skrivehjaelp og SoMe uden kunder\" (Fase 4 salg, Ann 17/11)");
const PU = KATALOG.PAKKER["svar-some-uden-kunder"];
lig("handle, navn, pris og moduler", [PU.handle, PU.navn, PU.prisOere, PU.moduler],
  ["modul-svar-some-uden-kunder", "Skrivehj\u00e6lp og SoMe uden kunder", 20000, ["svar", "facebook"]]);
lig("saelges ikke endnu, men vises som kommer", [PU.saelges, PU.kommer], [false, true]);
lig("giver svar og facebook, ikke kunder",
  modulerFraHandles(P, [PU.handle]), { moduler: ["facebook", "svar"], ukendte: [], dobbelt: false });
lig("+ Telefonpasser: tre moduler, ikke dobbelt",
  modulerFraHandles(P, [PU.handle, A("telefon")]), { moduler: ["facebook", "svar", "telefon"], ukendte: [], dobbelt: false });
lig("begge udgaver paa samme abonnement: kunden betaler to gange",
  modulerFraHandles(P, [PK.handle, PU.handle]).dobbelt, true);
lig("samme udgave to gange er ikke to pakker (som samme modul to gange)",
  modulerFraHandles(P, [PU.handle, PU.handle]).dobbelt, false);
lig("+ modul-facebook: dobbelt", modulerFraHandles(P, [PU.handle, A("facebook")]).dobbelt, true);
lig("Hele pakken giver ogsaa kunder", modulerFraHandles(P, [KATALOG.HELE_PAKKEN.handle]).moduler.includes("kunder"), true);
lig("handleForVare kender udgaven", kat.handleForVare("svar-some-uden-kunder"), "modul-svar-some-uden-kunder");
lig("modulet kunder oprettes aldrig i Frisbii", produkterTilSalg().addOns.some((a) => a.handle === "modul-kunder"), false);
const ku = kopi(); ku.PAKKER["svar-some"].saelges = true; ku.PAKKER["svar-some-uden-kunder"].saelges = true;
lig("naar begge saelges: to add-ons a 200 kr.", produkterTilSalg(ku).addOns.filter((a) => a.pakke).map((a) => [a.handle, a.prisOere]),
  [["modul-svar-some", 20000], ["modul-svar-some-uden-kunder", 20000]]);

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
k = kopi(); k.PAKKER["svar-some"].moduler = ["svar", "findes-ikke"];
tjekKatalog(k).some((f) => f.includes("ukendt modul findes-ikke")) ? ok("pakke med ukendt modul -> fejl") : nej("pakke ukendt modul -> fejl", JSON.stringify(tjekKatalog(k)));
k = kopi(); k.PAKKER["svar-some"].handle = k.MODUL_ADDONS.svar.handle;
tjekKatalog(k).some((f) => f.includes("to gange")) ? ok("pakke med et moduls handle -> fejl") : nej("pakke-handle to gange -> fejl", JSON.stringify(tjekKatalog(k)));
k = kopi(); k.PAKKER.ekstra = { handle: "modul-ekstra", navn: "Ekstra", prisOere: 100, moduler: ["svar", "referat"], saelges: false, beskrivelse: "E" };
lig("et modul i flere pakker er tilladt (Fase 4 salg)", tjekKatalog(k), []);
k = kopi(); k.PAKKER.ekstra = { handle: "modul-ekstra", navn: "Ekstra", prisOere: 100, moduler: ["facebook", "svar"], saelges: false };
tjekKatalog(k).some((f) => f.includes("de samme moduler")) ? ok("to pakker med de samme moduler -> fejl") : nej("to pakker samme moduler -> fejl", JSON.stringify(tjekKatalog(k)));
k = kopi(); k.PAKKER.referat = { handle: "modul-x", navn: "X", prisOere: 100, moduler: ["svar", "facebook"], saelges: false };
tjekKatalog(k).some((f) => f.includes("samme som et modul")) ? ok("pakke med et moduls navn -> fejl") : nej("pakke med modulnavn -> fejl", JSON.stringify(tjekKatalog(k)));
// Bestillingssiden (18/11): tekster i kataloget, ikke paa hjemmesiden.
k = kopi(); delete k.MODUL_ADDONS.telefon.beskrivelse;
tjekKatalog(k).some((f) => f.includes("telefon: beskrivelse mangler")) ? ok("modul til salg uden beskrivelse -> fejl") : nej("modul uden beskrivelse -> fejl", JSON.stringify(tjekKatalog(k)));
k = kopi(); k.PAKKER["svar-some"].beskrivelse = "  ";
tjekKatalog(k).some((f) => f.includes("svar-some: beskrivelse mangler")) ? ok("pakke med tom beskrivelse -> fejl (ogsaa naar den ikke saelges endnu)") : nej("pakke tom beskrivelse -> fejl", JSON.stringify(tjekKatalog(k)));
k = kopi(); delete k.PAKKER["svar-some-uden-kunder"].side;
tjekKatalog(k).some((f) => f.includes("kraever en side")) ? ok("ikke paa listen og ingen egen side -> fejl (kan ikke koebes nogen steder)") : nej("paaListen false uden side -> fejl", JSON.stringify(tjekKatalog(k)));
k = kopi(); k.PAKKER["svar-some"].side = { overskrift: "X" };
tjekKatalog(k).some((f) => f.includes("overskrift og intro")) ? ok("side uden intro -> fejl") : nej("side uden intro -> fejl", JSON.stringify(tjekKatalog(k)));
k = kopi(); k.PAKKER["svar-some"].paaListen = "nej";
tjekKatalog(k).some((f) => f.includes("paaListen skal")) ? ok("paaListen, der ikke er true/false -> fejl") : nej("paaListen ugyldig -> fejl", JSON.stringify(tjekKatalog(k)));
k = kopi(); k.PAKKER["svar-some"].salgsnavn = " ";
tjekKatalog(k).some((f) => f.includes("svar-some: salgsnavn er tomt")) ? ok("tomt salgsnavn -> fejl") : nej("tomt salgsnavn -> fejl", JSON.stringify(tjekKatalog(k)));
k = kopi(); delete k.MODUL_ADDONS.tilbud.beskrivelse;
lig("Tilbud (kommer, saelges ikke) behoever ingen beskrivelse", tjekKatalog(k), []);
lig("et katalog med et modul, MODULER ikke kender -> fejl",
  tjekKatalog(KATALOG, MODULER.filter((m) => m !== "facebook")).length > 0, true);

lig("bestillingssiden: med kunder staar paa listen, uden kunder kun paa sin egen side",
  [KATALOG.PAKKER["svar-some"].paaListen, KATALOG.PAKKER["svar-some-uden-kunder"].paaListen, !!KATALOG.PAKKER["svar-some"].side, !!KATALOG.PAKKER["svar-some-uden-kunder"].side],
  [undefined, false, true, true]);

console.log("\n6. Har firmaet Kunder og Opgaver? (moduler.js, Fase 4 salg T3)");
const mod = require("./moduler");
lig("hvert modul staar i GIVER_KUNDER eller UDEN_KUNDER - og kun i den ene",
  [...mod.GIVER_KUNDER, ...mod.UDEN_KUNDER].sort(), [...MODULER].sort());
lig("kun svar og facebook giver ikke kunder", [...mod.UDEN_KUNDER].sort(), ["facebook", "svar"]);
lig("uden kunder (svar + facebook): nej", mod.harKunder(["facebook", "svar"]), false);
lig("med kunder (svar + facebook + kunder): ja", mod.harKunder(["facebook", "kunder", "svar"]), true);
lig("Telefonpasser alene: ja", mod.harKunder(["telefon"]), true);
lig("Referat alene: ja", mod.harKunder(["referat"]), true);
lig("uden kunder + Referat: ja (tilkoeb giver fanerne)", mod.harKunder(["facebook", "referat", "svar"]), true);
lig("ingen moduler: nej", mod.harKunder([]), false);
lig("udefineret: nej", mod.harKunder(undefined), false);
lig("de to udgaver i kataloget giver hhv. ja og nej",
  [mod.harKunder(KATALOG.PAKKER["svar-some"].moduler), mod.harKunder(KATALOG.PAKKER["svar-some-uden-kunder"].moduler)], [true, false]);

console.log("\n7. Flaget SKRIVEHJAELP_SALG styrer salget af de to pakker (Ann 18/11)");
// Kataloget laeser flaget, naar det indlaeses - derfor en frisk proces pr. vaerdi.
const { spawnSync } = require("child_process");
const medFlag = (vaerdi) => {
  const env = { ...process.env }; delete env.SKRIVEHJAELP_SALG;
  if (vaerdi !== undefined) env.SKRIVEHJAELP_SALG = vaerdi;
  const r = spawnSync(process.execPath, ["-e",
    "const k=require('./frisbii-katalog');const P=k.KATALOG.PAKKER;" +
    "console.log(JSON.stringify([P['svar-some'].saelges,P['svar-some-uden-kunder'].saelges,k.produkterTilSalg().addOns.filter(a=>a.pakke).map(a=>a.handle),k.tjekKatalog()]))"],
    { cwd: __dirname, env, encoding: "utf8" });
  try { return JSON.parse(r.stdout.trim()); } catch (e) { return "fejl: " + (r.stderr || r.stdout); }
};
lig("ikke sat: saelges ikke", medFlag(undefined), [false, false, [], []]);
lig("\"true\": begge saelges og skal findes i Frisbii", medFlag("true"), [true, true, ["modul-svar-some", "modul-svar-some-uden-kunder"], []]);
lig("\"True\" (tastefejl): saelges ikke - fail-closed", medFlag("True"), [false, false, [], []]);
lig("\"false\": saelges ikke", medFlag("false"), [false, false, [], []]);
lig("modulet kunder saelges aldrig for sig, heller ikke med flaget", medFlag("true")[2].includes("modul-kunder"), false);

console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
process.exit(fejlet ? 1 : 0);
