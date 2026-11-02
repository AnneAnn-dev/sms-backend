// proev-kunde-sms.js -- D2, proeve 2 af 3: kunde-SMS'en er ét segment.
//
//   node proev-kunde-sms.js
//
// HVAD DER SKAL VAERE SANDT (Ann, 31/10-26):
//   Kunde-SMS'en er altid ét GSM-segment med et helt link, ogsaa naar
//   firmanavn og slug tilsammen bruger hele pladsen. Et navn, der ikke kan
//   vaere der, bliver afvist.
//
// HVORFOR: 11/7-26 gled alle kunde-SMS'er over 160 tegn efter rebrandingen
// og blev delt MIDT i linket - kunden fik et link, der ikke virkede, og vi
// betalte dobbelt. Fundet i Twilio-konsollen, ikke af et system (Aa1).
//
// Bevidst tynd: kun det, der koster penge eller knaekker linket.
// Proever kunde-sms.js direkte. Rene funktioner: ingen database, intet
// netvaerk, ingen miljoevariabler. Koeres i CI via kor-proever.js.
//
// D2 T2, 2/11-26.
"use strict";

const { kundeSmsBody, gsmSegments, maksNavnLaengde, navnPasserISms, TOKEN_TEGN } = require("./kunde-sms");

// Prod-domaenet - det, kunderne faar. Et formulartoken er altid 12 tegn.
const BASE = "https://opgave.ditdigitalekontor.dk";
const TOKEN = "x".repeat(TOKEN_TEGN);
const SLUG12 = "abcdefghijkl";   // loftet for en slug (SLUG_MAKS)
const SLUG7 = "jensens";

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d !== undefined ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  return a === b ? ok(n, a) : nej(n, `fik ${a}, forventede ${b}`);
};
// Hele beskeden med et RIGTIGT 12-tegns token - som /opkald bygger den.
const sms = (navn, slug) => kundeSmsBody(navn, `${BASE}/${slug}/${TOKEN}`);

console.log("1. Vaerste tilfaelde: navnet fylder hele pladsen");
const maks = maksNavnLaengde(SLUG12, BASE);
lig("navnet paa maks-laengde godkendes", navnPasserISms("A".repeat(maks), SLUG12, BASE), { ok: true, ucs2: false });
lig("og hele beskeden er praecis 160 tegn, ét segment", gsmSegments(sms("A".repeat(maks), SLUG12)), { segments: 1, ucs2: false, tegn: 160 });
lig("æøå koster ét tegn: et dansk navn paa maks-laengde godkendes", navnPasserISms("æøå".repeat(maks).slice(0, maks), SLUG12, BASE).ok, true);

console.log("\n2. Ét tegn mere bliver afvist");
lig("navnet paa maks + 1 afvises", navnPasserISms("A".repeat(maks + 1), SLUG12, BASE), { ok: false, ucs2: false });
lig("for beskeden ville blive to segmenter", gsmSegments(sms("A".repeat(maks + 1), SLUG12)).segments, 2);

console.log("\n3. Linket staar helt, sidst, paa sin egen linje");
lig("beskeden slutter med linket", sms("Hansen VVS", SLUG7).endsWith(`\n${BASE}/${SLUG7}/${TOKEN}`), true);

console.log("\n4. Tegn, der koster mere");
lig("euro koster to tegn", gsmSegments("€").tegn, 2);
lig("en emoji afvises (UCS-2)", navnPasserISms("Jensen \u{1F600}", SLUG7, BASE), { ok: false, ucs2: true });

console.log("\n5. Budgettet: navn + slug = 46 tegn med prod-domaenet");
lig("slug paa 12 tegn", maksNavnLaengde(SLUG12, BASE) + SLUG12.length, 46);
lig("slug paa 7 tegn (firmaets EGEN slug, D67)", maksNavnLaengde(SLUG7, BASE) + SLUG7.length, 46);
lig("ingen slug: loftet bruges", maksNavnLaengde(null, BASE), 34);

console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
process.exit(fejlet ? 1 : 0);
