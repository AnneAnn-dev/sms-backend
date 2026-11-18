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
// kommer: true = vises graatonet som "Kommer snart" i Din pakke (T9, Ann 31/10).
//
// PAKKER (Fase 4, Ann 8/11-26): ét add-on, der giver flere moduler. "Kundehenvendelser
// og SoMe" saelges samlet til 200 kr./md. og giver modulerne svar og facebook. De to
// moduler beholder deres egne raekker og handles (modul-svar, modul-facebook), saa de
// kan saelges hver for sig senere; indtil da vises de ikke for sig i Din pakke
// (kommer: false) og oprettes ikke i Frisbii (saelges: false). En pakkes handle bliver
// staaende i Frisbii for altid. Hele pakken er IKKE en pakke her: den foelger MODULER.
//
// TO UDGAVER (Fase 4 salg, Ann og Anne 16-17/11-26, docs/fase4-salg-byggeplan.md):
//  - "Skrivehjaelp og SoMe med kunder" (modul-svar-some): svar, facebook og kunder.
//    Til haandvaerkere, saelges paa ditdigitalekontor.dk.
//  - "Skrivehjaelp og SoMe uden kunder" (modul-svar-some-uden-kunder): svar og
//    facebook. Til virksomheder uden for haandvaerket.
//  Begge 200 kr./md. Handles er endelige; navnene kan rettes her.
//  Om de saelges, styres af flaget SKRIVEHJAELP_SALG (flags.js, Ann 18/11) -
//  ikke af en vaerdi her, saa salget kan taendes i Railway pr. miljoe.
//  Et modul maa derfor gerne vaere i flere pakker. To pakker med samme modul paa
//  ét abonnement er dobbelt betaling og meldes af modulerFraHandles.
//  Modulet kunder saelges ikke for sig og oprettes ikke i Frisbii; prisen (200 kr.,
//  Ann 17/11) er der kun, fordi tjekKatalog kraever en.
//
// BESTILLINGSSIDEN (Ann og Anne 18/11-26): /bestil er den eneste betalingsside;
// hjemmesiden linker kun. Teksterne til siden staar her, saa navne, priser og
// tekster ikke kan glide fra hinanden (ingen dublet paa hjemmesiden):
//  - beskrivelse: linjen under varens navn. Kraeves for alt, der saelges, og
//    for alle pakker (tjekKatalog).
//  - paaListen: false = varen staar IKKE paa den fulde liste, kun paa sin egen
//    side (/bestil?pakke=<noegle>). "Uden kunder" saelges kun dér.
//  - side: overskrift og intro (og evt. firmaHint) til varens egen, laaste side
//    /bestil?pakke=<noegle>. Kraeves, naar paaListen er false.
// Teksterne er godkendt af Ann og Anne 18/11; Anne ejer dem.
//
// Rene funktioner, ingen netvaerk, ingen miljoevariabler. Proeves af
// proev-frisbii-katalog.js, som ogsaa tjekker, at kataloget, MODULER og
// CHECK-reglen i databasen naevner de samme moduler.
// -----------------------------------------------------------------------------
"use strict";

const { MODULER } = require("./moduler");
const { SKRIVEHJAELP_SALG } = require("./flags");

const BASISPLAN = "ddk-basis";
const PROEVEDAGE = 7;

// Planer fra foer Fase 3. Abonnementer paa dem har ingen add-ons.
const GAMLE_PLANER = {
  "abonnement-standard": ["telefon"],
};

