// proev-frisbii-afstem.js -- proever frisbii-afstem.js. Ingen netvaerk, ingen
// database, ingen miljoevariabler (koeres i CI via kor-proever.js).
//
//   node proev-frisbii-afstem.js
//
// Byggede paa de firmaer og abonnementer, vi kender fra staging og prod
// 25.-28/10. Fase 3, T3 (28/10-26). Ren ASCII.
"use strict";

const { sammenlignFirma, abonnementerUdenFirma, forventetBillingStatus } = require("./frisbii-afstem");
const { modulsaet } = require("./frisbii-modulsaet");

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  return a === b ? ok(n, a) : nej(n, `fik ${a}, forventede ${b}`);
};
const indeholder = (n, liste, tekst) =>
  liste.some((l) => l.includes(tekst)) ? ok(n, tekst) : nej(n, `ingen linje med "${tekst}" i ${JSON.stringify(liste)}`);

const NU = "2026-10-28T08:00:00.000Z";
const addOn = (h) => ({ handle: "i-" + h, add_on: { handle: h } });
const telefonAuto = (firm) => ({ firm_id: firm, modul: "telefon", fra: "2026-10-13T00:00:00Z", til: null, kilde: "auto" });
const referatManuel = (firm) => ({ firm_id: firm, modul: "referat", fra: "2026-10-24T00:00:00Z", til: null, kilde: "manuel" });
const sub = (over) => ({ handle: "sub-x", state: "active", plan: "abonnement-standard", is_cancelled: false,
  next_period_start: "2026-11-20T00:00:00Z", current_period_start: "2026-10-20T00:00:00Z", dunning_invoices: 0, ...over });
const firma = (over) => ({ status: "active", billing_status: "active", har_nummer: true, ...over });
const kor = (s, addOns, f, r) => sammenlignFirma({ sub: s, saet: modulsaet(s, addOns, NU), firma: f, raekker: r, nu: NU });

console.log("1. Det, der skal vaere enigt (prod 27-28/10)");
let x = kor(sub({ handle: "sub-0071" }), [], firma(), [telefonAuto("F")]);
lig("DB Toemrer (gammel plan, telefon, 0 kr.): enig", x.uenig, []);
x = kor(sub({ handle: "sub-0072" }), [], firma(), [telefonAuto("F"), referatManuel("F")]);
lig("Anns pilotfirma med manuel referat-raekke: enig", x.uenig, []);
indeholder("  ... og den manuelle raekke staar som information", x.info, "manuelle moduler");
x = kor(sub({ handle: "sub-0076", is_cancelled: true, expires: "2026-11-20T00:00:00Z" }), [], firma({ billing_status: "cancelled" }), [telefonAuto("F")]);
lig("opsagt, men perioden loeber: enig", x.uenig, []);

console.log("\n2. Det, der skal give uenighed");
x = kor(sub({ handle: "sub-0124" }), [addOn("fase3-maaling-a")], firma({ status: "onboarding" }), [telefonAuto("F")]);
indeholder("sub-0124 med maale-add-on'et (staging 25/10): ukendt produkt", x.uenig, "ukendt hos Frisbii: add-on:fase3-maaling-a");
x = kor(sub({ handle: "sub-0077", state: "expired" }), [], firma({ status: "inactive", billing_status: "expired", har_nummer: false }), [telefonAuto("F")]);
indeholder("sub-0077 (prod, lukket 27/10): udloebet, men telefon-raekken staar aktiv", x.uenig, "uden at Frisbii siger det (abonnementet er udloebet)");
x = kor(sub({ plan: "ddk-basis" }), [addOn("modul-referat")], firma(), [telefonAuto("F")]);
indeholder("betaler for referat, men databasen har det ikke", x.uenig, "betaler for referat");
indeholder("har telefon i databasen uden at betale", x.uenig, "har telefon i databasen");
x = kor(sub(), [], firma({ status: "inactive" }), [telefonAuto("F")]);
indeholder("lever hos Frisbii, firmaet er inactive (D15)", x.uenig, "betalende kunde spaerret ude");
x = kor(sub({ state: "expired" }), [], firma({ billing_status: "expired" }), []);
indeholder("udloebet hos Frisbii, firmaet er aktivt (D15)", x.uenig, "gratis adgang");
indeholder("udloebet hos Frisbii, firmaet har stadig nummer", x.uenig, "stadig et nummer");
x = kor(sub({ is_cancelled: true, expires: "2026-11-20T00:00:00Z" }), [], firma({ billing_status: "active" }), [telefonAuto("F")]);
indeholder("opsagt hos Frisbii, billing_status siger active", x.uenig, "Frisbii siger cancelled");
x = kor(sub({ plan: "ddk-basis" }), [addOn("modul-hele-pakken"), addOn("modul-telefon")], firma(), []);
indeholder("Hele pakken + enkeltmodul: dobbelt betaling", x.uenig, "betaler to gange");
x = sammenlignFirma({ sub: sub(), saet: modulsaet(sub(), undefined, NU), firma: firma(), raekker: [telefonAuto("F")], nu: NU });
indeholder("add-ons kunne ikke laeses: uenig, ikke 'ingen moduler' i stilhed", x.uenig, "add-ons:ulaeselige");

console.log("\n3. Abonnementer uden firma (D93)");
lig("sub-0122 lever uden firma, sub-0077 er udloebet, sub-0124 har firma",
  abonnementerUdenFirma([sub({ handle: "sub-0122" }), sub({ handle: "sub-0077", state: "expired" }), sub({ handle: "sub-0124" })], ["sub-0124"]),
  ["sub-0122"]);

console.log("\n4. billing_status som webhooken skriver den");
lig("aktiv / opsagt / rykker / udloebet",
  [forventetBillingStatus(sub()), forventetBillingStatus(sub({ is_cancelled: true })), forventetBillingStatus(sub({ dunning_invoices: 1 })), forventetBillingStatus(sub({ state: "expired" }))],
  ["active", "cancelled", "past_due", "expired"]);

console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
process.exit(fejlet ? 1 : 0);
