// teknik-b.js — markerer det i referatet, der ikke stod i transskriptionen.
//
// D36's bindende forudsætning, altså RELEASE-BLOKERENDE. Deterministisk: samme
// input giver samme markeringer, hver gang. Ingen model, ingen omkostning.
//
// ⚠️ MARKERINGERNE ER IKKE "HER ER FEJLENE". De er "det her stod ikke i det, du
// sagde." En liste, der ligner en fuldstændig fejlliste, gør referatet MERE
// troværdigt — og det var netop grunden til, at teknik A blev forkastet.
// Teksten i brugerfladen skal sige det. Det er ikke en detalje.
//
// DEN SNÆVRE UDGAVE (besluttet 27/9 efter måling). Den brede — alt i referatet,
// der ikke står i transskriptionen — blev målt til MEDIAN 51 markeringer, en
// femtedel af teksten, og forkastet. Årsagen er ikke metoden: referatet er en
// omskrivning, ikke et uddrag, så nye ord er normaltilstanden.
//
// Her markeres kun tre slags ord:
//   TAL           beløb, mål, mængder
//   NAVNE         stort begyndelsesbogstav midt i en sætning
//   FORKORTELSER  to eller flere store bogstaver (USB, IP, VVS)
//
// Det rammer D36's kriterium 3 — intet opfundet om personer, aftaler eller
// beløb. Det fanger IKKE "møbler", for det er et almindeligt lille ord. Det er
// hele prisen ved at være snæver, og den er betalt med vilje.
//
// ⚠️ VÆRNET ER OGSÅ EN PRØVE PÅ PROMPTEN (fundet 1/10, og det ændrer hvad
// denne fil ER). Målingen mod de syv ordnære referater gav tre markeringer, og
// to af dem var `HPFI-relæ` og `HPFI-relæet`, hvor transskriptionen siger
// `HPFI-relædet` — whispers fejlhøring af *relæet*. Modellen RETTEDE den i
// stilhed, og det er præcis det, den ordnære prompt blev valgt for at undgå
// (besluttet 27/9: håndværkerne er ikke trænede læsere, og en pæn tekst bliver
// læst hurtigt og godkendt).
//
// Teknik B er altså ikke kun en spærre mod opfindelser. **Det er det eneste,
// der kan opdage, at den ordnære prompt holder op med at virke** — den dag
// modellen skiftes, leverandøren ændrer noget under os, eller prompten bliver
// redigeret af en, der ikke kender begrundelsen.
//
// Konsekvens, der skal følges op: D36 beskriver i dag værnet som beskyttelse
// mod tilføjelser. Den egenskab skal skrives ind. Og tætheden pr. referat er
// dermed ikke kun et mål for transskriptionens kvalitet — **en stigning kan
// også betyde, at prompten er holdt op med at blive fulgt.**
//
// ⚠️ TALLENE FRA 27/9 (median 0, max 3) KAN IKKE KØRES OM. Scriptet, der
// frembragte dem, blev lavet ad hoc og findes ikke mere — hverken i prøvebænken
// eller i arkivet. `proev-teknik-b.js` måler DENNE kode mod de samme syv
// referater, så tallet fra nu af hører til den kode, vi faktisk udgiver.

"use strict";

// ─── Stopord ─────────────────────────────────────────────────────────────────
// Ligger i koden og ikke i en fil: værnet er release-blokerende, og en manglende
// tekstfil må ikke kunne slå det fra i stilhed. Listen er prøvebænkens
// stopord.txt, ordret.
//
// BEMÆRK: her er INGEN stemming. På dansk deler sammensatte ord forstavelse
// præcis dér, hvor fejlen sidder — "tætningsbånd" og "tætningspunkt" har de
// samme fem første bogstaver. En stammeregel ville skjule netop de fejl, vi
// leder efter.
const STOPORD = new Set(`
og i jeg det at en et den de dem der til er var som med af for ikke om vi os du
dig jer han hun ham hende man men eller hvis hvad hvor hvornår hvilke skal
skulle kan kunne vil ville har havde have være været bliver blive blev blevet
her nu så også kun lidt meget mere mest alle alt andet anden andre nogle noget
nogen ingen hele hver selv sin sit sine min mit mine din dit dine hans hendes
deres vores på ved over under efter før inden mellem uden omkring mod fra ind ud
op ned igen stadig stadigvæk derfor altså bare godt ja nej øh samt både når da
fordi dette denne disse sådan
`.trim().split(/\s+/));

