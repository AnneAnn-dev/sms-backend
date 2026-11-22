// tilbudslinjer-format.js — formvalideringen af modelsvaret til /api/tilbud/tilbudslinjer
// (Fase 5). Reglerne er kontraktens afsnit 5 (docs/fase5-tilbud-kontrakt.md, udkast 8, godkendt
// af Ann 21/11).
//
// ÉN fil, to brugere: ruten (spor 1) og maal-tilbudslinjer.js (spor 2). Så måler målingen
// præcis det, serveren gør — ikke en kopi af reglerne, der langsomt glider fra hinanden.
// Ejes af spor 2.
//
// TO SLAGS FUND:
//   - FORMFEJL afviser svaret (ruten prøver én gang mere): ukendte felter, forkerte typer, tal som
//     tekst eller med for mange decimaler, lofter, `uenige`, der peger på et felt eller en kilde,
//     der ikke findes.
//   - ORDRET (B4, Ann 21/11: markér, fjern ikke): en materialebeskrivelse, der ikke står i nogen
//     kilde, eller en `uenige`-værdi, der ikke står i den kilde, den henviser til, bliver stående
//     med `ordret: false`. Svaret afvises ikke for det. Intet fjernes i stilhed.
//
// FORMEN VALIDERES, ALDRIG INDHOLDET (P5). Ordret-tjekket er det eneste indholdstjek, og det
// afviser intet; det markerer, så håndværkeren ser det, og målingen tæller det (G2).
//
// ⚠️ VALIDATOREN MÅ ALDRIG SELV KASTE (fundet 2/10 i referatet: `punkter` som streng væltede
// ruten). Hvert felt læses med en typekontrol, ikke med en antagelse.
//
// Normaliseringen (enhed via tilbudslinjer-enheder.js, opgavetype mod firmaets typer, faktorer
// ganget, tal til tekst) er rutens. Denne fil afgør, om svaret må bruges, og markerer ordret.

"use strict";

// Foreløbige lofter (kontraktens afsnit 7). De endelige kommer fra målingen.
const LOFT = {
  titel: 100, beskrivelse: 200, materialer: 60, typenavn: 60, enhed: 30,
  uenige: 20, vaerdi: 200, faktorer: 3, svarTegn: 30000,
};

const FELTER = ["tilbud_titel", "opgave_titel", "opgavetype", "maengde", "materialer", "uenige"];
const erObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const ukendte = (o, tilladte) => Object.keys(o).filter((k) => !tilladte.includes(k));

// JSON-tal ≥ 0 med højst tre decimaler. Tekst ("1,5") er en formfejl, ikke et tal.
function godtTal(v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return false;
  return Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;
}

function tekstfelt(v, navn, loft, fejl) {
  if (v === null || v === undefined) return;
  if (typeof v !== "string") { fejl.push(`${navn} er ikke tekst`); return; }
  if (!v.trim()) fejl.push(`${navn} er tom`);
  if (v.length > loft) fejl.push(`${navn} for lang: ${v.length} tegn`);
}

// "Uden hensyn til store/små bogstaver og mellemrum" (kontrakten): sammenlign uden dem.
const flad = (s) => String(s == null ? "" : s).toLowerCase().replace(/\s+/g, "");
const findesI = (tekst, kilde) => flad(kilde).includes(flad(tekst));

/**
 * @param {string} raat  modellens rå svar
 * @param {object} data  det samme data, prompten blev bygget af (kontraktens afsnit 4)
 * @returns {{ok: true, obj: object, ordret: {ialt: number, ikke: number}} | {ok: false, fejl: string[]}}
 *   Ved ok er `obj` modelsvaret med `ordret` (true/false) tilføjet på hver materialelinje og på
 *   hver værdi i `uenige`. Modellen må ikke selv skrive `ordret`; gør den, er det et opfundet felt.
 */
function laesSvar(raat, data) {
  try {
    return laes(raat, data || {});
  } catch (e) {
    // Må ikke kunne ske. Sker det alligevel, er svaret ubrugeligt, ikke ruten væltet.
    return { ok: false, fejl: ["validatoren fejlede: " + (e && e.message)] };
  }
}

