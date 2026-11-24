// proev-tilbud-forslag.js — tilbudsforslagets omsætning (Fase 5 trin D, routes/tilbud/forslag.js).
//
//   node proev-tilbud-forslag.js
//
// Ingen database, intet net, ingen nøgler: kører i CI (står i KOERES).
// Prøver det, kontrakten (§4, §5) lægger på serveren: tal til tekst, mængden
// ganget, enheder slået op i spor 2's tilbudslinjer-enheder.js, opgavetypen
// matchet mod firmaets typer, uenige om materialer flyttet ned på linjen, og
// at intet gættes (et antal, der ikke kan stå i databasen, bliver tomt).

"use strict";

const F = require("./routes/tilbud/forslag");

let ok = 0, ialt = 0;
function tjek(navn, faktisk, forventet) {
  ialt++;
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  if (a === b) { ok++; console.log(`  ✅ ${navn}`); }
  else console.log(`  ❌ ${navn}\n       fik      ${a}\n       ventede  ${b}`);
}

console.log("\nTal til tekst (§0):");
tjek("95 -> \"95\"", F.talTekst(95), "95");
tjek("1.5 -> \"1.5\"", F.talTekst(1.5), "1.5");
tjek("0.1 + 0.2 -> \"0.3\" (ingen kommatalsfejl)", F.talTekst(0.1 + 0.2), "0.3");
tjek("42.125 bevares", F.talTekst(42.125), "42.125");
tjek("for stort til numeric(12,3) -> null (han skriver selv antallet)", F.talTekst(1e10), null);
tjek("negativt -> null", F.talTekst(-1), null);

console.log("\nHvor beskrivelsen kommer fra (§4, A14):");
tjek("ny_opgave -> haandvaerker", F.beskrivelseKilde("ny_opgave"), "haandvaerker");
tjek("tilbud -> haandvaerker", F.beskrivelseKilde("tilbud"), "haandvaerker");
tjek("kundeformular -> kundeformular", F.beskrivelseKilde("kundeformular"), "kundeformular");
tjek("ukendt -> kundeformular (utroværdig, S6)", F.beskrivelseKilde(null), "kundeformular");

console.log("\nData til prompten (§4):");
const { data, kilder } = F.bygData({
  lead: { task: "Terrasse 40 m²", notes: null, created_at: "2026-11-21T23:30:00Z", oprettet_via: "kundeformular" },
  referater: [
    { id: "r2", indhold: "Senere: 45 m²", moede_dato: "2026-11-18", kilde: "upload", created_at: "2026-11-18T12:00:00Z" },
    { id: "r1", indhold: "Først", moede_dato: "2026-11-18", kilde: "optagelse", created_at: "2026-11-18T09:00:00Z" },
    { id: "r0", indhold: "   ", moede_dato: "2026-11-17", kilde: "manuel", created_at: "2026-11-17T09:00:00Z" },
  ],
  typer: [{ navn: "Terrasse", enhed: "m²" }],
  enheder: ["stk.", "m²"],
});
tjek("beskrivelsens dato er dansk tid (23.30 UTC = næste dag)", data.beskrivelse_dato, "2026-11-22");
tjek("kundens tekst er markeret som kundeformular", data.beskrivelse_kilde, "kundeformular");
tjek("referater efter tidspunkt, nr fra 1, tomt referat ikke sendt", data.referater.map((r) => [r.nr, r.kilde]), [[1, "optagelse"], [2, "upload"]]);
tjek("kilderne husker referatets id og nr", kilder.map((k) => [k.id, k.nr]), [["r1", 1], ["r2", 2]]);
tjek("noter uden indhold er tom tekst", data.noter, "");
tjek("tegn i alt", F.inputTegn(data), "Terrasse 40 m²".length + "Først".length + "Senere: 45 m²".length);

