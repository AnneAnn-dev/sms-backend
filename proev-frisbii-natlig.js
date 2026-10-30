// proev-frisbii-natlig.js -- proever frisbii-natlig.js (D92 del 3b): hvilke
// dead-letter-raekker kommer med, og hvad mailen siger. Ingen netvaerk, ingen
// database, ingen miljoevariabler (koeres i CI via kor-proever.js).
//
//   node proev-frisbii-natlig.js
//
// 29/10-26. Ren ASCII.
"use strict";

const { udvaelgDeadLetter, ventendeNumre, lavRapport, MAKS_LINJER } = require("./frisbii-natlig");

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  return a === b ? ok(n, a) : nej(n, `fik ${a}, forventede ${b}`);
};

const NU = "2026-10-30T04:00:00.000Z";
const rows = [
  { id: "ac2df5aa", event_id: "e1", event_type: "subscription_changed", error: "ukendt produkt paa sub-0124: add-on:fase3-maaling-a" },
  { id: "14b2ad1f", event_id: "e2", event_type: "subscription_changed", error: "ukendt produkt paa sub-0124: add-on:fase3-maaling-a" },
  { id: "ny000001", event_id: "e3", event_type: "invoice_settled", error: null },
  { id: "gammel01", event_id: null, event_type: "invoice_settled", error: "Ingen ledige numre" },
  { id: "ikkehent", event_id: "e9", event_type: "subscription_created", error: "x" },
];
const events = {
  e1: { subscription: "sub-0124", created: "2026-10-29T06:19:50.000Z" },
  e2: { subscription: "sub-0124", created: "2026-10-29T06:40:02.000Z" },
  e3: { subscription: "sub-0200", created: "2026-10-30T03:55:00.000Z" }, // 5 min gammel
  e9: null,                                                              // kunne ikke hentes
};
const GROEN = { kode: 0, tekst: "Enige. Frisbii og databasen siger det samme." };
const UENIG = { kode: 1, tekst: "====\nAFSTEMNING\nUENIG  firma 5bca56b7  sub-0124  (status active, billing active)\n         ! ukendt hos Frisbii: add-on:fase3-maaling-a\nUENIG  sub-0122  lever hos Frisbii, men intet firma\n2 uenighed(er). Intet er rettet" };

console.log("1. Hvilke dead-letter-raekker kommer med");
const dl = udvaelgDeadLetter(rows, events, NU);
lig("yngre end 15 min springes over (maaske under behandling)", dl.some((d) => d.id === "ny000001"), false);
lig("de to rigtige fra 29/10 er med, med abonnement fra Frisbii", dl.filter((d) => d.abonnement === "sub-0124").map((d) => d.id), ["ac2df5aa", "14b2ad1f"]);
lig("raekke uden event_id er med (tid ukendt), ikke tabt", dl.some((d) => d.id === "gammel01" && d.created === null), true);
lig("event, der ikke kunne hentes, er med og markeret", dl.filter((d) => d.id === "ikkehent").map((d) => d.hentet), [false]);
lig("tom fejltekst giver en tekst, ikke null", udvaelgDeadLetter([{ id: "a", event_id: null, event_type: "x", error: null }], {}, NU)[0].error, "(ingen fejltekst)");
lig("ingen raekker -> tom liste", udvaelgDeadLetter([], {}, NU), []);

