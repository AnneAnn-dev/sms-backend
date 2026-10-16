// proev-servergraense.js -- proever 20-minuttersgraensen paa serveren
// (Fase 2 F, Ann 16/10-26, margin 2 min). Laengden maales med transskriberingens egne
// lydsekunder, del for del:
//   - under 20 min + 2 min: 200 med teksten
//   - over: 413 optagelse_for_lang, ingen tekst, ingen flere dele sendt
//   - det, der ER transskriberet, bogfoeres altid
// Skal FEJLE mod udgaven foer.
//   node proev-servergraense.js [sti-til-routes/tilbud/index.js]
"use strict";
const path = require("path");
const Module = require("module");
const fil = path.resolve(process.argv[2] || path.join(__dirname, "routes", "tilbud", "index.js"));

let ok = 0, fejl = 0;
const tjek = (n, b, d) => { if (b) { ok++; console.log("  OK    " + n); } else { fejl++; console.log("  FEJL  " + n + (d !== undefined ? "  (" + d + ")" : "")); } };

let laengder = [], asrKald = 0, bogfoert = [];
const STUB = {
  // multer: delene laegges direkte paa req.files af proeven selv.
  multer: Object.assign(() => ({ array: () => (q, s, n) => n() }), { memoryStorage: () => ({}) }),
  "@appsignal/nodejs": { sendError() {} },
  "../../auth": { firmIdFromToken: async () => "f1" },
  "../../asr-adapter": {
    prisOere: (sek) => sek * 0.0374,
    transskriber: async () => { const l = laengder[asrKald++]; return { tekst: "del " + asrKald, lydsekunder: l, leverandoer: "x", model: "m" }; },
  },
  "../../tekst-adapter": { prisOere: () => 1 }, "../../teknik-b": {},
  "../../kvote": {
    tjek: async () => ({ tilladt: true, forbrugtOere: 0, loftOere: 1e9 }),
    bogfoer: async (r) => { bogfoert.push(r.maengde); },
    krydsedeVarsel: () => false, VARSEL_ANDEL: 0.8,
  },
  "./data": () => [],
};
const gammel = Module._load;
Module._load = function (id, parent, ...r) { return id in STUB ? STUB[id] : gammel.call(this, id, parent, ...r); };
const ruter = {};
const app = { use() {}, get() {}, patch() {}, post: (sti, ...h) => { ruter[sti] = h[h.length - 1]; } };
require(fil)(app, {});
Module._load = gammel;

function kald(sekunder) {
  laengder = sekunder; asrKald = 0; bogfoert = [];
  const dele = sekunder.map((_, i) => ({ size: 1000, buffer: Buffer.alloc(1), originalname: "d" + i + ".m4a" }));
  return new Promise((ok) => {
    const res = { kode: 200 };
    res.status = (k) => { res.kode = k; return res; };
    res.json = (j) => { res.krop = j; ok(res); return res; };
    const v = console.warn; console.warn = () => {};
    ruter["/api/tilbud/transskriber"]({ files: dele, get: () => undefined }, res);
    setTimeout(() => { console.warn = v; }, 50);
  });
}

(async () => {
  let r = await kald([600, 600]);
  tjek("20 min i to dele: 200 med tekst", r.kode === 200 && /del 1/.test(r.krop.tekst || ""), r.kode);
  r = await kald([600, 715]);
  tjek("20 min + 115 s (inden for marginen): 200", r.kode === 200, r.kode);
  r = await kald([600, 730]);
  tjek("20 min + 130 s: 413 optagelse_for_lang", r.kode === 413 && r.krop.error === "optagelse_for_lang", r.kode + " " + (r.krop && r.krop.error));
  tjek("... ingen tekst i svaret", r.krop && !("tekst" in r.krop), JSON.stringify(r.krop));
  tjek("... beskeden siger 20 minutter", r.krop && /højst være 20 minutter/.test(r.krop.besked || ""), r.krop && r.krop.besked);
  tjek("... begge transskriberede dele er bogfoert", bogfoert.length === 2 && bogfoert[1] === 730, JSON.stringify(bogfoert));
  r = await kald([1400, 60, 60]);
  tjek("for lang FOERSTE del: stop efter del 1", r.kode === 413 && asrKald === 1, r.kode + " / kald " + asrKald);
  tjek("... og del 1 er bogfoert", bogfoert.length === 1 && bogfoert[0] === 1400, JSON.stringify(bogfoert));
  r = await kald([700, 700, 60]);
  tjek("over efter del 2 af 3: del 3 sendes IKKE", r.kode === 413 && asrKald === 2, r.kode + " / kald " + asrKald);
  console.log("\n" + ok + "/" + fejl + "\n");
  process.exit(fejl ? 1 : 0);
})().catch((e) => { console.error("Proeven vaeltede:", e.message); process.exit(2); });
