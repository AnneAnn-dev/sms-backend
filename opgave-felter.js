// opgave-felter.js -- normalisering af felter paa en opgave, ét sted.
//
// Flyttet uaendret fra server.js 2/11-26 (D2, T3). Bruges af kundeformularen
// (formular-rute.js: adresse og overskrift) og af /opret-opgave i server.js
// (overskrift) og formularsiden (MAX_TITEL). Rene funktioner.
"use strict";

// ─── ADRESSE-NORMALISERING ──────────────────────────────────────────────────
// DAWA's forslagstekst slutter typisk allerede på "postnr by", og kan
// indeholde tomme segmenter (", ,") fra mellemtrins-forslag. Vi normaliserer
// derfor ALTID her (ét chokepoint), uanset hvad klienten sender: split på
// komma, trim, fjern tomme dele og dubletter, og sørg for at postnr+by står
// præcis én gang — bagerst. Resultat: "Gade 12[, Supplerende Bynavn], 1234 By".
function bygAdresse(vej, postnr, by) {
  const dele = String(vej || "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d, i, arr) => arr.indexOf(d) === i); // fjern dubletter
  const postnrBy = [postnr, by].map((v) => String(v || "").trim()).filter(Boolean).join(" ");
  if (!postnrBy) return dele.join(", ");
  const rest = dele.filter((d) => d !== postnrBy);
  return [...rest, postnrBy].join(", ");
}

// Overskriften paa en opgave (D88 trin 2, opgave 5). Valgfri: tom = null, saa
// gamle og nye opgaver uden overskrift ser ens ud. leads.titel findes siden
// 27/7 (kunder_og_opgavelag) — der er ingen ny kolonne.
const MAX_TITEL = 120;
function renTitel(v) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, MAX_TITEL) : null;
}

module.exports = { bygAdresse, renTitel, MAX_TITEL };
