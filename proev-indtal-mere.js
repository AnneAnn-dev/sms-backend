// proev-indtal-mere.js -- "Indtal mere" paa en kladde (Fase 2 F, Ann 17/10-26).
//   POST /api/tilbud/referater/:id/transskript
//   - kun en kladde UDEN udkast; begge filtre i SAMME opdatering
//   - udkast findes -> 409 tekst_laast, intet skrevet; faerdig -> 409 referat_faerdigt
//   - kapploeb (fik udkast imens) -> 409 tekst_laast
//   - titel kan komme med; andre felter afvises
//   - klienten: saetTransskript sender hele teksten og titlen
// Skal FEJLE mod udgaven foer. Koeres fra repoets rod:
//   node proev-indtal-mere.js [mappe-med-gammel-udgave]
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
    Promise, JSON, Map, Set, Object, Array, Error, Math, Number, String, isFinite, Date, isNaN,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(KILDE, "tilbud", "graenseflade.js"), "utf8"), ctx);
  return { G: ctx.Graenseflade, kald };
}

// raekke: den referat-raekke, enkeltopslag giver. liste: hvad listen giver.
function server({ raekke, liste = [], opdateringGiverIntet = false }) {
  const ruter = {};
  const app = {};
  for (const m of ["get", "post", "patch"]) app[m] = (sti, h) => { ruter[m.toUpperCase() + " " + sti] = h; };
  const log = { opdateringer: [], valg: [] };

  function bygger(tabel) {
    const b = { tabel, filtre: [], handling: "select", vaerdi: null, kolonner: "" };
    const resultatListe = () => ({ data: tabel === "referater" ? liste : [], error: null });
    const kaede = {
      select(k) { if (b.handling === "select") { b.kolonner = k || ""; log.valg.push(b); } return kaede; },
      insert(v) { b.handling = "insert"; b.vaerdi = v; return kaede; },
      update(v) { b.handling = "update"; b.vaerdi = v; log.opdateringer.push(b); return kaede; },
      eq(k, v) { b.filtre.push(["eq", k, v]); return kaede; },
      is(k, v) { b.filtre.push(["is", k, v]); return kaede; },
      order() { return kaede; },
      then(ok, nej) { return Promise.resolve(resultatListe()).then(ok, nej); },
      async maybeSingle() {
        if (b.handling === "update") {
          return { data: opdateringGiverIntet ? null : { id: raekke.id, status: (b.vaerdi.status || "kladde") }, error: null };
        }
        if (tabel === "referater") return { data: raekke, error: null };
        return { data: { id: "op1" }, error: null };
      },
      async single() { return { data: { id: "ny1" }, error: null }; },
    };
    return kaede;
  }

  const gammelLoad = Module._originalLoad || (Module._originalLoad = Module._load);
  Module._load = function (id, parent, ...rest) {
    if (id === "@appsignal/nodejs") return { sendError() {} };
    if (id === "../../auth") return { firmIdFromToken: async () => "f1" };
    if (id.startsWith("../../")) return gammelLoad.call(this, path.join(ROD, id.replace("../../", "")), parent, ...rest);
    return gammelLoad.call(this, id, parent, ...rest);
  };
  const fil = path.join(KILDE, "routes", "tilbud", "data.js");
  delete require.cache[fil];
  // Omdirigeringen bliver staaende: data.js henter teknik-b og referat-format
  // foerst, naar der maales, og de skal ogsaa findes, naar en gammel udgave
  // i en anden mappe proeves.
  require(fil)(app, { from: bygger });
  return { ruter, log };
}

function svarObjekt() {
  const r = { kode: 200, krop: null };
  r.status = (k) => { r.kode = k; return r; };
  r.json = (j) => { r.krop = j; return r; };
  return r;
}

