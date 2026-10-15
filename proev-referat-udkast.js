// proev-referat-udkast.js -- proever skive 2 (Fase 2 F, 15/10-26) uden
// browser, server eller database.
//
//   1. Formatet: klientens udkastSomTekst() -> serverens tilFelter() giver de
//      samme felter tilbage.
//   2. Teknik B maales paa felterne (navnereglen slaaet fra i overskriften),
//      ikke paa hele teksten som én fritekst.
//   3. POST /api/tilbud/referater/:id/udkast: saetter udkastet ÉN gang,
//      atomisk (filter paa ai_udkast IS NULL i samme kald), 409 ellers.
//   4. Ophavet ({ model, version }) bliver til ai_model/ai_prompt_version.
//   5. Klienten: lavUdkast/saetUdkast kalder de rigtige ruter.
//
// Proeven skal FEJLE mod udgaven foer skive 2 (40070f3) -- ellers beviser
// den ikke noget. Koeres fra repoets rod:
//
//   node proev-referat-udkast.js
//   node proev-referat-udkast.js <mappe-med-den-gamle-udgave>
//
// Den gamle mappe skal have samme struktur (routes/tilbud/data.js,
// tilbud/graenseflade.js). teknik-b.js tages altid fra repoets rod.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const ROD = __dirname;
const KILDE = process.argv[2] ? path.resolve(process.argv[2]) : ROD;

let ok = 0, fejl = 0;
function tjek(navn, betingelse, detalje) {
  if (betingelse) { ok++; console.log("  OK    " + navn); }
  else { fejl++; console.log("  FEJL  " + navn + (detalje !== undefined ? "  (" + detalje + ")" : "")); }
}

// ─── Klienten i en falsk browser ────────────────────────────────────────────
function klient(svar) {
  const kald = [];
  const ctx = {
    FormData: class { append() {} },
    fetch: async (sti, valg) => {
      const krop = valg.body === undefined ? undefined : JSON.parse(valg.body);
      kald.push({ metode: valg.method, sti, krop });
      const s = svar(valg.method, sti, krop) || { status: 200, data: { ok: true } };
      return { ok: s.status >= 200 && s.status < 300, status: s.status, json: async () => s.data };
    },
    Promise, JSON, Map, Set, Object, Array, Error, Math, Number, String, isFinite, Date,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(KILDE, "tilbud", "graenseflade.js"), "utf8"), ctx);
  return { G: ctx.Graenseflade, kald };
}

// ─── Serverens data.js med falsk app og falsk database ──────────────────────
function server(raekke, { opdateringGiverIntet = false } = {}) {
  const ruter = {};
  const app = {};
  for (const m of ["get", "post", "patch"]) {
    app[m] = (sti, h) => { ruter[m.toUpperCase() + " " + sti] = h; };
  }
  const log = { opdateringer: [], indsaettelser: [] };

  function bygger(tabel) {
    const b = { tabel, filtre: [], handling: null, vaerdi: null };
    const kaede = {
      select() { return kaede; },
      insert(v) { b.handling = "insert"; b.vaerdi = v; log.indsaettelser.push(b); return kaede; },
      update(v) { b.handling = "update"; b.vaerdi = v; log.opdateringer.push(b); return kaede; },
      eq(k, v) { b.filtre.push(["eq", k, v]); return kaede; },
      is(k, v) { b.filtre.push(["is", k, v]); return kaede; },
      order() { return kaede; },
      async maybeSingle() {
        if (b.handling === "update") {
          return { data: opdateringGiverIntet ? null : { id: raekke.id, status: "kladde" }, error: null };
        }
        if (tabel === "referater") return { data: raekke, error: null };
        return { data: { id: "op1" }, error: null };
      },
      async single() { return { data: { id: "ny1", status: "kladde" }, error: null }; },
    };
    return kaede;
  }
  const supabase = { from: bygger };

  // Kun de to eksterne afhaengigheder byttes ud; resten er repoets egne filer.
  const gammelLoad = Module._load;
  Module._load = function (id, parent, ...rest) {
    if (id === "@appsignal/nodejs") return { sendError() {} };
    if (id === "../../auth") return { firmIdFromToken: async () => "f1" };
    if (id === "../../ejerskab" || id === "../../teknik-b" || id === "../../referat-format") {
      return gammelLoad.call(this, path.join(ROD, id.replace("../../", "")), parent, ...rest);
    }
    return gammelLoad.call(this, id, parent, ...rest);
  };
  const fil = path.join(KILDE, "routes", "tilbud", "data.js");
  delete require.cache[fil];
  try { require(fil)(app, supabase); } finally { Module._load = gammelLoad; }
  return { ruter, log };
}