console.log("\nOmsætningen af et godkendt svar (§5):");
const grund = [{ id: "g-m2", navn: "m²" }, { id: "g-m", navn: "m" }, { id: "g-stk", navn: "stk." }];
const egne = [{ id: "e-pk", navn: "pakker" }];
const typer = [{ id: "t-ter", navn: "Terrasse", enhed: "m²" }, { id: "t-ter-m", navn: "Terrasse", enhed: "m" }];
const log = { model: "m", prompt_version: "v", retry: false, svartid_ms: 1, tokens_ind: 1, tokens_ud: 1 };
const obj = {
  tilbud_titel: " Ny terrasse ", opgave_titel: "Ny terrasse",
  opgavetype: { navn: " terrasse ", enhed: "kvm" },
  maengde: { faktorer: [4.35, 6.2], enhed: "m2" },
  materialer: [
    { beskrivelse: "Brædder", antal: 95, enhed: "løbende meter", ordret: true },
    { beskrivelse: "Skruer", antal: 3, enhed: "Pakker.", ordret: true },
    { beskrivelse: "Folie", antal: 1, enhed: "ruller", ordret: false },
    { beskrivelse: "Sand", antal: null, enhed: null, ordret: true },
  ],
  uenige: [
    { felt: "maengde", vaerdier: [{ kilde: "beskrivelse", vaerdi: "40 m²" }, { kilde: "referat", nr: 2, vaerdi: "45 m²" }] },
    { felt: "materialer[1]", vaerdier: [{ kilde: "noter", vaerdi: "2 pakker" }, { kilde: "referat", nr: 1, vaerdi: "3 pakker" }] },
  ],
};
const n = F.normaliser({ obj, data, kilder, typer, egne, grund, log });
tjek("titler trimmet", [n.titel, n.opgave_titel], ["Ny terrasse", "Ny terrasse"]);
tjek("' terrasse ' i kvm er firmaets Terrasse i m² (navn og enhed, #11)", n.opgavetype, { id: "t-ter", navn: "Terrasse", enhed: "m²" });
tjek("mængden ganget af serveren, faktorer som tekst (B3)", n.maengde, { vaerdi: "26.97", faktorer: ["4.35", "6.2"] });
tjek("'løbende meter' er grundlistens m med id", [n.linjer[0].enhed_id, n.linjer[0].enhed_navn, n.linjer[0].enhed_ny], ["g-m", "m", false]);
tjek("'Pakker.' er firmaets egen 'pakker'", [n.linjer[1].enhed_id, n.linjer[1].enhed_navn, n.linjer[1].enhed_ny], ["e-pk", "pakker", false]);
tjek("'ruller' er en ny enhed (oprettes først ved bekræftelse)", [n.linjer[2].enhed_id, n.linjer[2].enhed_navn, n.linjer[2].enhed_ny], [null, "ruller", true]);
tjek("ordret false bevares (markeret, ikke fjernet)", n.linjer[2].ordret, false);
tjek("intet gættet: Sand uden antal og enhed", [n.linjer[3].antal, n.linjer[3].enhed_navn], [null, null]);
tjek("uenige om materialer[1] står på linje 2", n.linjer[1].uenig, obj.uenige[1].vaerdier);
tjek("uenige om mængden bliver på tilbuddet", n.uenige.map((u) => u.felt), ["maengde"]);
tjek("kilderne til tilbud_kilder", n.kilder.referater.map((k) => [k.referat_id, k.nr, k.kilde]), [["r1", 1, "optagelse"], ["r2", 2, "upload"]]);
tjek("loggen bærer det validerede svar", n.log.svar === obj && n.log.model === "m", true);

console.log("\nKanttilfælde:");
const n2 = F.normaliser({ obj: { ...obj, opgavetype: { navn: "Terrasse", enhed: "m²" }, maengde: { faktorer: [10, 2], enhed: "m" } }, data, kilder, typer, egne, grund, log });
tjek("mængdens enhed (m) passer ikke til typens (m²): mængden står uden type (A9)", [n2.opgavetype, n2.maengde && n2.maengde.vaerdi], [null, "20"]);
const n3 = F.normaliser({ obj: { ...obj, opgavetype: { navn: "Altan", enhed: "stk" }, maengde: null }, data, kilder, typer, egne, grund, log });
tjek("ukendt type: ny, med grundlistens enhed", n3.opgavetype, { id: null, navn: "Altan", enhed: "stk." });
const n4 = F.normaliser({ obj: { ...obj, opgavetype: { navn: "Terrasse", enhed: null } }, data, kilder, typer, egne, grund, log });
tjek("type uden enhed og to typer med navnet: ingen gætning, ny type uden enhed", n4.opgavetype, { id: null, navn: "Terrasse", enhed: null });
const n5 = F.normaliser({ obj: { ...obj, maengde: { faktorer: [1e10], enhed: "m²" } }, data, kilder, typer, egne, grund, log });
tjek("en faktor, der ikke kan stå i databasen: ingen mængde", n5.maengde, null);
const n6 = F.normaliser({ obj: { ...obj, materialer: [{ beskrivelse: "x", antal: 1e10, enhed: "stk" }] }, data, kilder, typer, egne, grund, log });
tjek("et antal, der ikke kan stå i databasen: tomt", n6.linjer[0].antal, null);

console.log(`\n${ok}/${ialt}`);
process.exit(ok === ialt ? 0 : 1);
