// proev-optager-fravalg.js -- en afbrudt del, han siger NEJ til, taeller ikke
// mod de 20 minutter (Fase 2 F, 16/10-26). Foer talte den med, saa graensen
// kom for tidligt. Samme falske ur og optager som proev-optager.js.
// Skal FEJLE mod udgaven foer (9646c8c).
//
//   node proev-optager-fravalg.js [sti-til-optager.js]
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const fil = process.argv[2] || path.join(__dirname, "tilbud", "optager.js");
const kilde = fs.readFileSync(fil, "utf8");

let ok = 0, fejl = 0;
function tjek(navn, betingelse, detalje) {
  if (betingelse) { ok++; console.log("  OK    " + navn); }
  else { fejl++; console.log("  FEJL  " + navn + (detalje !== undefined ? "  (" + detalje + ")" : "")); }
}

// Et nyt, rent miljoe pr. scenarie: eget ur, egne timere, eget modul.
function miljoe() {
  let nu = 1_000_000;
  let timere = [];
  let naesteId = 1;
  const env = { tabSek: 0, sidsteSpor: null, muted: false, recorderStartet: 0 };

  class FalskBlob {
    constructor(dele, valg) {
      this.dele = dele || [];
      this.type = (valg && valg.type) || (this.dele[0] && this.dele[0].type) || "";
      this.size = this.dele.reduce((s, d) => s + (d.size || 0), 0);
      this.dur = this.dele.reduce((s, d) => s + (d.dur || 0), 0);
    }
    arrayBuffer() { return Promise.resolve({ dur: this.dur }); }
  }
  class FalskOptager {
    constructor() { this.mimeType = ""; }
    start() { this._fra = nu; env.recorderStartet++; }
    stop() {
      const sek = Math.max(0, (nu - this._fra) / 1000 - env.tabSek);
      const b = new FalskBlob([]); b.type = "audio/mp4"; b.size = 1000; b.dur = sek;
      this.ondataavailable({ data: b });
      Promise.resolve().then(() => this.onstop());
    }
  }
  class FalskAC {
    decodeAudioData(buf, ok) { ok({ duration: buf.dur }); }
    close() {}
  }
  const strom = () => {
    const spor = { muted: env.muted, stoppet: false, stop() { this.stoppet = true; } };
    env.sidsteSpor = spor;
    return { getAudioTracks: () => [spor], getTracks: () => [spor] };
  };

  const ctx = {
    navigator: { mediaDevices: { getUserMedia: () => Promise.resolve(strom()) } },
    MediaRecorder: FalskOptager,
    Blob: FalskBlob,
    AudioContext: FalskAC,
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    Date: { now: () => nu },
    setTimeout: (fn, ms) => { const id = naesteId++; timere.push({ id, at: nu + (ms || 0), fn }); return id; },
    clearTimeout: (id) => { timere = timere.filter(t => t.id !== id); },
    Promise, Math, Number, Error, isFinite,
  };
  ctx.window = ctx;
  // Date bruges ogsaa som konstruktoer i filnavn(): giv den en rigtig dato.
  const RigtigDate = Date;
  ctx.Date = function () { return new RigtigDate(nu); };
  ctx.Date.now = () => nu;
  vm.createContext(ctx);
  vm.runInContext(kilde, ctx, { filename: fil });

  async function flush() { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); }
  async function frem(ms) {
    const maal = nu + ms;
    for (;;) {
      timere.sort((a, b) => a.at - b.at);
      const t = timere[0];
      if (!t || t.at > maal) break;
      timere.shift();
      nu = t.at;
      t.fn();
      await flush();
    }
    nu = maal;
    await flush();
  }
  return { Optager: ctx.Optager, frem, flush, env };
}

const MIN = 60 * 1000;

(async () => {
  console.log("\nProever " + fil + "\n");
  async function afbrudt(m, o, ms, fortsaet) {
    if (fortsaet) await o.fortsaet(); else await o.start();
    await m.frem(ms);
    m.env.sidsteSpor.onmute();
    await m.frem(0);
    return o.dele[o.dele.length - 1] || {};
  }

  // 1. Afbrudt efter 10 min: taeller, til han svarer; et nej frigiver tiden.
  try {
    const m = miljoe(); const o = new m.Optager();
    const d = await afbrudt(m, o, 10 * MIN);
    tjek("10 min, afbrudt men hel", d.aarsag === "afbrudt_men_hel" && d.kanBruges === true, d.aarsag);
    tjek("foer svar: delen taeller (600 s tilbage)", o.restSek() === 600, o.restSek());
    tjek("fravaelg() findes", typeof o.fravaelg === "function");
    tjek("fravaelg(1) lykkes", o.fravaelg(1) === true);
    tjek("efter nej: fuld tid igen (1200 s)", o.restSek() === 1200, o.restSek());
    const s = o.samlet();
    tjek("samlet: 0 brugbare, 1 kasseret", s.brugbare.length === 0 && s.antalKasserede === 1, s.brugbare.length + "/" + s.antalKasserede);
    tjek("samlet: brugtSek 0", s.brugtSek === 0, s.brugtSek);
  } catch (e) { tjek("scenarie 1 koerte til ende", false, e.message); }

  // 2. Efter nej kan han optage hele 20 min mere.
  try {
    const m = miljoe(); let kald = 0;
    const o = new m.Optager({ paaGraense: () => { kald++; } });
    await afbrudt(m, o, 10 * MIN);
    o.fravaelg(1);
    await o.fortsaet(); await m.frem(19 * MIN);
    tjek("del 2 optager stadig efter 19 min", o.tilstand === "optager", o.tilstand);
    await m.frem(1 * MIN);
    tjek("del 2 stopper ved 20 min (ikke 10)", o.tilstand === "faerdig" && kald === 1 && o.dele[1].vaegurSek === 1200,
         o.tilstand + " / " + (o.dele[1] && o.dele[1].vaegurSek));
  } catch (e) { tjek("scenarie 2 koerte til ende", false, e.message); }

  // 3. En godkendt del kan ikke fravaelges, og et ja aendrer intet.
  try {
    const m = miljoe(); const o = new m.Optager();
    await o.start(); await m.frem(5 * MIN); await o.stop();
    tjek("godkendt del: fravaelg() afvises", o.fravaelg(1) === false);
    tjek("godkendt del: taeller stadig (900 s)", o.restSek() === 900, o.restSek());
    tjek("ukendt del: fravaelg() afvises", o.fravaelg(7) === false);
  } catch (e) { tjek("scenarie 3 koerte til ende", false, e.message); }

  tjek("S17: ingen process.env, require( eller prompt", !/process\.env|require\(|prompt/.test(kilde));
  console.log("\n" + ok + "/" + fejl + "\n");
  process.exit(fejl ? 1 : 0);
})().catch(e => { console.error("Proeven vaeltede:", e); process.exit(2); });
