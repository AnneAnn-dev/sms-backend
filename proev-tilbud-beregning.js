// proev-tilbud-beregning.js — tilbuddets regnefunktion (byggeplanens #14, B1, B3).
//
//   node proev-tilbud-beregning.js
//
// Ingen database, ingen net, ingen nøgler: kører i CI (står i KOERES).
// Tilfældene er dem, byggeplanen og kontrakten navngiver. Funktionen er desuden
// krydstjekket 22/11 mod databasens egen genregning (tilbud_genregn i
// migrationen tilbud_fase5) på 500 tilfældige tilbud lokalt: 497 enige til
// øren, 3 afvist som negativ rabat, 0 uenige.

"use strict";

const { regnLinje, regnTilbud, koerselsLinje, maengdeFraFaktorer } = require("./routes/tilbud/beregning");

let ok = 0, ialt = 0;
function tjek(navn, faktisk, forventet) {
  ialt++;
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  if (a === b) { ok++; console.log(`  ✅ ${navn}`); }
  else console.log(`  ❌ ${navn}\n       fik      ${a}\n       ventede  ${b}`);
}
function fejler(navn, fn, kode) {
  ialt++;
  try { fn(); console.log(`  ❌ ${navn}: blev ikke afvist`); }
  catch (e) {
    if (e.kode === kode) { ok++; console.log(`  ✅ ${navn}: afvist (${kode})`); }
    else console.log(`  ❌ ${navn}: afvist med ${e.kode || e.message}, ventede ${kode}`);
  }
}

console.log("\nLinjen (#14, B1):");
tjek("1,5 × 12,35 = 18,525 → 18,53 (halve øre væk fra nul)",
  regnLinje({ antal: "1.5", enhedspris_oere: 1235 }), { brutto_oere: 1853, rabat_oere: 0, linje_sum_oere: 1853 });
tjek("10 % rabat på 18,53: rabat 1,85 for sig, netto 16,68 (ikke 16,67)",
  regnLinje({ antal: "1.5", enhedspris_oere: 1235, rabat: { form: "procent", procent: "10" } }),
  { brutto_oere: 1853, rabat_oere: 185, linje_sum_oere: 1668 });
tjek("kronerabat: 12 t × 475 kr. − 500 kr. = 5.200,00",
  regnLinje({ antal: "12", enhedspris_oere: 47500, rabat: { form: "kroner", beloeb_oere: 50000 } }),
  { brutto_oere: 570000, rabat_oere: 50000, linje_sum_oere: 520000 });
tjek("0,001 × 5 øre = 0,005 øre → 0", regnLinje({ antal: "0.001", enhedspris_oere: 5 }), { brutto_oere: 0, rabat_oere: 0, linje_sum_oere: 0 });
tjek("0,1 × 5 øre = 0,5 øre → 1 øre", regnLinje({ antal: "0.1", enhedspris_oere: 5 }), { brutto_oere: 1, rabat_oere: 0, linje_sum_oere: 1 });
tjek("antal mangler: linjen er ikke færdig", regnLinje({ antal: null, enhedspris_oere: 47500 }), { brutto_oere: null, rabat_oere: null, linje_sum_oere: null });
tjek("pris mangler: linjen er ikke færdig", regnLinje({ antal: "3", enhedspris_oere: null }), { brutto_oere: null, rabat_oere: null, linje_sum_oere: null });
fejler("rabat større end linjen", () => regnLinje({ antal: "1", enhedspris_oere: 30000, rabat: { form: "kroner", beloeb_oere: 50000 } }), "rabat_negativ");
fejler("antal med komma (\"1,5\")", () => regnLinje({ antal: "1,5", enhedspris_oere: 100 }), "ugyldigt_tal");
fejler("antal med 4 decimaler", () => regnLinje({ antal: "1.0001", enhedspris_oere: 100 }), "ugyldigt_tal");
fejler("pris som kommatal", () => regnLinje({ antal: "1", enhedspris_oere: 12.5 }), "ugyldigt_beloeb");
fejler("procent over 100", () => regnLinje({ antal: "1", enhedspris_oere: 100, rabat: { form: "procent", procent: "100.01" } }), "ugyldig_procent");

