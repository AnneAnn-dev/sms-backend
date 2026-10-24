// proev-login-maaling.js -- proever maalelinjen i routes/tilbud/index.js
// (16/10-26). Skal FEJLE mod udgaven uden maaling.
//   node proev-login-maaling.js [sti-til-routes/tilbud/index.js]
"use strict";
const path = require("path");
const Module = require("module");
const fil = path.resolve(process.argv[2] || path.join(__dirname, "routes", "tilbud", "index.js"));

let ok = 0, fejl = 0;
const tjek = (n, b, d) => { if (b) { ok++; console.log("  OK    " + n); } else { fejl++; console.log("  FEJL  " + n + (d !== undefined ? "  (" + d + ")" : "")); } };

// Kun stierne til modulets afhaengigheder byttes ud; selve filen er repoets.
const STUB = {
  multer: Object.assign(() => ({ array: () => (q, s, n) => n() }), { memoryStorage: () => ({}) }),
  "@appsignal/nodejs": { sendError() {} },
  "../../auth": { firmIdFromToken: async () => "f1" },
  "../../asr-adapter": {}, "../../tekst-adapter": {}, "../../teknik-b": {}, "../../kvote": {},
  "./data": () => [],
};
const gammel = Module._load;
Module._load = function (id, parent, ...r) { return id in STUB ? STUB[id] : gammel.call(this, id, parent, ...r); };

const brug = [];
const app = { use: (sti, h) => { if (typeof sti === "string") brug.push({ sti, h }); }, get() {}, post() {}, patch() {} };
require(fil)(app, {});
Module._load = gammel;

const maaler = brug.find((b) => b.sti === "/api/tilbud");
tjek("maaleren er monteret paa /api/tilbud", !!maaler);

function kald(headers, metode = "POST", sti = "/referat") {
  const linjer = [];
  const varsel = console.warn;
  console.warn = (...a) => linjer.push(a.join(" "));
  let videre = false;
  try {
    maaler.h({ method: metode, baseUrl: "/api/tilbud", path: sti, get: (n) => headers[n.toLowerCase()] }, {}, () => { videre = true; });
  } finally { console.warn = varsel; }
  return { linjer, videre };
}

if (maaler) {
  const hurtig = kald({ "x-login-ms": "120" });
  tjek("hurtigt login: ingen linje", hurtig.linjer.length === 0, JSON.stringify(hurtig.linjer));
  tjek("hurtigt login: kaldet gaar videre", hurtig.videre);
  const langsom = kald({ "x-login-ms": "4200" });
  tjek("login over 2 s: én linje med 'login-maaling' og tallet",
    langsom.linjer.length === 1 && /login-maaling/.test(langsom.linjer[0]) && /4200 ms/.test(langsom.linjer[0]), JSON.stringify(langsom.linjer));
  const omvej = kald({ "x-login-ms": "10004", "x-login-omvej": "tidsgraense" });
  tjek("omvej: linjen siger omvej (tidsgraense)", omvej.linjer.length === 1 && /omvej \(tidsgraense\)/.test(omvej.linjer[0]), JSON.stringify(omvej.linjer));
  tjek("linjen naevner metode og sti", /POST \/api\/tilbud\/referat/.test(omvej.linjer[0] || ""), omvej.linjer[0]);
  const ingen = kald({});
  tjek("uden headers (gammel fane): ingen linje, kaldet gaar videre", ingen.linjer.length === 0 && ingen.videre);
  const affald = kald({ "x-login-omvej": "x".repeat(500) });
  tjek("affald i headeren: linjen er kort", (affald.linjer[0] || "").length < 200, (affald.linjer[0] || "").length);
}
console.log("\n" + ok + "/" + fejl + "\n");
process.exit(fejl ? 1 : 0);
