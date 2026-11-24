// routes/tilbud/forslag.js — tilbudsforslagets rene del (Fase 5 trin D).
//
// To funktioner uden database og net, så de kan prøves i CI
// (proev-tilbud-forslag.js):
//
//   bygData(...)       kontraktens §4-data til spor 2's bygTilbudslinjePrompt()
//                      og laesSvar() — samme objekt til begge.
//   normaliser(...)    et godkendt modelsvar (laesSvar ok) -> det, databasens
//                      tilbud_skriv_forslag() skriver.
//
// Omsætningen er SERVERENS (kontrakt §5, spor 2's tilbudslinjer-format.js):
//   - tal til tekst med højst tre decimaler (§0), aldrig via kommatal-afrunding
//   - mængdens faktorer ganges her (B3, beregning.js)
//   - enheden slås op i spor 2's tilbudslinjer-enheder.js: grundlisten og
//     synonymerne, så firmaets egne, ellers en ny enhed (`ny: true`, A9)
//   - opgavetypen matches mod firmaets typer på navn (uden hensyn til store/små
//     bogstaver og mellemrum) og enhed (#11: samme navn med en anden enhed er
//     en anden type)
//   - `uenige` om materialer flyttes ned på linjen (§2 `uenig`)
//
// Intet her logger tekst. Fejl bærer kun feltstier.

"use strict";

const { maengdeFraFaktorer } = require("./beregning");
const { findEnhed, noegle } = require("../../tilbudslinjer-enheder");

const MAKS_ANTAL_MILLI = 999999999999;   // numeric(12,3)
const TIDSZONE = "Europe/Copenhagen";

// JSON-tal (≥ 0, højst tre decimaler — laesSvar har tjekket formen) -> tekst.
// Regnes som heltal i tusindedele, så 0.1 + 0.2-fejl aldrig når tilbuddet.
// For stort til databasen -> null: han skriver selv antallet (intet gættes).
function talTekst(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  const milli = Math.round(n * 1000);
  if (milli > MAKS_ANTAL_MILLI) return null;
  const hel = Math.floor(milli / 1000), rest = milli % 1000;
  return rest === 0 ? String(hel) : `${hel}.${String(rest).padStart(3, "0").replace(/0+$/, "")}`;
}

const dato = (iso) => new Intl.DateTimeFormat("sv-SE", { timeZone: TIDSZONE }).format(new Date(iso));
const typeNorm = (s) => String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();

// Kontrakt §4 A14: ny_opgave og tilbud -> haandvaerker; ukendt -> kundeformular
// (kundens tekst behandles som utroværdig, når vi ikke ved bedre — S6).
function beskrivelseKilde(oprettetVia) {
  return oprettetVia === "ny_opgave" || oprettetVia === "tilbud" ? "haandvaerker" : "kundeformular";
}

/**
 * Kontraktens §4-data.
 *   lead:      { task, notes, created_at, oprettet_via }
 *   referater: [{ id, indhold, moede_dato, kilde, created_at }]  — opgavens valgte
 *   typer:     [{ navn, enhed }]   firmaets, mest brugte først (højst 50)
 *   enheder:   [string]            grundlisten + firmaets mest brugte (højst 30 egne)
 * Returnerer { data, kilder } — `kilder` er referaterne med nr i den rækkefølge,
 * de blev sendt (til tilbud_kilder). Et referat uden indhold sendes ikke.
 */
function bygData({ lead, referater, typer, enheder }) {
  const sendes = (referater || [])
    .filter((r) => typeof r.indhold === "string" && r.indhold.trim())
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
    .map((r, i) => ({ id: r.id, nr: i + 1, dato: String(r.moede_dato || dato(r.created_at)).slice(0, 10), kilde: r.kilde, tekst: r.indhold }));
  const beskrivelse = typeof lead.task === "string" ? lead.task : "";
  const noter = typeof lead.notes === "string" ? lead.notes : "";
  const data = {
    beskrivelse,
    beskrivelse_dato: dato(lead.created_at),
    beskrivelse_kilde: beskrivelseKilde(lead.oprettet_via),
    noter,
    referater: sendes.map((r) => ({ nr: r.nr, dato: r.dato, kilde: r.kilde, tekst: r.tekst })),
    firmaets_typer: (typer || []).slice(0, 50).map((t) => ({ navn: t.navn, enhed: t.enhed })),
    enheder: enheder || [],
  };
  return { data, kilder: sendes };
}

// Tegn i alt i input (kontrakt §7: loftet på input i alt).
function inputTegn(data) {
  return (data.beskrivelse || "").length + (data.noter || "").length +
    (data.referater || []).reduce((s, r) => s + (r.tekst || "").length, 0);
}