function laes(raat, data) {
  if (typeof raat !== "string" || !raat.trim()) return { ok: false, fejl: ["tomt svar fra modellen"] };
  const t = raat.trim().replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, "");
  if (t.length > LOFT.svarTegn) return { ok: false, fejl: [`svar over loftet: ${t.length} tegn`] };

  let obj;
  try { obj = JSON.parse(t); } catch { return { ok: false, fejl: ["JSON kan ikke parses"] }; }
  if (!erObj(obj)) return { ok: false, fejl: ["svaret er ikke et objekt"] };

  const fejl = [];
  for (const k of FELTER) if (!(k in obj)) fejl.push(`felt mangler: ${k}`);
  for (const k of ukendte(obj, FELTER)) fejl.push(`opfundet felt: ${k}`);

  tekstfelt(obj.tilbud_titel, "tilbud_titel", LOFT.titel, fejl);
  tekstfelt(obj.opgave_titel, "opgave_titel", LOFT.titel, fejl);

  // opgavetype
  const ot = obj.opgavetype;
  if (ot !== null && ot !== undefined) {
    if (!erObj(ot)) fejl.push("opgavetype er ikke et objekt");
    else {
      for (const k of ukendte(ot, ["navn", "enhed"])) fejl.push(`opfundet felt i opgavetype: ${k}`);
      if (typeof ot.navn !== "string" || !ot.navn.trim()) fejl.push("opgavetype.navn er tom");
      else if (ot.navn.length > LOFT.typenavn) fejl.push(`opgavetype.navn for lang: ${ot.navn.length} tegn`);
      tekstfelt(ot.enhed, "opgavetype.enhed", LOFT.enhed, fejl);
    }
  }

  // maengde: mål, ikke et resultat (B3). 1–3 faktorer; modellen ganger ikke.
  const mg = obj.maengde;
  if (mg !== null && mg !== undefined) {
    if (!erObj(mg)) fejl.push("maengde er ikke et objekt");
    else {
      for (const k of ukendte(mg, ["faktorer", "enhed"])) fejl.push(`opfundet felt i maengde: ${k}`);
      if (!Array.isArray(mg.faktorer) || mg.faktorer.length < 1 || mg.faktorer.length > LOFT.faktorer) {
        fejl.push(`maengde.faktorer skal være en liste med 1-${LOFT.faktorer} tal`);
      } else if (!mg.faktorer.every(godtTal)) {
        fejl.push("maengde.faktorer skal være tal ≥ 0 med højst tre decimaler");
      }
      tekstfelt(mg.enhed, "maengde.enhed", LOFT.enhed, fejl);
    }
  }

  // materialer
  const mat = obj.materialer;
  let antalMat = 0;
  if (mat !== null && mat !== undefined) {
    if (!Array.isArray(mat)) fejl.push("materialer er ikke en liste");
    else {
      antalMat = mat.length;
      if (mat.length > LOFT.materialer) fejl.push(`for mange materialer: ${mat.length}`);
      mat.forEach((m, i) => {
        const n = `materialer[${i}]`;
        if (!erObj(m)) { fejl.push(`${n} er ikke et objekt`); return; }
        for (const k of ukendte(m, ["beskrivelse", "antal", "enhed"])) fejl.push(`opfundet felt i ${n}: ${k}`);
        if (typeof m.beskrivelse !== "string" || !m.beskrivelse.trim()) fejl.push(`${n}.beskrivelse er tom`);
        else if (m.beskrivelse.length > LOFT.beskrivelse) fejl.push(`${n}.beskrivelse for lang: ${m.beskrivelse.length} tegn`);
        if (m.antal !== null && m.antal !== undefined && !godtTal(m.antal)) fejl.push(`${n}.antal er ikke et tal ≥ 0 med højst tre decimaler`);
        tekstfelt(m.enhed, `${n}.enhed`, LOFT.enhed, fejl);
      });
    }
  }

  // Kildernes tekst, til uenige-tjekket og ordret-tjekket.
  const refTekst = new Map(), refDato = new Map();
  if (Array.isArray(data.referater)) for (const r of data.referater) {
    if (r && Number.isInteger(r.nr)) { refDato.set(r.nr, String(r.dato)); refTekst.set(r.nr, String(r.tekst || "")); }
  }
  const beskrivelse = typeof data.beskrivelse === "string" ? data.beskrivelse : "";
  const noter = typeof data.noter === "string" ? data.noter : "";
  const alleKilder = [beskrivelse, noter, ...refTekst.values()].join("\n");

  // uenige: hvert punkt skal pege på et felt, der findes, og på kilder, der var i input.
  const ue = obj.uenige;
  if (ue !== null && ue !== undefined) {
    if (!Array.isArray(ue)) fejl.push("uenige er ikke en liste");
    else {
      if (ue.length > LOFT.uenige) fejl.push(`for mange punkter i uenige: ${ue.length}`);
      ue.forEach((u, i) => {
        const n = `uenige[${i}]`;
        if (!erObj(u)) { fejl.push(`${n} er ikke et objekt`); return; }
        for (const k of ukendte(u, ["felt", "vaerdier"])) fejl.push(`opfundet felt i ${n}: ${k}`);
        const felt = u.felt;
        const m = typeof felt === "string" ? felt.match(/^materialer\[(\d+)\]$/) : null;
        if (felt === "maengde" || felt === "opgavetype") { /* findes altid som felt */ }
        else if (m) { if (Number(m[1]) >= antalMat) fejl.push(`${n}.felt peger på en linje, der ikke findes: ${felt}`); }
        else fejl.push(`${n}.felt er ukendt: ${typeof felt === "string" ? felt.slice(0, 40) : typeof felt}`);
        if (!Array.isArray(u.vaerdier) || u.vaerdier.length < 2) { fejl.push(`${n}.vaerdier skal være en liste med mindst to værdier`); return; }
        u.vaerdier.forEach((v, j) => {
          const vn = `${n}.vaerdier[${j}]`;
          if (!erObj(v)) { fejl.push(`${vn} er ikke et objekt`); return; }
          if (typeof v.vaerdi !== "string" || !v.vaerdi.trim()) fejl.push(`${vn}.vaerdi er tom`);
          else if (v.vaerdi.length > LOFT.vaerdi) fejl.push(`${vn}.vaerdi for lang`);
          if (v.kilde === "beskrivelse") {
            for (const k of ukendte(v, ["kilde", "dato", "vaerdi"])) fejl.push(`opfundet felt i ${vn}: ${k}`);
            if (!beskrivelse.trim()) fejl.push(`${vn}: der var ingen beskrivelse i input`);
            else if (v.dato !== String(data.beskrivelse_dato)) fejl.push(`${vn}: beskrivelsens dato passer ikke`);
          } else if (v.kilde === "noter") {
            for (const k of ukendte(v, ["kilde", "dato", "vaerdi"])) fejl.push(`opfundet felt i ${vn}: ${k}`);
            if (!noter.trim()) fejl.push(`${vn}: der var ingen noter i input`);
            else if (v.dato !== null) fejl.push(`${vn}: noterne har ingen dato`);
          } else if (v.kilde === "referat") {
            for (const k of ukendte(v, ["kilde", "nr", "dato", "vaerdi"])) fejl.push(`opfundet felt i ${vn}: ${k}`);
            if (!refDato.has(v.nr)) fejl.push(`${vn}: referat nr ${JSON.stringify(v.nr)} var ikke i input`);
            else if (v.dato !== refDato.get(v.nr)) fejl.push(`${vn}: datoen passer ikke til referat ${v.nr}`);
          } else {
            fejl.push(`${vn}.kilde er ukendt`);
          }
        });
      });
    }
  }

  if (fejl.length) return { ok: false, fejl };

  // Ordret (B4): markér, fjern ikke. Kun på et svar, der har bestået formen.
  let ialt = 0, ikke = 0;
  const ud = { ...obj };
  ud.materialer = (obj.materialer || []).map((m) => {
    const ordret = findesI(m.beskrivelse, alleKilder);
    ialt++; if (!ordret) ikke++;
    return { ...m, ordret };
  });
  ud.uenige = (obj.uenige || []).map((u) => ({
    ...u,
    vaerdier: u.vaerdier.map((v) => {
      const kilde = v.kilde === "beskrivelse" ? beskrivelse : v.kilde === "noter" ? noter : refTekst.get(v.nr);
      const ordret = findesI(v.vaerdi, kilde);
      ialt++; if (!ordret) ikke++;
      return { ...v, ordret };
    }),
  }));
  return { ok: true, obj: ud, ordret: { ialt, ikke } };
}

module.exports = { laesSvar, LOFT, FELTER, _godtTal: godtTal, _findesI: findesI };
