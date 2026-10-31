// frisbii-katalog.js
// -----------------------------------------------------------------------------
// Fase 3, T1a (28/10-26): oversaettelsen mellem vores moduler og Frisbiis
// produkter. DET ENESTE STED, Frisbii-handles staar (D25: "Frisbii-navne kun
// ét sted"). Resten af koden kender kun modulnavnene i moduler.js (MODULER).
//
// Beslutninger (Ann 25/10 og 28/10, byggeplanen "Fase 3 byggeplan"):
//  - Én basisplan til 0 kr. med 7 dages proeveperiode + ét add-on pr. modul
//    paa samme abonnement. Ikke én plan pr. kombination (127 planer).
//  - Hele pakken er et add-on og omfatter ALLE moduler i MODULER - ogsaa
//    fremtidige. Et nyt modul i MODULER kommer derfor automatisk med.
//  - Kun moduler, der virker, saelges (saelges: true). De oevrige staar her,
//    saa kataloget er fuldt, men oprettes ikke i Frisbii og tjekkes ikke.
//  - Den gamle plan "abonnement-standard" (uden add-ons) betyder Telefonpasser.
//    Den har DB Toemrer, Anns og Annes firma i prod (27/10). Fjernes den
//    linje, mister de telefonen ved foerste synk.
//
// Priser i oere EKSKL. moms (Frisbii: amount + vat 0.25, amount_incl_vat false),
// fra beslutningsgrundlaget 13/10 (D80), rettet 31/10 efter Anns prisliste
// (Tilbud og Faktura 500 kr.). Navnene er de aftalte (Ann 31/10) og vises paa
// bestillingssiden, i mails og paa Frisbiis fakturaer; Anne ejer teksterne.
// Hele pakken saelges ikke, foer der er flere moduler at samle (Ann 31/10).
//
// Rene funktioner, ingen netvaerk, ingen miljoevariabler. Proeves af
// proev-frisbii-katalog.js, som ogsaa tjekker, at kataloget, MODULER og
// CHECK-reglen i databasen naevner de samme moduler.
// -----------------------------------------------------------------------------
"use strict";

const { MODULER } = require("./moduler");

const BASISPLAN = "ddk-basis";
const PROEVEDAGE = 7;

// Planer fra foer Fase 3. Abonnementer paa dem har ingen add-ons.
const GAMLE_PLANER = {
  "abonnement-standard": ["telefon"],
};

const MODUL_ADDONS = {
  telefon:  { handle: "modul-telefon",  navn: "Telefonpasser",     prisOere: 50000, saelges: true },
  referat:  { handle: "modul-referat",  navn: "Referat",           prisOere: 40000, saelges: true },
  tilbud:   { handle: "modul-tilbud",   navn: "Tilbud",            prisOere: 50000, saelges: false },
  faktura:  { handle: "modul-faktura",  navn: "Faktura",           prisOere: 50000, saelges: false },
  booking:  { handle: "modul-booking",  navn: "Booking",           prisOere: 40000, saelges: false },
  svar:     { handle: "modul-svar",     navn: "Kundehenvendelser", prisOere: 20000, saelges: false },
  facebook: { handle: "modul-facebook", navn: "SoMe-værktøj",      prisOere: 20000, saelges: false },
};

const HELE_PAKKEN = { handle: "modul-hele-pakken", navn: "Hele pakken", prisOere: 150000, saelges: false };

const KATALOG = { BASISPLAN, PROEVEDAGE, GAMLE_PLANER, MODUL_ADDONS, HELE_PAKKEN };

