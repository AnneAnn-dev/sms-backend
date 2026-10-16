// proev-ventetid.js -- proever tidsgraensen og faserne i tilbud/graenseflade.js
// (16/10-26). Maalt samme dag: to "Lav referat" naaede foerst serveren 3 og 10
// minutter efter trykket; fanen ventede uden tidsgraense.
//
//   1. Et kald, serveren aldrig svarer paa, afbrydes og giver tog_for_lang_tid
//      (i stedet for at haenge for evigt).
//   2. Faserne meldes i raekkefoelge: login -> server -> ''.
//   3. "Lav referat" og "Lav tekst" faar den lange graense (150 s), andre kald
//      den korte (60 s).
//
// Uret er speedet op 1000 gange, saa 150 s tager 150 ms.
//   node proev-ventetid.js [sti-til-graenseflade.js]
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const fil = process.argv[2] || path.join(__dirname, "tilbud", "graenseflade.js");
const kilde = fs.readFileSync(fil, "utf8");
let ok = 0, fejl = 0;
const tjek = (n, b, d) => { if (b) { ok++; console.log("  OK    " + n); } else { fejl++; console.log("  FEJL  " + n + (d !== undefined ? "  (" + d + ")" : "")); } };

function miljoe({ svarAldrig = false } = {}) {
  const faser = [];
  const ventetider = [];
  const ctx = {
    FormData: class { append() {} },
    AbortController,
    // Uret 1000 gange hurtigere; ventetiden huskes, saa graensen kan maales.
    setTimeout: (fn, ms) => { ventetider.push(ms); return setTimeout(fn, Math.max(1, ms / 1000)); },
    clearTimeout,
    fetch: (sti, valg) => new Promise((ok, nej) => {
      if (valg.signal) valg.signal.addEventListener("abort", () => { const e = new Error("afbrudt"); e.name = "AbortError"; nej(e); });
      if (!svarAldrig) ok({ ok: true, status: 200, json: async () => ({ ok: true, tekst: "t" }) });
    }),
    Promise, JSON, Map, Set, Object, Array, Error, Math, Number, String, isFinite, Date, isNaN,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(kilde, ctx, { filename: fil });
  const G = ctx.Graenseflade;
  if (G.saetFase) G.saetFase((f) => faser.push(f));
  return { G, faser, ventetider };
}

(async () => {
  try {
    const { G, faser } = miljoe();
    tjek("saetFase findes", typeof G.saetFase === "function");
    await G.hentKvote();
    tjek("faserne: login -> server -> ''", JSON.stringify(faser) === JSON.stringify(["login", "server", ""]), JSON.stringify(faser));
  } catch (e) { tjek("scenarie 1 koerte til ende", false, e.message); }

  try {
    const { G, faser } = miljoe({ svarAldrig: true });
    const start = Date.now();
    let afvist = null;
    const vagt = new Promise((_, nej) => setTimeout(() => nej(new Error("hang over 3 s")), 3000));
    try { await Promise.race([G.lavUdkast("noget tekst"), vagt]); } catch (e) { afvist = e; }
    tjek("server svarer aldrig: kaldet afbrydes (haenger ikke)", afvist && afvist.kode === "tog_for_lang_tid", afvist ? (afvist.kode || afvist.message) : "intet");
    tjek("... med en besked, han kan handle paa", afvist && /prøv igen/.test(afvist.message), afvist && afvist.message);
    tjek("... og fasen nulstilles", faser[faser.length - 1] === "", JSON.stringify(faser));
    tjek("... efter ca. 150 s (her 150 ms)", Date.now() - start >= 100 && Date.now() - start < 2000, Date.now() - start);
  } catch (e) { tjek("scenarie 2 koerte til ende", false, e.message); }

  try {
    const a = miljoe(); await a.G.lavUdkast("x");
    const b = miljoe(); await b.G.transskriber([{ blob: {}, filnavn: "d" }]);
    const c = miljoe(); await c.G.hentKvote();
    tjek("Lav referat: graense 150 s", a.ventetider.includes(150000), JSON.stringify(a.ventetider));
    tjek("Lav tekst: graense 150 s", b.ventetider.includes(150000), JSON.stringify(b.ventetider));
    tjek("andre kald: graense 60 s", c.ventetider.includes(60000), JSON.stringify(c.ventetider));
  } catch (e) { tjek("scenarie 3 koerte til ende", false, e.message); }

  tjek("S17: ingen process.env, require( eller prompt", !/process\.env|require\(|prompt/.test(kilde));
  console.log("\n" + ok + "/" + fejl + "\n");
  process.exit(fejl ? 1 : 0);
})();
