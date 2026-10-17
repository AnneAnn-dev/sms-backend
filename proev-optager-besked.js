// proev-optager-besked.js -- D85 (17/10-26): optagerens beskeder, naar en
// del kasseres eller afbrydes. Afgoerelsen sker paa de UAFRUNDEDE tal;
// beskederne har komma, ingen graense og aldrig "0" (Ann 17/10).
// Skal FEJLE mod udgaven foer (fravalgt-del).
//
//   node proev-optager-besked.js [sti-til-optager.js]
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
  async function del(sek, tab) {
    const m = miljoe(); const o = new m.Optager();
    m.env.tabSek = tab;
    await o.start(); await m.frem(sek * 1000);
    return await o.stop();
  }

  // 1. Kort del med lidt tab (som i UI-proeven: 2,2 s, 0,1 s).
  try {
    const s = await del(2.2, 0.1);
    tjek("2,2 s / 0,1 s tab: kasseres stadig", s.aarsag === "for_stort_tab", s.aarsag);
    tjek("... beskeden: for kort til at maale sikkert", s.forklaring === "Optagelsen er for kort til at måle sikkert. Prøv igen.", s.forklaring);
  } catch (e) { tjek("scenarie 1 koerte til ende", false, e.message); }

  // 2. Laengere del med tab: tal med komma, ingen graense.
  try {
    const s = await del(120, 3.4);
    tjek("120 s / 3,4 s tab: kasseres", s.aarsag === "for_stort_tab", s.aarsag);
    tjek("... 'Der mangler 3,4 sekunder lyd inde i optagelsen ...'",
      s.forklaring === "Der mangler 3,4 sekunder lyd inde i optagelsen, så den kan ikke bruges. Optag den igen.", s.forklaring);
    tjek("... ingen 'Grænsen er'", !/Grænsen er/.test(s.forklaring));
  } catch (e) { tjek("scenarie 2 koerte til ende", false, e.message); }

  // 3. Afgoerelsen paa uafrundede tal: 100 s, graense 2 s, tab 2,04 s.
  //    Afrundet er det 2,0 > 2,0 = nej; uafrundet 2,04 > 2 = ja.
  try {
    const s = await del(100, 2.04);
    tjek("100 s / 2,04 s tab: kasseres (uafrundet over graensen)", s.aarsag === "for_stort_tab", s.aarsag);
    const ok = await del(100, 1.96);
    tjek("100 s / 1,96 s tab: godkendt", ok.ok === true, ok.aarsag);
  } catch (e) { tjek("scenarie 3 koerte til ende", false, e.message); }

  // 4. Afbrudt men hel: ny ordlyd med opkald, komma.
  try {
    const m = miljoe(); const o = new m.Optager();
    await o.start(); await m.frem(30500);
    m.env.sidsteSpor.onmute(); await m.frem(0);
    const d = o.dele[0] || {};
    tjek("afbrudt: beskeden naevner opkald", /fx af et opkald/.test(d.forklaring || ""), d.forklaring);
    tjek("afbrudt: sekunder med komma (30,5)", /efter 30,5 sekunder/.test(d.forklaring || ""), d.forklaring);
  } catch (e) { tjek("scenarie 4 koerte til ende", false, e.message); }

  // 5. Ingen besked indeholder et decimaltal med punktum.
  try {
    const a = await del(2.2, 0.1), b = await del(120, 3.4);
    tjek("ingen '0.x' eller '3.4' i beskederne", ![a.forklaring, b.forklaring].some((t) => /\d\.\d/.test(t || "")));
  } catch (e) { tjek("scenarie 5 koerte til ende", false, e.message); }

  console.log("\n" + ok + "/" + fejl + "\n");
  process.exit(fejl ? 1 : 0);
})().catch(e => { console.error("Proeven vaeltede:", e); process.exit(2); });