(async () => {
  const STI = "POST /api/tilbud/referater/:id/transskript";
  const kald = async (ruter, body) => { const res = svarObjekt(); const h = ruter[STI];
    if (!h) return { kode: 404, krop: null }; await h({ params: { id: "r1" }, body }, res); return res; };

  // 1. Kladde uden udkast: 200, rigtige filtre og vaerdier.
  try {
    const { ruter, log } = server({ raekke: { id: "r1", status: "kladde", ai_udkast: null } });
    const res = await kald(ruter, { transskript: "  gammel tekst\n\nny tekst  ", titel: " Badet " });
    tjek("kladde uden udkast: 200", res.kode === 200, res.kode + " " + JSON.stringify(res.krop));
    const u = log.opdateringer[0] || { filtre: [], vaerdi: {} };
    tjek("filter status = kladde i SAMME opdatering", u.filtre.some(([op, k, v]) => op === "eq" && k === "status" && v === "kladde"), JSON.stringify(u.filtre));
    tjek("filter ai_udkast IS NULL i SAMME opdatering", u.filtre.some(([op, k, v]) => op === "is" && k === "ai_udkast" && v === null), JSON.stringify(u.filtre));
    tjek("firmafilteret er med", u.filtre.some(([op, k, v]) => op === "eq" && k === "firm_id" && v === "f1"));
    tjek("transskript og titel trimmet", u.vaerdi.transskript === "gammel tekst\n\nny tekst" && u.vaerdi.titel === "Badet", JSON.stringify(u.vaerdi));
  } catch (e) { tjek("scenarie 1 koerte til ende", false, e.message); }

  // 2. Udkast findes: 409 tekst_laast, intet skrevet.
  try {
    const { ruter, log } = server({ raekke: { id: "r1", status: "kladde", ai_udkast: "U" } });
    const res = await kald(ruter, { transskript: "x" });
    tjek("udkast findes: 409 tekst_laast", res.kode === 409 && res.krop && res.krop.error === "tekst_laast", res.kode + " " + JSON.stringify(res.krop));
    tjek("udkast findes: intet skrevet", log.opdateringer.length === 0);
  } catch (e) { tjek("scenarie 2 koerte til ende", false, e.message); }

  // 3. Faerdigt: 409 referat_faerdigt.
  try {
    const { ruter, log } = server({ raekke: { id: "r1", status: "faerdig", ai_udkast: null } });
    const res = await kald(ruter, { transskript: "x" });
    tjek("faerdigt: 409 referat_faerdigt", res.kode === 409 && res.krop && res.krop.error === "referat_faerdigt", res.kode);
    tjek("faerdigt: intet skrevet", log.opdateringer.length === 0);
  } catch (e) { tjek("scenarie 3 koerte til ende", false, e.message); }

  // 4. Kapploeb og afvisninger.
  try {
    const k = server({ raekke: { id: "r1", status: "kladde", ai_udkast: null }, opdateringGiverIntet: true });
    const res = await kald(k.ruter, { transskript: "x" });
    tjek("kapploeb (udkast imens): 409 tekst_laast", res.kode === 409 && res.krop && res.krop.error === "tekst_laast", res.kode);
    const t = server({ raekke: { id: "r1", status: "kladde", ai_udkast: null } });
    const tom = await kald(t.ruter, { transskript: "   " });
    tjek("tom tekst: 400 ingen_tekst", tom.kode === 400 && tom.krop && tom.krop.error === "ingen_tekst", tom.kode);
    const snyd = await kald(t.ruter, { transskript: "x", ai_udkast: "snyd" });
    tjek("ai_udkast kan ikke sendes med: 400", snyd.kode === 400, snyd.kode);
    tjek("afviste kald skrev intet", t.log.opdateringer.length === 0, t.log.opdateringer.length);
  } catch (e) { tjek("scenarie 4 koerte til ende", false, e.message); }

  // 5. Klienten.
  try {
    const { G, kald: k } = klient((m, sti) => sti === "/api/tilbud/referater/a/transskript" ? { status: 200, data: { ok: true, referat: { id: "a" } } } : null);
    tjek("saetTransskript findes", typeof G.saetTransskript === "function");
    await G.saetTransskript("a", { transskript: " gammel\n\nny ", titel: " Bad " });
    const p = k[0] || {};
    tjek("saetTransskript: POST /referater/a/transskript med tekst og titel",
      p.metode === "POST" && p.sti === "/api/tilbud/referater/a/transskript" && p.krop.transskript === "gammel\n\nny" && p.krop.titel === "Bad", JSON.stringify(p));
  } catch (e) { tjek("scenarie 5 koerte til ende", false, e.message); }

  const g = fs.readFileSync(path.join(KILDE, "tilbud", "graenseflade.js"), "utf8");
  tjek("S17: graenseflade.js uden process.env, require( eller prompt", !/process\.env|require\(|prompt/.test(g));
  console.log("\n" + ok + "/" + fejl + "\n");
  process.exit(fejl ? 1 : 0);
})().catch((e) => { console.error("Proeven vaeltede:", e); process.exit(2); });