console.log("\n2. Rapporten");
let r = lavRapport({ miljoe: "staging", deadLetter: [], afstem: GROEN, nu: NU });
lig("alt groent: groen, og der laves stadig en mail", [r.roed, r.subject], [false, "Natlig Frisbii-kontrol (staging): GROENT"]);
lig("  ... og mailen siger, at manglende mail = ikke koert", /ikke koert/.test(r.text), true);
r = lavRapport({ miljoe: "staging", deadLetter: dl, afstem: UENIG, nu: NU });
lig("dead-letter + uenig: roed med begge i emnet", [r.roed, r.subject], [true, "Natlig Frisbii-kontrol (staging): ROED - 4 i dead-letter, afstemning uenig"]);
lig("  ... mailen siger, at Frisbii IKKE gensender, og hvad man goer", [/IKKE af sig selv/.test(r.text), /Gensend eventet i Frisbii/.test(r.text), /gensynk-firma\.js/.test(r.text)], [true, true, true]);
lig("  ... afstemningens UENIG- og !-linjer kommer med", [/UENIG  sub-0122/.test(r.text), /! ukendt hos Frisbii/.test(r.text)], [true, true]);
lig("  ... og den siger 'kun laesning - intet er rettet'", /Kun laesning - intet er rettet/.test(r.text), true);
r = lavRapport({ miljoe: "prod", deadLetter: [], afstem: { kode: -1, tekst: "spawnSync node ETIMEDOUT" }, nu: NU });
lig("afstemningen fejlede (timeout): roed, 'fejlede' i emnet, fejlen i teksten", [r.roed, /afstemning fejlede/.test(r.subject), /ETIMEDOUT/.test(r.text)], [true, true, true]);
r = lavRapport({ miljoe: "prod", deadLetter: [], afstem: undefined, nu: NU });
lig("ingen afstemning overhovedet = roed (aldrig groent af mangel paa svar)", r.roed, true);
const mange = Array.from({ length: MAKS_LINJER + 7 }, (_, i) => ({ id: "x" + i, event_type: "t", error: "e", abonnement: null, created: null, hentet: true }));
r = lavRapport({ miljoe: "staging", deadLetter: mange, afstem: GROEN, nu: NU });
lig("mange raekker: mailen kappes og siger hvor mange mere", [/\.\.\. og 7 mere/.test(r.text), (r.text.match(/fejl: e/g) || []).length], [true, MAKS_LINJER]);

console.log("\n3. Venter paa nummer (T7b2)");
const firmaer = [
  { id: "A1111111-x", name: "Lang ventetid", frisbii_subscription: "sub-0201" },
  { id: "B2222222-x", name: "Kort ventetid", frisbii_subscription: "sub-0202" },
  { id: "C3333333-x", name: "Kun referat", frisbii_subscription: "sub-0203" },
  { id: "D4444444-x", name: "Telefon udloebet", frisbii_subscription: "sub-0204" },
];
const raekker = [
  { firm_id: "A1111111-x", fra: "2026-10-28T10:00:00Z", til: "2026-11-13T00:00:00Z" },  // 42 t
  { firm_id: "B2222222-x", fra: "2026-10-30T01:00:00Z", til: null },                    // 3 t
  { firm_id: "D4444444-x", fra: "2026-10-01T00:00:00Z", til: "2026-10-29T00:00:00Z" },  // ikke aktiv
];
const v = ventendeNumre(raekker, firmaer, NU);
lig("kun aktive telefon-raekker uden nummer, laengst ventende foerst", v.map((x) => [x.abonnement, x.timer, x.overDoegn]), [["sub-0201", 42, true], ["sub-0202", 3, false]]);
r = lavRapport({ miljoe: "staging", deadLetter: [], afstem: GROEN, nu: NU, venter: v });
lig("over et doegn: ROED, og emnet siger det", [r.roed, r.subject], [true, "Natlig Frisbii-kontrol (staging): ROED - 1 venter paa nummer over et doegn"]);
lig("  ... teksten naevner rabatkode og gensynk --skriv", [/rabatkode/.test(r.text), /gensynk-firma\.js <abonnement> --skriv/.test(r.text), /OVER ET DOEGN/.test(r.text)], [true, true, true]);
r = lavRapport({ miljoe: "staging", deadLetter: [], afstem: GROEN, nu: NU, venter: v.filter((x) => !x.overDoegn) });
lig("under et doegn: listes, men GROENT", [r.roed, /VENTER PAA NUMMER/.test(r.text), /rabatkode/.test(r.text)], [false, true, false]);
r = lavRapport({ miljoe: "staging", deadLetter: [], afstem: GROEN, nu: NU });
lig("ingen ventende: afsnittet vises ikke (gammel kalder virker uaendret)", [r.roed, /VENTER PAA NUMMER/.test(r.text)], [false, false]);

console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
process.exit(fejlet ? 1 : 0);