const MODUL_ADDONS = {
  telefon:  { handle: "modul-telefon",  navn: "Telefonpasser",     prisOere: 50000, saelges: true,
              beskrivelse: "Kunden får en SMS og beskriver selv opgaven, når du ikke kan tage telefonen." },
  referat:  { handle: "modul-referat",  navn: "Referat",           prisOere: 40000, saelges: true,
              beskrivelse: "Indtal et referat hos kunden, og placér det på opgaven." },
  tilbud:   { handle: "modul-tilbud",   navn: "Tilbud",            prisOere: 50000, saelges: false, kommer: true },
  faktura:  { handle: "modul-faktura",  navn: "Faktura",           prisOere: 50000, saelges: false, kommer: true },
  booking:  { handle: "modul-booking",  navn: "Booking",           prisOere: 40000, saelges: false },
  svar:     { handle: "modul-svar",     navn: "Kundehenvendelser", prisOere: 20000, saelges: false },
  facebook: { handle: "modul-facebook", navn: "SoMe-værktøj",      prisOere: 20000, saelges: false },
  kunder:   { handle: "modul-kunder",   navn: "Kunder og opgaver", prisOere: 20000, saelges: false },
};

const PAKKER = {
  "svar-some": { handle: "modul-svar-some", navn: "Skrivehjælp og SoMe med kunder", prisOere: 20000,
                 moduler: ["svar", "facebook", "kunder"], saelges: SKRIVEHJAELP_SALG, kommer: true,
                 beskrivelse: "Svar til kunder på SMS og mail, opslag til Facebook og Instagram og svar på kommentarer. Kunder og opgaver er med.",
                 side: {
                   overskrift: "Svar dine kunder hurtigere.",
                   intro: "Skrivehjælp laver udkast til dine svar på SMS og mail, og SoMe-værktøjet skriver dine opslag til Facebook og Instagram. Kunder og opgaver er med.",
                 } },
  "svar-some-uden-kunder": { handle: "modul-svar-some-uden-kunder", navn: "Skrivehjælp og SoMe uden kunder", prisOere: 20000,
                 moduler: ["svar", "facebook"], saelges: SKRIVEHJAELP_SALG, kommer: true,
                 beskrivelse: "Svar til kunder på SMS og mail, opslag til Facebook og Instagram og svar på kommentarer.",
                 paaListen: false,
                 side: {
                   overskrift: "Skriv til dine kunder og på sociale medier – uden besvær.",
                   intro: "Udkast til svar på SMS og mail og opslag til Facebook og Instagram. Til dig, der ikke har brug for kunde- og opgavestyring.",
                   firmaHint: "Det er navnet, dine kunder kender dig under.",
                 } },
};

const HELE_PAKKEN = { handle: "modul-hele-pakken", navn: "Hele pakken", prisOere: 150000, saelges: false };

const KATALOG = { BASISPLAN, PROEVEDAGE, GAMLE_PLANER, MODUL_ADDONS, PAKKER, HELE_PAKKEN };

// Udgaver (Fase 4 salg): de andre pakker, der deler et modul med pakken - fx
// "Skrivehjaelp og SoMe med kunder" og "... uden kunder". Man har hoejst den
// ene; begge er dobbelt betaling. Bruges af Din pakke (skift) og bestillingen
// (aldrig begge i samme koeb). Afledt af kataloget - ingen liste at vedligeholde.
function udgaver(noegle, katalog = KATALOG) {
  const p = (katalog.PAKKER || {})[noegle];
  if (!p) return [];
  return Object.entries(katalog.PAKKER)
    .filter(([k, a]) => k !== noegle && (a.moduler || []).some((m) => p.moduler.includes(m)))
    .map(([k]) => k);
}

// Alle varer, man kan have et eksemplar af i Din pakke: hvert modul og hver pakke.
// noegle er det, appen og /api/pakke bruger ({ modul: noegle }); moduler er det,
// varen giver. Hele pakken er ikke med (den saelges ikke og foelger MODULER).
function varer(katalog = KATALOG) {
  return [
    ...Object.entries(katalog.MODUL_ADDONS).map(([m, a]) => ({ noegle: m, moduler: [m], ...a })),
    ...Object.entries(katalog.PAKKER || {}).map(([p, a]) => ({ noegle: p, ...a, moduler: [...a.moduler] })),
  ];
}
function vare(noegle, katalog = KATALOG) {
  return varer(katalog).find((v) => v.noegle === noegle) || null;
}

