// routes/tilbud/enheder.js — grundlisten og dens synonymer (kontrakt §5, A9, #11).
//
// ÉN LISTE I KODEN. Serveren mapper modellens enheder med den (trin D), POST
// /api/tilbud/enheder bruger den, så "m2" ikke bliver en ny enhed ved siden af
// "m²", og spor 2's måling skal læse den herfra i stedet for at have sin egen
// (kontrakt §5: "én liste i koden, som målingen også bruger").
//
// Grundlisten står OGSÅ i migrationen tilbud_fase5 (enheder med firm_id null).
// Ret begge steder. "t" er bevidst ikke med (time eller ton). Listen udvides
// efter den første måned med håndværkere (byggeplanens #11).
//
// Sammenligning (kontrakt §5): uden hensyn til store/små bogstaver, punktum og
// mellemrum. Det er STÆRKERE end databasens navn_norm (små bogstaver, mellemrum
// samlet, punktum bevaret) — derfor slår koden altid op her, før den opretter.

"use strict";

const GRUNDLISTE = ["stk.", "m", "cm", "m²", "m³", "kg", "timer", "dag", "sæt"];

const SYNONYMER = {
  "m²":    ["m2", "kvm", "kvadratmeter", "kvadratmetre"],
  "m":     ["meter", "lbm", "løbende meter", "lb. m"],
  "m³":    ["m3", "kubikmeter"],
  "cm":    ["centimeter"],
  "stk.":  ["stk", "styk", "styks", "stykker"],
  "kg":    ["kilo", "kilogram"],
  "timer": ["time", "timer", "tim."],
  "dag":   ["dage", "dag"],
  "sæt":   ["sæt"],
};

// "Lb. m" -> "lbm", " M² " -> "m²".
function noegle(navn) {
  return String(navn == null ? "" : navn).normalize("NFC").toLowerCase().replace(/[.\s]+/g, "");
}

const TIL_GRUND = new Map();
for (const g of GRUNDLISTE) {
  TIL_GRUND.set(noegle(g), g);
  for (const s of SYNONYMER[g] || []) TIL_GRUND.set(noegle(s), g);
}

// Grundlistens navn for en enhed eller et synonym — ellers null.
function grundnavn(navn) {
  return TIL_GRUND.get(noegle(navn)) || null;
}

module.exports = { GRUNDLISTE, SYNONYMER, noegle, grundnavn };
