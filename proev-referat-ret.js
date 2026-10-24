// proev-referat-ret.js -- proever skive 3 (Fase 2 F, 15/10-26): ret og
// faerdig. "Kladde" = kan stadig rettes, "Faerdig" = laast (besluttet af Ann).
//
//   1. GET /api/tilbud/opgaver/:id giver `har_referat` pr. referat — og
//      sender IKKE teksterne med.
//   2. PATCH paa et faerdigt referat: 409 referat_faerdigt, intet skrevet.
//   3. PATCH paa en kladde: opdateringen filtrerer paa status = 'kladde' i
//      SAMME kald; nul raekker (blev faerdigt imens) giver 409.
//   4. Udkast-ruten afviser ogsaa et faerdigt referat.
//   5. Klienten: loadReferater giver harReferat og tid; retReferat sender de
//      rigtige felter.
//
// Skal FEJLE mod udgaven foer skive 3 (45cf440). Koeres fra repoets rod:
//
//   node proev-referat-ret.js
//   node proev-referat-ret.js <mappe-med-den-gamle-udgave>
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
  // 1. Listen.
  try {
    const { ruter } = server({
      raekke: { id: "op1" },
      liste: [
        { id: "a", titel: "Noter", status: "kladde", created_at: "2026-10-15T07:05:00Z", ai_udkast: null, indhold: null },
        { id: "b", titel: "Noter", status: "kladde", created_at: "2026-10-15T07:17:00Z", ai_udkast: "U", indhold: "I" },
        { id: "c", titel: "Noter", status: "faerdig", created_at: "2026-10-15T07:20:00Z", ai_udkast: null, indhold: "manuelt" },
      ],
    });
    const res = svarObjekt();
    await ruter["GET /api/tilbud/opgaver/:id"]({ params: { id: "op1" } }, res);
    const r = (res.krop && res.krop.referater) || [];
    tjek("liste: har_referat findes og er rigtig",
      r.length === 3 && r[0].har_referat === false && r[1].har_referat === true && r[2].har_referat === true,
      JSON.stringify(r.map((x) => x.har_referat)));
    tjek("liste: teksterne sendes IKKE med",
      r.every((x) => !("ai_udkast" in x) && !("indhold" in x) && !("transskript" in x)), JSON.stringify(r[1]));
  } catch (e) { tjek("scenarie 1 koerte til ende", false, e.message); }

  // 2. PATCH paa et faerdigt referat.
  try {
    const { ruter, log } = server({ raekke: { id: "r1", status: "faerdig" } });
    const res = svarObjekt();
    await ruter["PATCH /api/tilbud/referater/:id"]({ params: { id: "r1" }, body: { indhold: "ny" } }, res);
    tjek("faerdigt: PATCH giver 409 referat_faerdigt",
      res.kode === 409 && res.krop && res.krop.error === "referat_faerdigt", res.kode + " " + JSON.stringify(res.krop));
    tjek("faerdigt: intet skrevet", log.opdateringer.length === 0, log.opdateringer.length);
    const res2 = svarObjekt();
    await ruter["PATCH /api/tilbud/referater/:id"]({ params: { id: "r1" }, body: { status: "kladde" } }, res2);
    tjek("faerdigt: kan heller ikke saettes tilbage til kladde", res2.kode === 409, res2.kode);
  } catch (e) { tjek("scenarie 2 koerte til ende", false, e.message); }

  // 3. PATCH paa en kladde.
  try {
    const { ruter, log } = server({ raekke: { id: "r1", status: "kladde" } });
    const res = svarObjekt();
    await ruter["PATCH /api/tilbud/referater/:id"]({ params: { id: "r1" }, body: { titel: "Loft", indhold: "x", status: "faerdig" } }, res);
    tjek("kladde: PATCH 200", res.kode === 200, res.kode + " " + JSON.stringify(res.krop));
    const u = log.opdateringer[0] || { filtre: [], vaerdi: {} };
    tjek("kladde: opdateringen filtrerer paa status = 'kladde' i SAMME kald",
      u.filtre.some(([op, k, v]) => op === "eq" && k === "status" && v === "kladde"), JSON.stringify(u.filtre));
    tjek("kladde: firmafilteret er med", u.filtre.some(([op, k, v]) => op === "eq" && k === "firm_id" && v === "f1"));
    tjek("kladde: titel, indhold og status sendt", u.vaerdi.titel === "Loft" && u.vaerdi.indhold === "x" && u.vaerdi.status === "faerdig",
      JSON.stringify(u.vaerdi));

    const k = server({ raekke: { id: "r1", status: "kladde" }, opdateringGiverIntet: true });
    const res2 = svarObjekt();
    await k.ruter["PATCH /api/tilbud/referater/:id"]({ params: { id: "r1" }, body: { indhold: "y" } }, res2);
    tjek("kaploeb (blev faerdigt imens): 409", res2.kode === 409, res2.kode);
  } catch (e) { tjek("scenarie 3 koerte til ende", false, e.message); }

  // 4. Udkast-ruten paa et faerdigt referat.
  try {
    const { ruter, log } = server({ raekke: { id: "r1", status: "faerdig", transskript: "t", ai_udkast: null } });
    const res = svarObjekt();
    const h = ruter["POST /api/tilbud/referater/:id/udkast"];
    if (h) await h({ params: { id: "r1" }, body: { ai_udkast: "U" } }, res);
    tjek("udkast paa faerdigt: 409 referat_faerdigt", res.kode === 409 && res.krop && res.krop.error === "referat_faerdigt",
      res.kode + " " + JSON.stringify(res.krop));
    tjek("udkast paa faerdigt: intet skrevet", log.opdateringer.length === 0);
  } catch (e) { tjek("scenarie 4 koerte til ende", false, e.message); }

  // 5. Klienten.
  try {
    const { G, kald } = klient((m, sti) => {
      if (sti === "/api/tilbud/opgaver/op1") return { status: 200, data: { ok: true, referater: [
        { id: "a", titel: "Noter", status: "kladde", created_at: "2026-10-15T07:05:00Z", har_referat: true },
      ] } };
      if (m === "PATCH") return { status: 200, data: { ok: true, referat: { id: "a" } } };
      return null;
    });
    const l = await G.loadReferater("op1");
    tjek("loadReferater: harReferat", l[0] && l[0].harReferat === true, JSON.stringify(l[0]));
    tjek("loadReferater: tid som tt.mm", l[0] && /^\d\d\.\d\d$/.test(l[0].tid), l[0] && l[0].tid);
    tjek("retReferat findes", typeof G.retReferat === "function");
    await G.retReferat("a", { titel: " Loft ", indhold: "tekst", faerdig: true });
    const p = kald.find((k) => k.metode === "PATCH") || {};
    tjek("retReferat: PATCH /referater/a med titel, indhold, status faerdig",
      p.sti === "/api/tilbud/referater/a" && p.krop.titel === "Loft" && p.krop.indhold === "tekst" && p.krop.status === "faerdig",
      JSON.stringify(p));
    await G.retReferat("a", { indhold: "kun tekst" });
    const p2 = kald.filter((k) => k.metode === "PATCH")[1] || {};
    tjek("retReferat uden faerdig: ingen status i kroppen", p2.krop && !("status" in p2.krop), JSON.stringify(p2.krop));
  } catch (e) { tjek("scenarie 5 koerte til ende", false, e.message); }

  const g = fs.readFileSync(path.join(KILDE, "tilbud", "graenseflade.js"), "utf8");
  tjek("S17: graenseflade.js uden process.env, require( eller prompt", !/process\.env|require\(|prompt/.test(g));

  console.log("\n" + ok + "/" + fejl + "\n");
  process.exit(fejl ? 1 : 0);
})().catch((e) => { console.error("Proeven vaeltede:", e); process.exit(2); });