// Hvilke moduler giver en plan + en liste add-on-handles?
// Returnerer { moduler, ukendte, dobbelt }:
//  - moduler: sorteret, uden dubletter
//  - ukendte: handles, kataloget ikke kender. Kalderen SKAL behandle dem som
//    fejl (alarm + dead-letter), aldrig som "ingen moduler" (byggeplanen T1).
//  - dobbelt: Hele pakken OG andre add-ons, en pakke OG et modul, den
//    allerede giver, eller to forskellige pakker, der giver samme modul, paa
//    samme abonnement - kunden betaler to gange. Afstemningen melder det.
function modulerFraHandles(planHandle, addOnHandles, katalog = KATALOG, moduler = MODULER) {
  const saet = new Set();
  const ukendte = [];
  let pakke = false, enkelte = false;
  const fraModul = new Set(), fraPakke = new Set();
  const pakkerPrModul = {}; // modul -> de pakke-handles, der giver det

  if (planHandle === katalog.BASISPLAN) {
    // basis giver intet modul i sig selv
  } else if (Object.prototype.hasOwnProperty.call(katalog.GAMLE_PLANER, planHandle)) {
    katalog.GAMLE_PLANER[planHandle].forEach((m) => saet.add(m));
  } else {
    ukendte.push(`plan:${planHandle}`);
  }

  const handleTilModul = {};
  for (const [m, a] of Object.entries(katalog.MODUL_ADDONS)) handleTilModul[a.handle] = m;
  const handleTilPakke = {};
  for (const a of Object.values(katalog.PAKKER || {})) handleTilPakke[a.handle] = a;

  for (const h of addOnHandles || []) {
    if (h === katalog.HELE_PAKKEN.handle) {
      pakke = true;
      moduler.forEach((m) => saet.add(m));
    } else if (handleTilModul[h]) {
      enkelte = true;
      saet.add(handleTilModul[h]);
      fraModul.add(handleTilModul[h]);
    } else if (handleTilPakke[h]) {
      enkelte = true;
      handleTilPakke[h].moduler.forEach((m) => {
        saet.add(m); fraPakke.add(m);
        (pakkerPrModul[m] = pakkerPrModul[m] || new Set()).add(h);
      });
    } else {
      ukendte.push(`add-on:${h}`);
    }
  }
  const overlap = [...fraModul].some((m) => fraPakke.has(m))
    || Object.values(pakkerPrModul).some((hs) => hs.size > 1);
  return { moduler: [...saet].sort(), ukendte, dobbelt: (pakke && enkelte) || overlap };
}

function handleForModul(modul, katalog = KATALOG) {
  const a = katalog.MODUL_ADDONS[modul];
  return a ? a.handle : null;
}

// Handle for en vare (et modul eller en pakke), fx til checkout.
function handleForVare(noegle, katalog = KATALOG) {
  const v = vare(noegle, katalog);
  return v ? v.handle : null;
}

