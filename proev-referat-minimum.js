// proev-referat-minimum.js -- proever minimumslaengden foer "Lav referat"
// (Fase 2 F, besluttet af Ann 16/10-26: under 10 ord laves intet referat).
//   1. Serveren: under 10 ord -> 400 for_lidt_tekst, FOER kvoten (koster intet).
//      10 ord gaar videre til kvoten.
//   2. Klienten: lavUdkast afviser under 10 ord uden at kalde serveren.
//   3. Klient og server taeller ord ens.
// Skal FEJLE mod udgaven foer (login-maaling / ventetid).
//   node proev-referat-minimum.js [mappe-med-gammel-udgave]
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");
const KILDE = process.argv[2] ? path.resolve(process.argv[2]) : __dirname;

let ok = 0, fejl = 0;
const tjek = (n, b, d) => { if (b) { ok++; console.log("  OK    " + n); } else { fejl++; console.log("  FEJL  " + n + (d !== undefined ? "  (" + d + ")" : "")); } };

const NI = "Ring til Jensen om fliserne paa torsdag kl. 10";        // 9 ord
const TI = NI + " tak";                                              // 10 ord
const STOEJ = "oeh ... - , . ! oeh oeh oeh oeh oeh oeh oeh";          // 8 ord + tegn

// 1. Serveren
let kvoteKald = 0;
const STUB = {
  multer: Object.assign(() => ({ array: () => (q, s, n) => n() }), { memoryStorage: () => ({}) }),
  "@appsignal/nodejs": { sendError() {} },
  "../../auth": { firmIdFromToken: async () => "f1" },
  "../../asr-adapter": {}, "../../tekst-adapter": { prisOere: () => 1 }, "../../teknik-b": {},
  "../../kvote": { tjek: async () => { kvoteKald++; return { tilladt: false, aarsag: "stop_her", besked: "stop" }; } },
  "./data": () => [],
};
const gammel = Module._load;
Module._load = function (id, parent, ...r) { return id in STUB ? STUB[id] : gammel.call(this, id, parent, ...r); };
const ruter = {};
const app = { use() {}, get() {}, patch() {}, post: (sti, ...h) => { ruter[sti] = h[h.length - 1]; } };
require(path.join(KILDE, "routes", "tilbud", "index.js"))(app, {});
Module._load = gammel;

async function referat(tekst) {
  const res = { kode: 200, krop: null };
  res.status = (k) => { res.kode = k; return res; };
  res.json = (j) => { res.krop = j; return res; };
  const foer = kvoteKald;
  const v = console.warn; console.warn = () => {};
  try { await ruter["/api/tilbud/referat"]({ body: { transskription: tekst }, get: () => undefined }, res); } finally { console.warn = v; }
  return { kode: res.kode, fejl: res.krop && res.krop.error, besked: res.krop && res.krop.besked, kvote: kvoteKald - foer };
}

(async () => {
  const a = await referat(NI);
  tjek("server: 9 ord -> 400 for_lidt_tekst", a.kode === 400 && a.fejl === "for_lidt_tekst", a.kode + " " + a.fejl);
  tjek("server: 9 ord -> kvoten blev IKKE spurgt", a.kvote === 0, a.kvote);
  tjek("server: beskeden er Anns", a.besked === "Teksten er for kort til et referat. Du kan gemme den, som den er.", a.besked);
  const s = await referat(STOEJ);
  tjek("server: tegn uden bogstaver taeller ikke som ord", s.fejl === "for_lidt_tekst", s.fejl);
  const b = await referat(TI);
  tjek("server: 10 ord gaar videre til kvoten", b.kvote === 1 && b.fejl === "stop_her", b.kvote + " " + b.fejl);

  // 2. Klienten
  const kald = [];
  const ctx = { FormData: class { append() {} }, fetch: async (sti) => { kald.push(sti); return { ok: true, status: 200, json: async () => ({ ok: true }) }; },
    Promise, JSON, Map, Set, Object, Array, Error, Math, Number, String, isFinite, Date, isNaN, setTimeout, clearTimeout, AbortController };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(KILDE, "tilbud", "graenseflade.js"), "utf8"), ctx);
  const G = ctx.Graenseflade;
  let fanget = null;
  try { await G.lavUdkast(NI); } catch (e) { fanget = e; }
  tjek("klient: 9 ord -> for_lidt_tekst", fanget && fanget.kode === "for_lidt_tekst", fanget && fanget.kode);
  tjek("klient: 9 ord -> intet kald til serveren", kald.length === 0, kald.join(","));
  await G.lavUdkast(TI);
  tjek("klient: 10 ord -> kaldet sendes", kald.length === 1 && kald[0] === "/api/tilbud/referat", kald.join(","));

  // 3. Samme taelling
  const proever = ["", "   ", NI, TI, STOEJ, "æøå ÆØÅ blåbærgrød", "HPFI-relæet 2,5 m² 10:30", "a\nb\tc  d", "— – … ?"];
  const srv = (t) => String(t || "").split(/\s+/).filter((o) => /[\p{L}\p{N}]/u.test(o)).length;
  const ens = typeof G.antalOrd === "function" && proever.every((t) => G.antalOrd(t) === srv(t));
  tjek("klient og server taeller ord ens", ens, typeof G.antalOrd === "function" ? proever.map((t) => G.antalOrd(t) + "/" + srv(t)).join(" ") : "antalOrd mangler");
  tjek("klientens graense er 10", G.MIN_ORD_REFERAT === 10, G.MIN_ORD_REFERAT);
  const kildeSrv = fs.readFileSync(path.join(KILDE, "routes", "tilbud", "index.js"), "utf8");
  tjek("serverens regel staar som forventet (samme regex)", /const MIN_ORD_REFERAT = 10;/.test(kildeSrv) && kildeSrv.includes("/[\\p{L}\\p{N}]/u"));

  console.log("\n" + ok + "/" + fejl + "\n");
  process.exit(fejl ? 1 : 0);
})().catch((e) => { console.error("Proeven vaeltede:", e.message); process.exit(2); });