// Hvilke moduler giver en plan + en liste add-on-handles?
// Returnerer { moduler, ukendte, dobbelt }:
//  - moduler: sorteret, uden dubletter
//  - ukendte: handles, kataloget ikke kender. Kalderen SKAL behandle dem som
//    fejl (alarm + dead-letter), aldrig som "ingen moduler" (byggeplanen T1).
//  - dobbelt: Hele pakken OG enkeltmoduler paa samme abonnement - kunden
//    betaler to gange. Afstemningen melder det.
function modulerFraHandles(planHandle, addOnHandles, katalog = KATALOG, moduler = MODULER) {
  const saet = new Set();
  const ukendte = [];
  let pakke = false, enkelte = false;

  if (planHandle === katalog.BASISPLAN) {
    // basis giver intet modul i sig selv
  } else if (Object.prototype.hasOwnProperty.call(katalog.GAMLE_PLANER, planHandle)) {
    katalog.GAMLE_PLANER[planHandle].forEach((m) => saet.add(m));
  } else {
    ukendte.push(`plan:${planHandle}`);
  }

  const handleTilModul = {};
  for (const [m, a] of Object.entries(katalog.MODUL_ADDONS)) handleTilModul[a.handle] = m;

  for (const h of addOnHandles || []) {
    if (h === katalog.HELE_PAKKEN.handle) {
      pakke = true;
      moduler.forEach((m) => saet.add(m));
    } else if (handleTilModul[h]) {
      enkelte = true;
      saet.add(handleTilModul[h]);
    } else {
      ukendte.push(`add-on:${h}`);
    }
  }
  return { moduler: [...saet].sort(), ukendte, dobbelt: pakke && enkelte };
}

function handleForModul(modul, katalog = KATALOG) {
  const a = katalog.MODUL_ADDONS[modul];
  return a ? a.handle : null;
}

// Det, der skal findes i Frisbii: basisplanen og de add-ons, der saelges.
function produkterTilSalg(katalog = KATALOG) {
  const addOns = Object.entries(katalog.MODUL_ADDONS)
    .filter(([, a]) => a.saelges)
    .map(([modul, a]) => ({ modul, ...a }));
  if (katalog.HELE_PAKKEN.saelges) addOns.push({ modul: null, ...katalog.HELE_PAKKEN });
  return { plan: { handle: katalog.BASISPLAN, prisOere: 0, proevedage: katalog.PROEVEDAGE }, addOns };
}

// Er kataloget i sig selv i orden? Returnerer en liste fejl (tom = i orden).
function tjekKatalog(katalog = KATALOG, moduler = MODULER) {
  const fejl = [];
  const iKatalog = Object.keys(katalog.MODUL_ADDONS).sort();
  const iModuler = [...moduler].sort();
  if (JSON.stringify(iKatalog) !== JSON.stringify(iModuler)) {
    fejl.push(`kataloget naevner [${iKatalog}], MODULER naevner [${iModuler}]`);
  }
  const handles = Object.values(katalog.MODUL_ADDONS).map((a) => a.handle)
    .concat(katalog.HELE_PAKKEN.handle, katalog.BASISPLAN, Object.keys(katalog.GAMLE_PLANER));
  const set = new Set();
  for (const h of handles) {
    if (typeof h !== "string" || !/^[a-z0-9-]+$/.test(h)) fejl.push(`ugyldigt handle: ${h}`);
    if (set.has(h)) fejl.push(`handle bruges to gange: ${h}`);
    set.add(h);
  }
  for (const [m, a] of Object.entries(katalog.MODUL_ADDONS).concat([["hele-pakken", katalog.HELE_PAKKEN]])) {
    if (!Number.isInteger(a.prisOere) || a.prisOere <= 0) fejl.push(`${m}: prisOere skal vaere et positivt heltal`);
    if (typeof a.saelges !== "boolean") fejl.push(`${m}: saelges skal vaere true eller false`);
    if (!a.navn) fejl.push(`${m}: navn mangler`);
  }
  for (const [plan, ms] of Object.entries(katalog.GAMLE_PLANER)) {
    for (const m of ms) if (!moduler.includes(m)) fejl.push(`gammel plan ${plan} giver ukendt modul ${m}`);
  }
  if (!Number.isInteger(katalog.PROEVEDAGE) || katalog.PROEVEDAGE <= 0) fejl.push("PROEVEDAGE skal vaere et positivt heltal");
  return fejl;
}

module.exports = { KATALOG, modulerFraHandles, handleForModul, produkterTilSalg, tjekKatalog };