/**
 * Et godkendt svar (laesSvar(...).obj) -> p_forslag til tilbud_skriv_forslag().
 *   obj:        modelsvaret med ordret-markeringerne
 *   data:       samme data, prompten blev bygget af
 *   kilder:     fra bygData
 *   typer:      firmaets typer [{ id, navn, enhed_id, enhed }] (enhed = navnet)
 *   egne:       firmaets egne enheder [{ id, navn }]
 *   grund:      grundlistens rækker [{ id, navn }]
 *   log:        { model, prompt_version, retry, svartid_ms, tokens_ind, tokens_ud }
 */
function normaliser({ obj, data, kilder, typer, egne, grund, log }) {
  const grundId = new Map((grund || []).map((g) => [g.navn, g.id]));
  const slaaOp = (ord) => {
    const f = findEnhed(ord, egne || []);
    if (!f) return null;
    if (f.grundliste) return { id: grundId.get(f.navn) || null, navn: f.navn, ny: false };
    return { id: f.id || null, navn: f.navn, ny: !!f.ny };
  };
  const tekst = (v, maks) => (typeof v === "string" && v.trim() ? v.trim().slice(0, maks) : null);

  // Opgavetype: firmaets egen, hvis navn og enhed passer (#11); ellers ny.
  let opgavetype = null;
  const ot = obj.opgavetype;
  if (ot && typeof ot === "object" && tekst(ot.navn, 60)) {
    const enhed = slaaOp(ot.enhed);
    const sammeNavn = (typer || []).filter((t) => typeNorm(t.navn) === typeNorm(ot.navn));
    const fundet = enhed
      ? sammeNavn.find((t) => noegle(t.enhed) === noegle(enhed.navn))
      : (sammeNavn.length === 1 ? sammeNavn[0] : null);
    opgavetype = fundet
      ? { id: fundet.id, navn: fundet.navn, enhed: fundet.enhed }
      : { id: null, navn: tekst(ot.navn, 60), enhed: enhed ? enhed.navn : null };
  }

  // Mængden: mål fra kilden, ganget her (B3). Enheden er typens (A9): passer
  // modellens enhed ikke til typens, står mængden som forslag uden type.
  let maengde = null;
  const mg = obj.maengde;
  if (mg && typeof mg === "object" && Array.isArray(mg.faktorer) && mg.faktorer.length) {
    const faktorer = mg.faktorer.map(talTekst);
    if (faktorer.every((x) => x !== null)) {
      try {
        maengde = { vaerdi: maengdeFraFaktorer(faktorer).vaerdi, faktorer };
        const me = slaaOp(mg.enhed);
        if (opgavetype && me && opgavetype.enhed && noegle(me.navn) !== noegle(opgavetype.enhed)) opgavetype = null;
      } catch (_) { maengde = null; }   // for stort tal: han skriver mængden selv
    }
  }

  // Uenige: mængde og opgavetype bliver på tilbuddet; materialer[n] flytter ned på linjen.
  const uenige = [], linjeUenig = new Map();
  for (const u of Array.isArray(obj.uenige) ? obj.uenige : []) {
    const m = typeof u.felt === "string" ? u.felt.match(/^materialer\[(\d+)\]$/) : null;
    if (m) linjeUenig.set(Number(m[1]), u.vaerdier);
    else if (u.felt === "maengde" || u.felt === "opgavetype") uenige.push({ felt: u.felt, vaerdier: u.vaerdier });
  }

  const linjer = (Array.isArray(obj.materialer) ? obj.materialer : []).map((m, i) => {
    const e = slaaOp(m.enhed);
    return {
      beskrivelse: tekst(m.beskrivelse, 200),
      antal: m.antal === null || m.antal === undefined ? null : talTekst(m.antal),
      enhed_id: e && !e.ny ? e.id : null,
      enhed_navn: e ? e.navn : null,
      enhed_ny: !!(e && e.ny),
      ordret: m.ordret !== false,
      uenig: linjeUenig.has(i) ? linjeUenig.get(i) : null,
    };
  }).filter((l) => l.beskrivelse);

  return {
    titel: tekst(obj.tilbud_titel, 100),
    opgave_titel: tekst(obj.opgave_titel, 100),
    opgavetype,
    maengde,
    uenige,
    linjer,
    kilder: {
      beskrivelse_kopi: data.beskrivelse || null,
      noter_kopi: data.noter || null,
      referater: (kilder || []).map((k) => ({ referat_id: k.id, nr: k.nr, dato: k.dato, kilde: k.kilde, tekst_kopi: k.tekst })),
    },
    log: { ...log, svar: obj },
  };
}

module.exports = { bygData, normaliser, inputTegn, talTekst, beskrivelseKilde };
