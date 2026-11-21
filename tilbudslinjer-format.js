// tilbudslinjer-format.js — formvalideringen af modelsvaret til /api/tilbud/tilbudslinjer
// (Fase 5). Reglerne er kontraktens afsnit 5 (docs/fase5-tilbud-kontrakt.md, godkendt 21/11).
//
// ÉN fil, to brugere: ruten (spor 1) og maal-tilbudslinjer.js (spor 2). Så måler målingen
// præcis det, serveren afviser — ikke en kopi af reglerne, der langsomt glider fra hinanden.
//
// FORMEN VALIDERES, ALDRIG INDHOLDET (P5). Om et materiale står i kilderne, er målingens
// spørgsmål (G2), ikke denne fils. Det, der tjekkes her, er det, en maskine kan afgøre:
// felterne, typerne, tallene, lofterne og at "uenige" peger på kilder, der faktisk var i input.
//
// ⚠️ VALIDATOREN MÅ ALDRIG SELV KASTE (fundet 2/10 i referatet: `punkter` som streng væltede
// ruten). Hvert felt læses med en typekontrol, ikke med en antagelse.
//
// Normaliseringen (enhed og opgavetype mod firmaets lister, tal til tekst) er rutens. Denne
// fil afgør kun, om svaret må bruges.

"use strict";

// Foreløbige lofter (kontraktens afsnit 7). De endelige kommer fra målingen.
const LOFT = { titel: 100, beskrivelse: 200, materialer: 60, typenavn: 100, enhed: 40, vaerdi: 200, svarTegn: 30000 };

const FELTER = ["tilbud_titel", "opgave_titel", "opgavetype", "maengde", "materialer", "uenige"];
const erObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const ukendte = (o, tilladte) => Object.keys(o).filter((k) => !tilladte.includes(k));

// JSON-tal ≥ 0 med højst tre decimaler. Tekst ("1,5") er en formfejl, ikke et tal.
function godtTal(v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return false;
  return Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;
}

function tekstfelt(v, navn, loft, fejl, { tomOk = false } = {}) {
  if (v === null) return;
  if (typeof v !== "string") { fejl.push(`${navn} er ikke tekst`); return; }
  if (!tomOk && !v.trim()) fejl.push(`${navn} er tom`);
  if (v.length > loft) fejl.push(`${navn} for lang: ${v.length} tegn`);
}

/**
 * @param {string} raat  modellens rå svar
 * @param {object} data  det samme data, prompten blev bygget af (kontraktens afsnit 4)
 * @returns {{ok: true, obj: object} | {ok: false, fejl: string[]}}
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
      if (ot.enhed !== null && ot.enhed !== undefined) tekstfelt(ot.enhed, "opgavetype.enhed", LOFT.enhed, fejl);
    }
  }

  // maengde
  const mg = obj.maengde;
  if (mg !== null && mg !== undefined) {
    if (!erObj(mg)) fejl.push("maengde er ikke et objekt");
    else {
      for (const k of ukendte(mg, ["vaerdi", "enhed"])) fejl.push(`opfundet felt i maengde: ${k}`);
      if (!godtTal(mg.vaerdi)) fejl.push("maengde.vaerdi er ikke et tal ≥ 0 med højst tre decimaler");
      if (mg.enhed !== null && mg.enhed !== undefined) tekstfelt(mg.enhed, "maengde.enhed", LOFT.enhed, fejl);
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
        if (m.enhed !== null && m.enhed !== undefined) tekstfelt(m.enhed, `${n}.enhed`, LOFT.enhed, fejl);
      });
    }
  }

  // uenige: hvert punkt skal pege på et felt, der findes, og på kilder, der var i input.
  const ue = obj.uenige;
  if (ue !== null && ue !== undefined) {
    if (!Array.isArray(ue)) fejl.push("uenige er ikke en liste");
    else {
      const refDato = new Map();
      if (Array.isArray(data.referater)) for (const r of data.referater) if (r && Number.isInteger(r.nr)) refDato.set(r.nr, String(r.dato));
      const harBeskrivelse = typeof data.beskrivelse === "string" && data.beskrivelse.trim() !== "";
      const harNoter = typeof data.noter === "string" && data.noter.trim() !== "";
      ue.forEach((u, i) => {
        const n = `uenige[${i}]`;
        if (!erObj(u)) { fejl.push(`${n} er ikke et objekt`); return; }
        for (const k of ukendte(u, ["felt", "vaerdier"])) fejl.push(`opfundet felt i ${n}: ${k}`);
        const felt = u.felt;
        const m = typeof felt === "string" ? felt.match(/^materialer\[(\d+)\]$/) : null;
        if (felt === "maengde" || felt === "opgavetype") { /* findes altid som felt */ }
        else if (m) { if (Number(m[1]) >= antalMat) fejl.push(`${n}.felt peger på en linje, der ikke findes: ${felt}`); }
        else fejl.push(`${n}.felt er ukendt: ${typeof felt === "string" ? felt : typeof felt}`);
        if (!Array.isArray(u.vaerdier) || u.vaerdier.length < 2) { fejl.push(`${n}.vaerdier skal være en liste med mindst to værdier`); return; }
        u.vaerdier.forEach((v, j) => {
          const vn = `${n}.vaerdier[${j}]`;
          if (!erObj(v)) { fejl.push(`${vn} er ikke et objekt`); return; }
          if (typeof v.vaerdi !== "string" || !v.vaerdi.trim()) fejl.push(`${vn}.vaerdi er tom`);
          else if (v.vaerdi.length > LOFT.vaerdi) fejl.push(`${vn}.vaerdi for lang`);
          if (v.kilde === "beskrivelse") {
            for (const k of ukendte(v, ["kilde", "dato", "vaerdi"])) fejl.push(`opfundet felt i ${vn}: ${k}`);
            if (!harBeskrivelse) fejl.push(`${vn}: der var ingen beskrivelse i input`);
            else if (v.dato !== String(data.beskrivelse_dato)) fejl.push(`${vn}: beskrivelsens dato passer ikke`);
          } else if (v.kilde === "noter") {
            for (const k of ukendte(v, ["kilde", "dato", "vaerdi"])) fejl.push(`opfundet felt i ${vn}: ${k}`);
            if (!harNoter) fejl.push(`${vn}: der var ingen noter i input`);
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

  return fejl.length ? { ok: false, fejl } : { ok: true, obj };
}

module.exports = { laesSvar, LOFT, FELTER, _godtTal: godtTal };
