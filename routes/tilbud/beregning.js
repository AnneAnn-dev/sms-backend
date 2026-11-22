// routes/tilbud/beregning.js — tilbuddets ENE regnefunktion (byggeplanens #14, B1).
//
// "Ingen fejl, heller ikke en øre." Alle tal på tilbuddet regnes her, i hele
// øre og uden kommatal: JavaScript kan ikke gemme 18,525 præcist og runder den
// ned til 18,52, mens Postgres runder op til 18,53 (målt 20/11). Derfor:
//
//   - Penge er heltal i øre. Antal og mængde er tekst med højst 3 decimaler og
//     regnes som heltal i tusindedele. Procent og moms er tekst med højst 2
//     decimaler og regnes som heltal i hundrededele. Alt i BigInt.
//   - Halve øre runder VÆK FRA NUL — samme regel som Postgres' round() på
//     numeric. godkend_tilbud() regner det hele igen i databasen
//     (tilbud_genregn) og afviser, hvis ét tal afviger. To steder skal altså
//     give præcis det samme; proev-tilbud-beregning.js holder dem ens.
//
// Afrundingsreglen (#14, B1, Ann 21/11):
//   linje:   brutto = antal × enhedspris, afrundet til øre
//            rabat  = brutto × procent, afrundet for sig  — eller et beløb i øre
//            netto  = brutto − rabat   (så de viste tal altid går op)
//   tilbud:  før samlet rabat = summen af nettolinjerne
//            samlet rabat     = før × procent, afrundet — eller et beløb
//            ekskl. moms      = før − samlet rabat
//            moms             = ekskl. moms × momssats, afrundet ÉN gang
//            inkl. moms       = ekskl. moms + moms
//   En rabat må aldrig gøre en linje eller tilbuddet negativt.
//
// Ingen afhængigheder, ingen database, ingen I/O: kan prøves i CI.

"use strict";

const ANTAL_RE   = /^\d{1,9}(\.\d{1,3})?$/;   // højst 3 decimaler, punktum
const PROCENT_RE = /^\d{1,3}(\.\d{1,2})?$/;   // højst 2 decimaler, punktum
const LINJETYPER = ["arbejde", "materiale", "koersel", "andet"];

class Beregningsfejl extends Error {
  constructor(kode, besked, detalje) {
    super(besked);
    this.kode = kode;
    if (detalje) this.detalje = detalje;
  }
}

// "1.5" -> 1500n (tusindedele). null/undefined -> null.
function tilTusindedele(tekst, felt) {
  if (tekst === null || tekst === undefined) return null;
  const s = String(tekst);
  if (!ANTAL_RE.test(s)) throw new Beregningsfejl("ugyldigt_tal", `${felt}: højst 3 decimaler med punktum`, { felt });
  const [hel, dec = ""] = s.split(".");
  return BigInt(hel) * 1000n + BigInt((dec + "000").slice(0, 3));
}

// "10" / "12.5" -> 1000n / 1250n (hundrededele af en procent).
function tilHundrededele(tekst, felt) {
  const s = String(tekst);
  if (!PROCENT_RE.test(s)) throw new Beregningsfejl("ugyldig_procent", `${felt}: højst 2 decimaler med punktum`, { felt });
  const [hel, dec = ""] = s.split(".");
  const v = BigInt(hel) * 100n + BigInt((dec + "00").slice(0, 2));
  if (v > 10000n) throw new Beregningsfejl("ugyldig_procent", `${felt}: højst 100 %`, { felt });
  return v;
}

function tilOere(v, felt) {
  if (v === null || v === undefined) return null;
  if (!Number.isSafeInteger(v) || v < 0) throw new Beregningsfejl("ugyldigt_beloeb", `${felt}: heltal i øre, ≥ 0`, { felt });
  return BigInt(v);
}

// Heltalsdivision for ikke-negative tal med halve rundet væk fra nul.
function divRund(taeller, naevner) {
  if (taeller < 0n || naevner <= 0n) throw new Beregningsfejl("intern", "divRund: negativt tal");
  return (taeller * 2n + naevner) / (naevner * 2n);
}

function rabatOere(grundlag, rabat, felt) {
  if (!rabat || rabat.form === null || rabat.form === undefined) return 0n;
  if (rabat.form === "procent") return divRund(grundlag * tilHundrededele(rabat.procent, `${felt}.procent`), 10000n);
  if (rabat.form === "kroner") {
    const b = tilOere(rabat.beloeb_oere, `${felt}.beloeb_oere`);
    if (b === null) throw new Beregningsfejl("ugyldigt_beloeb", `${felt}.beloeb_oere mangler`, { felt });
    return b;
  }
  throw new Beregningsfejl("ugyldig_rabat", `${felt}.form skal være null, "procent" eller "kroner"`, { felt });
}

const tal = (b) => (b === null ? null : Number(b));

/**
 * Regner én linje. Returnerer { brutto_oere, rabat_oere, linje_sum_oere } som tal,
 * eller tre null'er, når antal eller pris mangler (linjen er så ikke færdig).
 */
