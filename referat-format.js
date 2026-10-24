// referat-format.js — det faste tekstformat for et referatudkast (Fase 2 F,
// skive 2, 15/10-26).
//
// HVORFOR DEN FINDES
//
// Referatmodellen svarer STRUKTURERET: { overskrift, punkter[], fritekst }.
// `referater.ai_udkast` er én tekstkolonne. Udkastet skal derfor gemmes som
// tekst — men teknik B skal maales paa de SAMME felter, som /api/tilbud/referat
// maaler paa. Ellers betyder taetheden i databasen noget andet end den, han
// saa paa skaermen (D36 regel c: tallet skal kunne stoles paa efter tredive
// referater).
//
// Forskellen er ikke kosmetisk. Teknik B slaar navnereglen FRA i overskriften
// (besluttet 2/10 efter maaling). Maales udkastet som én fritekst, taeller
// overskriftens store bogstaver med som mulige navne, og taetheden stiger,
// uden at modellen har gjort noget andet.
//
// FORMATET (skrives af klienten, tilbud/graenseflade.js, udkastSomTekst):
//
//   <overskrift>
//   <tom linje>
//   - <punkt>
//   - <punkt>
//   <tom linje>
//   <fritekst>
//
// tilFelter() laeser det tilbage. Den er tolerant med vilje: et udkast, der
// ikke foelger formatet (fx skrevet i haanden), bliver til ren fritekst og
// maales som foer — det maa aldrig kunne forhindre, at et referat gemmes.

"use strict";

function tilFelter(tekst) {
  const linjer = String(tekst || "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < linjer.length && !linjer[i].trim()) i++;

  // Overskriften: foerste ikke-tomme linje, HVIS den efterfoelges af en tom
  // linje og ikke selv er et punkt. Ellers er der ingen overskrift.
  let overskrift = "";
  if (i < linjer.length && !/^\s*- /.test(linjer[i]) &&
      (i + 1 >= linjer.length || !linjer[i + 1].trim())) {
    overskrift = linjer[i].trim();
    i++;
  }

  const punkter = [];
  const resten = [];
  let iPunkter = false, efterPunkter = false;
  for (; i < linjer.length; i++) {
    const l = linjer[i];
    if (!efterPunkter && /^\s*- /.test(l)) {
      punkter.push(l.replace(/^\s*- /, "").trim());
      iPunkter = true;
      continue;
    }
    if (iPunkter && !l.trim()) { efterPunkter = true; continue; }
    if (iPunkter) efterPunkter = true;
    resten.push(l);
  }
  const fritekst = resten.join("\n").trim();
  return { overskrift, punkter: punkter.filter(Boolean), fritekst };
}

module.exports = { tilFelter };