// ─── Normalisering ───────────────────────────────────────────────────────────
// Sker på BEGGE tekster, før de sammenlignes.
//
// Talord → cifre, fordi referatet skriver tal som cifre og transskriptionen
// skriver dem som ord. Uden dette larmer hvert eneste tal — og tal er netop
// det, værnet findes for. (Ann 26/9: cifre er også hurtigere at læse.)
const TALORD = {
  nul: 0, en: 1, et: 1, to: 2, tre: 3, fire: 4, fem: 5, seks: 6, syv: 7,
  otte: 8, ni: 9, ti: 10, elleve: 11, tolv: 12, tretten: 13, fjorten: 14,
  femten: 15, seksten: 16, sytten: 17, atten: 18, nitten: 19, tyve: 20,
  tredive: 30, fyrre: 40, halvtreds: 50, tres: 60, halvfjerds: 70, firs: 80,
  halvfems: 90,
};
const SKALA = { hundrede: 100, hundred: 100, tusind: 1000, tusinde: 1000 };

// Måleenheder ensrettes. Listen er bevidst kort: kun de enheder, der både
// skrives ud og forkortes i praksis.
const ENHEDER = {
  meter: "m", metre: "m", centimeter: "cm", millimeter: "mm",
  kvadratmeter: "m2", kvm: "m2", kubikmeter: "m3", kroner: "kr", procent: "%",
  grader: "°", millimeters: "mm",
};

