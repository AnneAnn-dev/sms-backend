// tilbudslinjer-enheder.js — enhederne til tilbudsforslaget (Fase 5): grundlisten, synonymerne
// og opslaget. ÉT sted i koden (kontraktens afsnit 5, A9): ruten (spor 1) importerer den, og
// maal-tilbudslinjer.js bruger den samme, så målingens facit og serverens opslag aldrig glider fra
// hinanden. Ejes af spor 2.
//
// Rækkefølgen er kontraktens: (1) grundlistens synonymer, (2) firmaets egne enheder, (3) ellers en
// ny enhed (`ny: true`), som oprettes, først når håndværkeren bekræfter linjen.
// Sammenligningen ser bort fra store/små bogstaver, punktum og mellemrum.
//
// "t" er BEVIDST ikke med: det kan betyde både time og ton (kontrakten, 21/11).
// Listen udvides efter den første måned med håndværkere (byggeplanens #11). Ændres den, skal
// målingens enhedssager (A9) tjekkes igen.

"use strict";

const GRUNDLISTE = ["stk.", "m", "cm", "m²", "m³", "kg", "timer", "dag", "sæt"];

// Kontraktens tabel, ordret. Grundlistens egne navne slås op uden at stå her.
const SYNONYMER = {
  "m²": ["m2", "kvm", "kvadratmeter", "kvadratmetre"],
  "m": ["meter", "lbm", "løbende meter", "lb. m"],
  "m³": ["m3", "kubikmeter"],
  "cm": ["centimeter"],
  "stk.": ["stk", "styk", "styks", "stykker"],
  "kg": ["kilo", "kilogram"],
  "timer": ["time", "timer", "tim."],
  "dag": ["dage", "dag"],
  "sæt": ["sæt"],
};

/** Nøglen til sammenligning: små bogstaver, uden punktum og mellemrum. */
function noegle(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/[.\s]+/g, "");
}

const OPSLAG = new Map();
for (const navn of GRUNDLISTE) OPSLAG.set(noegle(navn), navn);
for (const [navn, ord] of Object.entries(SYNONYMER)) for (const o of ord) {
  const k = noegle(o);
  if (OPSLAG.has(k) && OPSLAG.get(k) !== navn) throw new Error(`synonymet "${o}" peger på to enheder`);
  OPSLAG.set(k, navn);
}

/**
 * Slår enheden op, som modellen skrev den.
 * @param {string|null} ord             enheden fra modelsvaret
 * @param {Array<{id?: string, navn: string}>} [egne]  firmaets egne enheder
 * @returns {null | {navn: string, id: string|null, grundliste: boolean, ny: boolean}}
 */
function findEnhed(ord, egne = []) {
  if (ord == null || !String(ord).trim()) return null;
  const k = noegle(ord);
  if (OPSLAG.has(k)) return { navn: OPSLAG.get(k), id: null, grundliste: true, ny: false };
  for (const e of Array.isArray(egne) ? egne : []) {
    if (e && noegle(e.navn) === k) return { navn: e.navn, id: e.id || null, grundliste: false, ny: false };
  }
  return { navn: String(ord).trim(), id: null, grundliste: false, ny: true };
}

module.exports = { GRUNDLISTE, SYNONYMER, findEnhed, noegle };