// Det, der skal findes i Frisbii: basisplanen og de add-ons, der saelges.
function produkterTilSalg(katalog = KATALOG) {
  const addOns = Object.entries(katalog.MODUL_ADDONS)
    .filter(([, a]) => a.saelges)
    .map(([modul, a]) => ({ modul, ...a }));
  for (const [p, a] of Object.entries(katalog.PAKKER || {})) {
    if (a.saelges) addOns.push({ modul: null, pakke: p, ...a });
  }
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
  const pakker = katalog.PAKKER || {};
  const handles = Object.values(katalog.MODUL_ADDONS).map((a) => a.handle)
    .concat(Object.values(pakker).map((a) => a.handle))
    .concat(katalog.HELE_PAKKEN.handle, katalog.BASISPLAN, Object.keys(katalog.GAMLE_PLANER));
  const set = new Set();
  for (const h of handles) {
    if (typeof h !== "string" || !/^[a-z0-9-]+$/.test(h)) fejl.push(`ugyldigt handle: ${h}`);
    if (set.has(h)) fejl.push(`handle bruges to gange: ${h}`);
    set.add(h);
  }
  for (const [m, a] of Object.entries(katalog.MODUL_ADDONS).concat(Object.entries(pakker), [["hele-pakken", katalog.HELE_PAKKEN]])) {
    if (!Number.isInteger(a.prisOere) || a.prisOere <= 0) fejl.push(`${m}: prisOere skal vaere et positivt heltal`);
    if (typeof a.saelges !== "boolean") fejl.push(`${m}: saelges skal vaere true eller false`);
    if (!a.navn) fejl.push(`${m}: navn mangler`);
  }
  // Bestillingssiden (18/11): beskrivelse paa alt, der kan saelges, og paa alle
  // pakker (deres salg styres af et flag, saa de skal vaere klar paa forhaand).
  const medTekst = Object.entries(katalog.MODUL_ADDONS).filter(([, a]) => a.saelges)
    .concat(Object.entries(pakker));
  for (const [m, a] of medTekst) {
    if (typeof a.beskrivelse !== "string" || !a.beskrivelse.trim()) fejl.push(`${m}: beskrivelse mangler`);
  }
  for (const [m, a] of Object.entries(katalog.MODUL_ADDONS).concat(Object.entries(pakker))) {
    if (a.paaListen !== undefined && typeof a.paaListen !== "boolean") fejl.push(`${m}: paaListen skal vaere true eller false`);
    if (a.side !== undefined) {
      const s = a.side || {};
      if (typeof s.overskrift !== "string" || !s.overskrift.trim() || typeof s.intro !== "string" || !s.intro.trim()) {
        fejl.push(`${m}: side skal have overskrift og intro`);
      }
      if (s.firmaHint !== undefined && (typeof s.firmaHint !== "string" || !s.firmaHint.trim())) fejl.push(`${m}: side.firmaHint er tom`);
    }
    if (a.paaListen === false && !a.side) fejl.push(`${m}: paaListen false kraever en side (ellers kan varen ikke koebes nogen steder)`);
  }
  const saetTilPakke = {};
  for (const [p, a] of Object.entries(pakker)) {
    if (Object.prototype.hasOwnProperty.call(katalog.MODUL_ADDONS, p)) fejl.push(`pakken ${p} hedder det samme som et modul`);
    if (!Array.isArray(a.moduler) || a.moduler.length < 2) fejl.push(`pakken ${p} skal give mindst to moduler`);
    for (const m of a.moduler || []) {
      if (!moduler.includes(m)) fejl.push(`pakken ${p} giver ukendt modul ${m}`);
    }
    // Et modul maa gerne vaere i flere pakker (Fase 4 salg), men to pakker, der
    // giver PRAECIS de samme moduler, er den samme vare under to handles.
    const saet = JSON.stringify([...new Set(a.moduler || [])].sort());
    if (saetTilPakke[saet]) fejl.push(`pakkerne ${saetTilPakke[saet]} og ${p} giver de samme moduler`);
    saetTilPakke[saet] = p;
  }
  for (const [plan, ms] of Object.entries(katalog.GAMLE_PLANER)) {
    for (const m of ms) if (!moduler.includes(m)) fejl.push(`gammel plan ${plan} giver ukendt modul ${m}`);
  }
  if (!Number.isInteger(katalog.PROEVEDAGE) || katalog.PROEVEDAGE <= 0) fejl.push("PROEVEDAGE skal vaere et positivt heltal");
  return fejl;
}

module.exports = { KATALOG, varer, udgaver, vare, modulerFraHandles, handleForModul, handleForVare, produkterTilSalg, tjekKatalog };
