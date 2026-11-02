// proev-frisbii-modulsaet.js -- proever frisbii-modulsaet.js med de svar, vi
// har maalt i Frisbii-staging 25/10 og 28/10. Ingen netvaerk, ingen database,
// ingen miljoevariabler (koeres i CI via kor-proever.js).
//
//   node proev-frisbii-modulsaet.js
//
// Fase 3, T2 (28/10-26). Ren ASCII.
"use strict";

const { modulsaet, RESPIT_DAGE } = require("./frisbii-modulsaet");
const { MODULER } = require("./moduler");

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  return a === b ? ok(n, a) : nej(n, `fik ${a}, forventede ${b}`);
};

const NU = "2026-10-28T07:00:00.000Z";
// En add-on-raekke som GET /subscription/{h}/add_on svarer (maalt 25/10).
const addOn = (handle, inst) => ({ handle: inst || "inst-" + handle, add_on: { handle, type: "on_off", state: "active" }, amount: 40000 });

// sub-0124 som maalt 28/10 06:57 (genindfoert, i proeveperiode).
const sub0124 = {
  handle: "sub-0124", state: "active", plan: "abonnement-standard", in_trial: true, is_cancelled: false,
  renewing: true, next_period_start: "2026-11-01T09:42:23.632+00:00", trial_end: "2026-11-01T09:42:23.632+00:00",
  dunning_invoices: 0, test: true,
};
// sub-0124 som maalt 28/10 06:56 (opsagt).
const sub0124Opsagt = {
  ...sub0124, is_cancelled: true, renewing: false,
  expires: "2026-11-01T09:42:23.632+00:00", cancelled_date: "2026-10-28T06:56:18.806+00:00",
};
// sub-0122 som maalt 25/10 (betalt, fornyet en gang).
const sub0122 = {
  handle: "sub-0122", state: "active", plan: "abonnement-standard", in_trial: false, is_cancelled: false,
  renewing: true, current_period_start: "2026-10-04T10:18:47.102+00:00", next_period_start: "2026-11-04T11:18:47.102+00:00",
  dunning_invoices: 0, test: true,
};
const ny = (over) => ({ handle: "sub-ny", state: "active", plan: "ddk-basis", is_cancelled: false, renewing: true,
  next_period_start: "2026-11-28T07:00:00.000+00:00", current_period_start: "2026-10-28T07:00:00.000+00:00", dunning_invoices: 0, ...over });

console.log(`Respit: ${RESPIT_DAGE} dage\n`);
console.log("1. De maalte abonnementer");
let r = modulsaet(sub0124, [addOn("fase3-maaling-a", "fase3-a-sub-0124")], NU);
lig("sub-0124 (gammel plan): telefon", r.moduler, ["telefon"]);
lig("sub-0124: til = proevens slut + 7 dage", r.til, "2026-11-08T09:42:23.632Z");
lig("sub-0124: maaletestens add-on er ukendt (alarm), fjerner intet", r.ukendte, ["add-on:fase3-maaling-a"]);
r = modulsaet(sub0124Opsagt, [], NU);
lig("sub-0124 opsagt: til = expires, ingen respit (Ann 28/10, beslutning 1)", [r.grund, r.til], ["opsagt", "2026-11-01T09:42:23.632Z"]);
lig("sub-0124 opsagt: modulerne er der stadig til periodens slut", r.moduler, ["telefon"]);
r = modulsaet(sub0122, [], NU);
lig("sub-0122 (betalt): til = naeste faktura + 7 dage", [r.grund, r.til], ["aktiv", "2026-11-11T11:18:47.102Z"]);

console.log("\n2. Den nye basisplan med add-ons");
lig("ddk-basis + Referathjaelper", modulsaet(ny(), [addOn("modul-referat")], NU).moduler, ["referat"]);
lig("ddk-basis + Telefonpasser + Referathjaelper", modulsaet(ny(), [addOn("modul-telefon"), addOn("modul-referat")], NU).moduler, ["referat", "telefon"]);
lig("ddk-basis + Hele pakken = alle moduler", modulsaet(ny(), [addOn("modul-hele-pakken")], NU).moduler, [...MODULER].sort());
lig("ddk-basis uden add-ons = ingen moduler, ingen ukendte (kalderen haandterer 'mindst et')",
  [modulsaet(ny(), [], NU).moduler, modulsaet(ny(), [], NU).ukendte], [[], []]);
lig("add-on som bare handle-streng laeses ogsaa", modulsaet(ny(), [{ add_on: "modul-referat" }], NU).moduler, ["referat"]);

console.log("\n3. Tilstande");
r = modulsaet(ny({ dunning_invoices: 1 }), [addOn("modul-referat")], NU);
lig("rykker: til = den ubetalte periodes start + 7 dage (IKKE maalt endnu)", [r.grund, r.til], ["rykker", "2026-11-04T07:00:00.000Z"]);
r = modulsaet(ny({ state: "on_hold" }), [addOn("modul-referat")], NU);
lig("on_hold behandles som rykker", r.grund, "rykker");
r = modulsaet(ny({ state: "expired" }), [addOn("modul-referat")], NU);
lig("udloebet: til = nu, modulet staar (laeseadgang, C17)", [r.grund, r.til, r.moduler], ["udloebet", NU, ["referat"]]);
r = modulsaet(ny({ state: "pending" }), [addOn("modul-referat")], NU);
lig("ukendt tilstand: ingen moduler + ukendt", [r.moduler, r.ukendte], [[], ["tilstand:pending"]]);

console.log("\n4. Det, der aldrig maa give 'ingen moduler' i stilhed");
r = modulsaet(null, [], NU);
lig("intet abonnement -> ukendt", r.ukendte, ["abonnement:mangler"]);
r = modulsaet(ny(), undefined, NU);
lig("add-ons kunne ikke laeses -> ukendt, ikke et tomt saet", r.ukendte, ["add-ons:ulaeselige"]);
r = modulsaet(ny({ next_period_start: undefined, current_period_start: undefined }), [addOn("modul-referat")], NU);
lig("aktiv uden dato -> ukendt", r.ukendte, ["dato:mangler"]);
r = modulsaet(ny({ plan: "ukendt-plan" }), [addOn("modul-referat")], NU);
lig("ukendt plan -> ukendt, men referat bevares", [r.moduler, r.ukendte], [["referat"], ["plan:ukendt-plan"]]);
lig("pakke + enkeltmodul melder dobbelt betaling",
  modulsaet(ny(), [addOn("modul-hele-pakken"), addOn("modul-telefon")], NU).dobbelt, true);

console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
process.exit(fejlet ? 1 : 0);