function rensOrd(ord) {
  return ord
    .toLowerCase()
    .replace(/[.,;:!?()[\]{}"'«»…]/g, "")
    .replace(/^-+|-+$/g, "")
    .trim();
}

// Et ord bliver til ÉN ELLER FLERE sammenligningsnøgler. Bindestreger deles,
// så "IP-grad" findes, hvis både "ip" og "grad" står i transskriptionen.
// Det gør værnet mindre tilbøjeligt til falske alarmer — og kriterium 3 siger,
// at falske alarmer er det dyreste, der kan ske.
function noegler(ord) {
  const rent = rensOrd(ord);
  if (!rent) return [];
  return rent.split("-").filter(Boolean).map((d) => {
    if (ENHEDER[d]) return ENHEDER[d];
    if (TALORD[d] !== undefined) return String(TALORD[d]);
    return d;
  });
}

// "tolv hundrede" → 1200. Køres over hele ordlisten, før den slås op.
function samlTal(ordListe) {
  const ud = [];
  for (let i = 0; i < ordListe.length; i++) {
    const a = rensOrd(ordListe[i]);
    const b = i + 1 < ordListe.length ? rensOrd(ordListe[i + 1]) : "";
    if (TALORD[a] !== undefined && SKALA[b]) {
      ud.push(String(TALORD[a] * SKALA[b]));
      i++;
      continue;
    }
    ud.push(ordListe[i]);
  }
  return ud;
}

// ─── Klassifikationen — de tre slags ord, der markeres ───────────────────────
// Vurderes på det RÅ ord, ikke det normaliserede: store bogstaver er hele
// signalet, og normaliseringen fjerner dem.
const HAR_CIFFER = /\d/;
const STORT_FORBOGSTAV = /^[A-ZÆØÅ]/;
const FORKORTELSE = /^[A-ZÆØÅ0-9]{2,}$/;

function slags(raaOrd, erSaetningsstart) {
  // Bindestregsdele vurderes hver for sig: "IP-grad" er en forkortelse.
  const dele = raaOrd.replace(/[.,;:!?()[\]{}"'«»…]/g, "").split("-");
  if (dele.some((d) => FORKORTELSE.test(d))) return "forkortelse";
  if (HAR_CIFFER.test(raaOrd)) return "tal";
  // Første ord i en sætning har stort bogstav, fordi det er første ord. Det
  // siger intet om, at det er et navn.
  if (!erSaetningsstart && STORT_FORBOGSTAV.test(dele[0])) return "navn";
  return null;
}

// ─── Selve sammenligningen ───────────────────────────────────────────────────
// Der stemmes IKKE på rækkefølge: et ord tælles som fundet, hvis det findes et
// sted i transskriptionen. Billigt og robust over for, at referatet omskriver
// sætninger. Prisen: ombyttede ord fanges ikke ("kunden betaler" mod "betaler
// kunden"). Den fejl hører til 2b-klassen, som B alligevel ikke lover at fange.

function bygOrdbog(tekst) {
  const sat = new Set();
  for (const ord of samlTal(String(tekst || "").split(/\s+/))) {
    for (const n of noegler(ord)) sat.add(n);
  }
  return sat;
}

// Sætningsstart: efter . ! ? eller ved begyndelsen af et felt. Punkter og
// overskrift er hver sin sætning — ellers ville hvert punkts første ord
// blive læst som et navn.
function markerFelt(felttekst, ordbog, feltnavn) {
  const ord = samlTal(String(felttekst || "").trim().split(/\s+/).filter(Boolean));
  const fund = [];
  let saetningsstart = true;

  ord.forEach((raa, nr) => {
    const nk = noegler(raa);
    const rent = rensOrd(raa);
    const type = slags(raa, saetningsstart);

    // Næste ord er sætningsstart, hvis dette ord slutter en sætning.
    saetningsstart = /[.!?]$/.test(raa);

    if (!type) return;
    if (!rent || STOPORD.has(rent)) return;          // stopord markeres aldrig
    if (nk.length && nk.every((n) => ordbog.has(n))) return;  // stod der

    fund.push({ nr, ord: raa, type, felt: feltnavn });
  });

  return { antalOrd: ord.length, fund };
}

// En markering er en SAMMENHÆNGENDE stribe ord, ikke ét ord. "Murerne og VVS
// fra Murerhalsen" tæller som ÉN. Ellers betyder median 5 ikke det samme fra
// referat til referat.
function samlStriber(fund) {
  const striber = [];
  for (const f of fund) {
    const sidste = striber[striber.length - 1];
    if (sidste && sidste.felt === f.felt && f.nr === sidste.sidsteNr + 1) {
      sidste.ord.push(f.ord);
      sidste.typer.add(f.type);
      sidste.sidsteNr = f.nr;
    } else {
      striber.push({
        felt: f.felt, foersteNr: f.nr, sidsteNr: f.nr,
        ord: [f.ord], typer: new Set([f.type]),
      });
    }
  }
  return striber.map((s) => ({
    felt: s.felt,
    tekst: s.ord.join(" "),
    antalOrd: s.ord.length,
    typer: [...s.typer],
  }));
}

// ─── Indgangen ───────────────────────────────────────────────────────────────
// referat: { overskrift, punkter[], fritekst } — modellens egen form (S6).
function marker(transskription, referat) {
  const ordbog = bygOrdbog(transskription);
  const felter = [];

  felter.push(["overskrift", referat && referat.overskrift]);
  (referat && Array.isArray(referat.punkter) ? referat.punkter : [])
    .forEach((p, i) => felter.push([`punkt-${i + 1}`, p]));
  felter.push(["fritekst", referat && referat.fritekst]);

  let antalOrd = 0;
  let fund = [];
  for (const [navn, tekst] of felter) {
    if (!tekst) continue;
    const r = markerFelt(tekst, ordbog, navn);
    antalOrd += r.antalOrd;
    fund = fund.concat(r.fund);
  }

  const markeringer = samlStriber(fund);
  const markeredeOrd = fund.length;
  const taethed = antalOrd ? (markeredeOrd / antalOrd) * 100 : 0;

  // ─── Sikkerhedsventilen ───────────────────────────────────────────────────
  // Overstiger markeringerne 10 % af referatets ord, vises der IKKE
  // enkeltsteder. Femten gule pletter er det samme som ingen. Den ærlige
  // besked er, at maskinen var i tvivl hele vejen — ikke at der er femten
  // bestemte steder at kigge.
  const ventil = taethed > 10;

  return {
    markeringer: ventil ? [] : markeringer,
    antalMarkeringer: markeringer.length,
    markeredeOrd,
    antalOrd,
    // Logges pr. referat. Efter tredive rigtige referater er det et mål for,
    // hvordan modellen klarer ægte stemmer — det, prøvebænkens syv optagelser
    // i én stemme ikke kan svare på. Det koster ingenting at samle op.
    taethed: Math.round(taethed * 10) / 10,
    ventil,
    besked: ventil
      ? "Transskriptionen var usikker. Læs hele referatet igennem, før du gemmer."
      : null,
  };
}

module.exports = {
  marker,
  // Eksporteret til måling og test. Kald dem ikke fra produktionskode.
  _bygOrdbog: bygOrdbog,
  _noegler: noegler,
  _slags: slags,
  _samlTal: samlTal,
  _STOPORD: STOPORD,
};
