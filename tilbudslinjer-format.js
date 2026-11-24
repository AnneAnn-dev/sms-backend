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
  indledning: 3000, citat: 200,
};

const FELTER = ["tilbud_titel", "opgave_titel", "indledning", "opgavetype", "maengde", "materialer", "uenige", "advarsel"];
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
// Tallene i en tekst, med punktum som decimaltegn ("4,35" og "4.35" er det samme tal).
const talI = (s) => (String(s == null ? "" : s).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => String(Number(n.replace(",", "."))));

/**
 * @param {string} raat  modellens rå svar
 * @param {object} data  det samme data, prompten blev bygget af (kontraktens afsnit 4)
 * @returns {{ok: true, obj: object, ordret: {ialt: number, ikke: number}, renset: {vaerdier: number, punkter: number}, noterRegel: {maengde: number, antal: number}, indledningTalIkke: string[]} | {ok: false, fejl: string[]}}
 *   `renset`: hvor mange tomme værdier og punkter med under to værdier, der blev fjernet fra uenige
 *   (Ann 22/11). Logges af ruten som tal; svaret afvises ikke for det.
 *   `indledningTalIkke`: tal i indledningen, der ikke står i nogen kilde (markeres for håndværkeren).
 *   `advarsel.ordret`: om advarslens citat står i den kilde, den henviser til.
 *   `noterRegel`: hvor mange gange mængden eller et antal blev sat til null, fordi noterne var med
 *   i uenigheden (Ann 22/11). Ved ok er det allerede gjort i `obj`.
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

  // Begge titler skal udfyldes (Ann 22/11; måledokumentets G1). null er en formfejl og giver retry.
  for (const t of ["tilbud_titel", "opgave_titel"]) {
    if (obj[t] === null || obj[t] === undefined) fejl.push(`${t} mangler`);
    else tekstfelt(obj[t], t, LOFT.titel, fejl);
  }

  // indledning (Ann 24/11): obligatorisk som titlerne.
  if (obj.indledning === null || obj.indledning === undefined) fejl.push("indledning mangler");
  else tekstfelt(obj.indledning, "indledning", LOFT.indledning, fejl);

  // advarsel (Ann 24/11): null eller {kilde, nr?, citat}. Kilden skal findes i input.
  const adv = obj.advarsel;
  if (adv !== null && adv !== undefined) {
    if (!erObj(adv)) fejl.push("advarsel er ikke et objekt");
    else {
      const tilladte = adv.kilde === "referat" ? ["kilde", "nr", "citat"] : ["kilde", "citat"];
      for (const k of ukendte(adv, tilladte)) fejl.push(`opfundet felt i advarsel: ${k}`);
      if (typeof adv.citat !== "string" || !adv.citat.trim()) fejl.push("advarsel.citat er tom");
      else if (adv.citat.length > LOFT.citat) fejl.push(`advarsel.citat for lang: ${adv.citat.length} tegn`);
      if (!["beskrivelse", "noter", "referat"].includes(adv.kilde)) fejl.push("advarsel.kilde er ukendt");
    }
  }

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

  if (erObj(adv)) {
    if (adv.kilde === "beskrivelse" && !beskrivelse.trim()) fejl.push("advarsel: der var ingen beskrivelse i input");
    if (adv.kilde === "noter" && !noter.trim()) fejl.push("advarsel: der var ingen noter i input");
    if (adv.kilde === "referat" && !refTekst.has(adv.nr)) fejl.push(`advarsel: referat nr ${JSON.stringify(adv.nr)} var ikke i input`);
  }

  // Tomme værdier i uenige fjernes, før formen tjekkes (Ann 22/11, efter runde 2): en kilde, der
  // intet siger om feltet, er ikke en del af uenigheden. Et punkt med under to værdier tilbage er
  // ingen uenighed og fjernes. Kun værdier, der er null eller tom tekst; alt andet tjekkes som før.
  const renset = { vaerdier: 0, punkter: 0 };
  if (Array.isArray(obj.uenige)) {
    obj.uenige = obj.uenige.filter((u) => {
      if (!erObj(u) || !Array.isArray(u.vaerdier)) return true;
      const foer = u.vaerdier.length;
      u.vaerdier = u.vaerdier.filter((v) => !(erObj(v) && (v.vaerdi === null || v.vaerdi === undefined || (typeof v.vaerdi === "string" && !v.vaerdi.trim()))));
      renset.vaerdier += foer - u.vaerdier.length;
      if (u.vaerdier.length < 2) { renset.punkter++; return false; }
      return true;
    });
  }

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
  // Noter-reglen (kontraktens regel for noter, Ann 22/11 efter runde 2): noterne har ingen dato, så
  // er de med i en uenighed, vælges ingen værdi. Modellen holdt ikke reglen (S2, runde 1 og 2), så
  // den håndhæves her: mængden eller linjens antal sættes til null. Uenigheden bliver stående.
  const noterRegel = { maengde: 0, antal: 0 };
  for (const u of ud.uenige) {
    if (!u.vaerdier.some((v) => v.kilde === "noter")) continue;
    if (u.felt === "maengde" && ud.maengde) { ud.maengde = null; noterRegel.maengde++; }
    const m = u.felt.match(/^materialer\[(\d+)\]$/);
    if (m && ud.materialer[Number(m[1])] && ud.materialer[Number(m[1])].antal !== null && ud.materialer[Number(m[1])].antal !== undefined) {
      ud.materialer[Number(m[1])] = { ...ud.materialer[Number(m[1])], antal: null }; noterRegel.antal++;
    }
  }
  // Advarslens citat: ordret i den kilde, den henviser til (markér, fjern ikke).
  if (erObj(ud.advarsel)) {
    const a = ud.advarsel;
    const kilde = a.kilde === "beskrivelse" ? beskrivelse : a.kilde === "noter" ? noter : refTekst.get(a.nr);
    ud.advarsel = { ...a, ordret: findesI(a.citat, kilde) };
  }

  // Tal-kontrol på indledningen (Ann 24/11, markér, fjern ikke): hvert tal skal stå i en kilde.
  const kildeTal = new Set(talI(alleKilder));
  const indledningTalIkke = [...new Set(talI(ud.indledning))].filter((n) => !kildeTal.has(n));

  return { ok: true, obj: ud, ordret: { ialt, ikke }, renset, noterRegel, indledningTalIkke };
}

module.exports = { laesSvar, LOFT, FELTER, _godtTal: godtTal, _findesI: findesI, _talI: talI };