function regnLinje(linje, nr = 0) {
  const felt = `linje ${nr}`;
  const antal = tilTusindedele(linje.antal, `${felt}.antal`);
  const pris = tilOere(linje.enhedspris_oere, `${felt}.enhedspris_oere`);
  if (antal === null || pris === null) return { brutto_oere: null, rabat_oere: null, linje_sum_oere: null };
  const brutto = divRund(antal * pris, 1000n);
  const rabat = rabatOere(brutto, linje.rabat, `${felt}.rabat`);
  if (rabat > brutto) throw new Beregningsfejl("rabat_negativ", `${felt}: rabatten er større end linjen`, { linje: nr });
  return { brutto_oere: tal(brutto), rabat_oere: tal(rabat), linje_sum_oere: tal(brutto - rabat) };
}

/** Kørselslinjens antal og pris ud fra tilbuddets kørsel (#5). null = ingen kørselslinje. */
function koerselsLinje(koersel) {
  if (!koersel || !koersel.form) return null;
  if (koersel.form === "km") return { type: "koersel", antal: koersel.km ?? null, enhedspris_oere: koersel.sats_oere ?? null };
  if (koersel.form === "fast") return { type: "koersel", antal: koersel.beloeb_oere == null ? null : "1", enhedspris_oere: koersel.beloeb_oere ?? null };
  throw new Beregningsfejl("ugyldig_koersel", 'koersel.form skal være null, "km" eller "fast"');
}

/**
 * Regner hele tilbuddet.
 *   tilbud: { moms_sats: "25.00", rabat: {form, procent, beloeb_oere} }
 *   linjer: [{ type, antal, enhedspris_oere, rabat }]  (kørselslinjen er en af dem)
 * Returnerer { linjer: [{brutto_oere, rabat_oere, linje_sum_oere}], summer: {...}, faerdig }
 * `faerdig` er false, hvis en linje mangler antal eller pris; summerne regnes
 * så kun af de færdige linjer (det er det, han ser undervejs).
 */
function regnTilbud(tilbud, linjer) {
  const moms = tilHundrededele(tilbud.moms_sats ?? "25.00", "moms_sats");
  const ud = [];
  const s = { arbejde: 0n, materiale: 0n, koersel: 0n, andet: 0n };
  let faerdig = true;
  (linjer || []).forEach((l, i) => {
    if (!LINJETYPER.includes(l.type)) throw new Beregningsfejl("ugyldig_type", `linje ${i}: ukendt type`, { linje: i });
    const r = regnLinje(l, i);
    ud.push(r);
    if (r.linje_sum_oere === null) { faerdig = false; return; }
    s[l.type] += BigInt(r.linje_sum_oere);
  });
  const foer = s.arbejde + s.materiale + s.koersel + s.andet;
  const samlet = rabatOere(foer, tilbud.rabat, "rabat");
  if (samlet > foer) throw new Beregningsfejl("rabat_negativ", "rabatten er større end tilbuddet");
  const ex = foer - samlet;
  const momsOere = divRund(ex * moms, 10000n);
  return {
    linjer: ud,
    faerdig: faerdig && ud.length > 0,
    summer: {
      arbejde_oere: tal(s.arbejde), materialer_oere: tal(s.materiale), koersel_oere: tal(s.koersel), andet_oere: tal(s.andet),
      foer_samlet_rabat_oere: tal(foer), samlet_rabat_oere: tal(samlet),
      ex_moms_oere: tal(ex), moms_oere: tal(momsOere), inkl_moms_oere: tal(ex + momsOere),
    },
  };
}

/**
 * Mængde ud fra målene (B3, Ann 21/11): faktorerne ganges, og resultatet
 * afrundes til 3 decimaler (halve væk fra nul). ["4.35","6.2"] -> "26.970".
 * Returnerer { vaerdi: "26.97", regnestykke: "4,35 × 6,2 = 26,97" }.
 */
function maengdeFraFaktorer(faktorer) {
  if (!Array.isArray(faktorer) || faktorer.length < 1 || faktorer.length > 3) {
    throw new Beregningsfejl("ugyldige_faktorer", "1–3 faktorer");
  }
  const t = faktorer.map((f, i) => tilTusindedele(String(f), `faktorer[${i}]`));
  let p = t[0], skala = 1000n;
  for (const f of t.slice(1)) { p *= f; skala *= 1000n; }
  const milli = divRund(p * 1000n, skala);
  const vaerdi = fraTusindedele(milli);
  const vis = (x) => x.replace(".", ",");
  return { vaerdi, regnestykke: `${faktorer.map((f) => vis(fraTusindedele(tilTusindedele(String(f), "f")))).join(" × ")} = ${vis(vaerdi)}` };
}

// 26970n -> "26.97" (ingen overflødige nuller).
function fraTusindedele(m) {
  const hel = m / 1000n, rest = m % 1000n;
  if (rest === 0n) return hel.toString();
  return `${hel}.${rest.toString().padStart(3, "0").replace(/0+$/, "")}`;
}

module.exports = { regnLinje, regnTilbud, koerselsLinje, maengdeFraFaktorer, Beregningsfejl, LINJETYPER, ANTAL_RE, PROCENT_RE };