function svarObjekt() {
  const r = { kode: 200, krop: null };
  r.status = (k) => { r.kode = k; return r; };
  r.json = (j) => { r.krop = j; return r; };
  return r;
}

(async () => {
  // 1. Formatet, begge veje.
  try {
    const { G } = klient(() => null);
    let tilFelter = null;
    try { ({ tilFelter } = require(path.join(KILDE, "referat-format"))); } catch (_) { /* findes ikke */ }
    tjek("referat-format.js findes", typeof tilFelter === "function");
    tjek("udkastSomTekst findes", typeof G.udkastSomTekst === "function");
    const r = { overskrift: "Badeværelse hos Jensen", punkter: ["OSB-plader på loftet", "Membran 2 lag"], fritekst: "Vi aftalte at starte mandag." };
    const t = G.udkastSomTekst(r);
    tjek("formatet: overskrift, tom linje, punkter, tom linje, fritekst",
      t === "Badeværelse hos Jensen\n\n- OSB-plader på loftet\n- Membran 2 lag\n\nVi aftalte at starte mandag.", JSON.stringify(t));
    const tilbage = tilFelter(t);
    tjek("tilFelter: samme felter tilbage", JSON.stringify(tilbage) === JSON.stringify(r), JSON.stringify(tilbage));
    const udenPunkter = tilFelter(G.udkastSomTekst({ overskrift: "Kort", punkter: [], fritekst: "Bare tekst." }));
    tjek("tilFelter: uden punkter", udenPunkter.overskrift === "Kort" && udenPunkter.punkter.length === 0 && udenPunkter.fritekst === "Bare tekst.", JSON.stringify(udenPunkter));
    const haandskrevet = tilFelter("Bare en linje uden format\nog en til");
    tjek("tilFelter: tekst uden format bliver fritekst", haandskrevet.overskrift === "" && haandskrevet.fritekst.startsWith("Bare"), JSON.stringify(haandskrevet));
  } catch (e) { tjek("scenarie 1 koerte til ende", false, e.message); }

  // 2-4. Ruten for udkastet paa en gemt kladde.
  const transskript = "vi lagde osb plader paa loftet og membran i to lag";
  const udkast = "Badeværelse Jensen\n\n- OSB plader på loftet\n\nMembran i to lag.";
  try {
    const { ruter, log } = server({ id: "r1", transskript, ai_udkast: null });
    const h = ruter["POST /api/tilbud/referater/:id/udkast"];
    tjek("ruten POST /referater/:id/udkast findes", typeof h === "function");
    const res = svarObjekt();
    await h({ params: { id: "r1" }, body: { ai_udkast: udkast, indhold: "min version", ophav: { model: "m-1", version: "2026-10-02" } } }, res);
    tjek("tomt udkast: 200", res.kode === 200, res.kode + " " + JSON.stringify(res.krop));
    const u = log.opdateringer[0] || { filtre: [], vaerdi: {} };
    tjek("opdateringen filtrerer paa ai_udkast IS NULL i SAMME kald",
      u.filtre.some(([op, k, v]) => op === "is" && k === "ai_udkast" && v === null), JSON.stringify(u.filtre));
    tjek("opdateringen filtrerer paa firm_id",
      u.filtre.some(([op, k, v]) => op === "eq" && k === "firm_id" && v === "f1"));
    tjek("ophav -> ai_model", u.vaerdi.ai_model === "m-1", u.vaerdi.ai_model);
    tjek("ophav -> ai_prompt_version", u.vaerdi.ai_prompt_version === "2026-10-02", u.vaerdi.ai_prompt_version);
    tjek("indhold gemmes med", u.vaerdi.indhold === "min version");
    tjek("teknik B maalt (markeringer og ord er tal)",
      Number.isInteger(u.vaerdi.teknik_b_markeringer) && Number.isInteger(u.vaerdi.teknik_b_ord), JSON.stringify(u.vaerdi));
    // Overskriftens "Badeværelse" og "Jensen" staar ikke i transskriptet, men
    // navnereglen gaelder ikke i overskriften -> ingen markering derfra.
    // Maalt som én fritekst (foer skive 2) ville "Jensen" midt i teksten
    // vaere blevet markeret.
    const teknikB = require(path.join(ROD, "teknik-b"));
    const somFritekst = teknikB.marker(transskript, { overskrift: "", punkter: [], fritekst: udkast });
    tjek("teknik B: feltopdelt giver faerre markeringer end én fritekst (navneregel i overskrift)",
      u.vaerdi.teknik_b_markeringer < somFritekst.antalMarkeringer,
      u.vaerdi.teknik_b_markeringer + " mod " + somFritekst.antalMarkeringer);
  } catch (e) { tjek("scenarie 2 koerte til ende", false, e.message); }

  try {
    const { ruter, log } = server({ id: "r1", transskript, ai_udkast: "findes allerede" });
    const h = ruter["POST /api/tilbud/referater/:id/udkast"];
    const res = svarObjekt();
    if (h) await h({ params: { id: "r1" }, body: { ai_udkast: udkast } }, res);
    tjek("udkast findes: 409 udkast_findes", res.kode === 409 && res.krop && res.krop.error === "udkast_findes", res.kode);
    tjek("udkast findes: ingen opdatering forsoegt", log.opdateringer.length === 0, log.opdateringer.length);
  } catch (e) { tjek("scenarie 3 koerte til ende", false, e.message); }

  try {
    const { ruter } = server({ id: "r1", transskript, ai_udkast: null }, { opdateringGiverIntet: true });
    const h = ruter["POST /api/tilbud/referater/:id/udkast"];
    const res = svarObjekt();
    if (h) await h({ params: { id: "r1" }, body: { ai_udkast: udkast } }, res);
    tjek("kaploeb (en anden skaerm naaede det): 409", res.kode === 409, res.kode);
  } catch (e) { tjek("scenarie 4 koerte til ende", false, e.message); }

  try {
    const { ruter, log } = server({ id: "r1", transskript, ai_udkast: null });
    const h = ruter["POST /api/tilbud/referater/:id/udkast"];
    const res = svarObjekt();
    if (h) await h({ params: { id: "r1" }, body: { ai_udkast: udkast, transskript: "ny tekst" } }, res);
    tjek("transskript kan ikke sendes med: 400 ukendte_felter",
      res.kode === 400 && res.krop && res.krop.error === "ukendte_felter", res.kode + " " + JSON.stringify(res.krop));
    tjek("... og intet er skrevet", log.opdateringer.length === 0);
  } catch (e) { tjek("scenarie 5 koerte til ende", false, e.message); }

  try {
    const { ruter, log } = server({ id: "op1" });
    const h = ruter["POST /api/tilbud/referater"];
    const res = svarObjekt();
    await h({ body: { lead_id: "op1", transskript, ai_udkast: udkast, indhold: "x", ophav: { model: "m-1", version: "v" } } }, res);
    const ind = (log.indsaettelser.find((b) => b.tabel === "referater") || {}).vaerdi || {};
    tjek("nyt referat med udkast: ophav gemt", res.kode === 201 && ind.ai_model === "m-1" && ind.ai_prompt_version === "v",
      res.kode + " " + JSON.stringify(ind));
  } catch (e) { tjek("scenarie 6 koerte til ende", false, e.message); }

  // 5. Klienten.
  try {
    const { G, kald } = klient((m, sti) => {
      if (sti === "/api/tilbud/referat") return { status: 200, data: { ok: true, overskrift: "O", punkter: ["p"], fritekst: "f", markeringer: [], ventil: false, ophav: { model: "m", version: "v" } } };
      if (sti === "/api/tilbud/referater/r1/udkast") return { status: 200, data: { ok: true, referat: { id: "r1" } } };
      return null;
    });
    tjek("lavUdkast findes", typeof G.lavUdkast === "function");
    const s = await G.lavUdkast("  min tekst ");
    tjek("lavUdkast: POST /api/tilbud/referat med transskription",
      kald[0] && kald[0].sti === "/api/tilbud/referat" && kald[0].krop.transskription === "min tekst", JSON.stringify(kald[0]));
    await G.saetUdkast("r1", { aiUdkast: "U", indhold: "I", ophav: s.ophav });
    const k = kald[1] || {};
    tjek("saetUdkast: POST /referater/r1/udkast", k.metode === "POST" && k.sti === "/api/tilbud/referater/r1/udkast", k.sti);
    tjek("saetUdkast: ophav givet videre uaendret", k.krop && k.krop.ophav && k.krop.ophav.model === "m", JSON.stringify(k.krop));
  } catch (e) { tjek("scenarie 7 koerte til ende", false, e.message); }

  // S17 paa klientfilen.
  const g = fs.readFileSync(path.join(KILDE, "tilbud", "graenseflade.js"), "utf8");
  tjek("S17: graenseflade.js uden process.env, require( eller prompt", !/process\.env|require\(|prompt/.test(g));

  console.log("\n" + ok + "/" + fejl + "\n");
  process.exit(fejl ? 1 : 0);
})().catch((e) => { console.error("Proeven vaeltede:", e); process.exit(2); });