console.log("\nTilbuddet:");
{
  const r = regnTilbud({ moms_sats: "25.00" }, [
    { type: "andet", antal: "1", enhedspris_oere: 1002 },
    { type: "andet", antal: "1", enhedspris_oere: 1002 },
  ]);
  tjek("to linjer à 10,02: moms på summen 5,01 (ikke 5,02)", [r.summer.ex_moms_oere, r.summer.moms_oere, r.summer.inkl_moms_oere], [2004, 501, 2505]);
}
{
  // Eksemplet fra kontrakten §1: 12 t × 475 − 500 kr., 15.000 kr. materialer, 10 % samlet.
  const r = regnTilbud({ moms_sats: "25.00", rabat: { form: "procent", procent: "10" } }, [
    { type: "arbejde", antal: "12", enhedspris_oere: 47500, rabat: { form: "kroner", beloeb_oere: 50000 } },
    { type: "materiale", antal: "1", enhedspris_oere: 1500000 },
  ]);
  tjek("kontraktens eksempel: 22.725,00 kr. i alt", r.summer, {
    arbejde_oere: 520000, materialer_oere: 1500000, koersel_oere: 0, andet_oere: 0,
    foer_samlet_rabat_oere: 2020000, samlet_rabat_oere: 202000,
    ex_moms_oere: 1818000, moms_oere: 454500, inkl_moms_oere: 2272500,
  });
  tjek("færdigt, når alle linjer har antal og pris", r.faerdig, true);
}
{
  const r = regnTilbud({ moms_sats: "25.00" }, [
    { type: "arbejde", antal: null, enhedspris_oere: 47500 },
    { type: "materiale", antal: "2", enhedspris_oere: 10000 },
  ]);
  tjek("en ufærdig linje: summer af de færdige, ikke færdigt", [r.summer.ex_moms_oere, r.faerdig], [20000, false]);
}
tjek("ingen linjer: ikke færdigt", regnTilbud({ moms_sats: "25.00" }, []).faerdig, false);
fejler("samlet kronerabat større end tilbuddet",
  () => regnTilbud({ moms_sats: "25.00", rabat: { form: "kroner", beloeb_oere: 100001 } }, [{ type: "andet", antal: "1", enhedspris_oere: 100000 }]), "rabat_negativ");
fejler("ukendt linjetype", () => regnTilbud({ moms_sats: "25.00" }, [{ type: "rabat", antal: "1", enhedspris_oere: 1 }]), "ugyldig_type");

console.log("\nKørsel (#5):");
tjek("km × sats: 18 km à 3,80 kr. = 68,40", regnLinje(koerselsLinje({ form: "km", km: "18", sats_oere: 380 })), { brutto_oere: 6840, rabat_oere: 0, linje_sum_oere: 6840 });
tjek("fast beløb: 250,00", regnLinje(koerselsLinje({ form: "fast", beloeb_oere: 25000 })), { brutto_oere: 25000, rabat_oere: 0, linje_sum_oere: 25000 });
tjek("ingen kørsel: ingen linje", koerselsLinje({ form: null }), null);

console.log("\nMængde ud fra mål (B3):");
tjek("4,35 × 6,2 = 26,97", maengdeFraFaktorer(["4.35", "6.2"]), { vaerdi: "26.97", regnestykke: "4,35 × 6,2 = 26,97" });
tjek("4 × 6 = 24", maengdeFraFaktorer([4, 6]).vaerdi, "24");
tjek("1,005 × 1,5 = 1,5075 → 1,508 (halve væk fra nul)", maengdeFraFaktorer(["1.005", "1.5"]).vaerdi, "1.508");
tjek("én faktor er mængden selv", maengdeFraFaktorer(["40"]).vaerdi, "40");
fejler("fire faktorer", () => maengdeFraFaktorer(["1", "2", "3", "4"]), "ugyldige_faktorer");

console.log(`\n${ok}/${ialt}`);
process.exit(ok === ialt ? 0 : 1);
