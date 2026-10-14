// proev-optager.js -- proever tilbud/optager.js uden browser og uden mikrofon.
//
// Falsk ur, falsk MediaRecorder og falsk afkodning, saa 20 minutter tager
// millisekunder. Proeven skal FEJLE mod spike-udgaven (02a1171), som ingen
// graense har -- ellers beviser den ikke noget.
//
//   node proev-optager.js [sti-til-optager.js]    (standard: tilbud/optager.js)
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

  // 1. Under graensen: opfoerer sig som foer.
  try {
    const m = miljoe(); const o = new m.Optager();
    await o.start(); await m.frem(1 * MIN);
    const s = await o.stop();
    tjek("1 min: godkendt", s.ok === true, s.aarsag);
    tjek("1 min: ikke stoppet ved graensen", !s.stoppetVedGraense);
  } catch (e) { tjek("scenarie 1 koerte til ende", false, e.message); }

  // 2. En del naar graensen.
  try {
    const m = miljoe(); let kald = 0;
    const o = new m.Optager({ paaGraense: () => { kald++; } });
    await o.start(); await m.frem(19 * MIN + 59 * 1000);
    tjek("19:59: optager stadig", o.tilstand === "optager", o.tilstand);
    await m.frem(1000);
    tjek("20:00: stoppet af sig selv", o.tilstand === "faerdig", o.tilstand);
    tjek("20:00: paaGraense kaldt een gang", kald === 1, kald);
    const s = o.dele[0] || {};
    tjek("20:00: delen er leveret", o.dele.length === 1, o.dele.length);
    tjek("20:00: godkendt som hel optagelse", s.ok === true, s.aarsag);
    tjek("20:00: stoppetVedGraense", s.stoppetVedGraense === true);
    tjek("20:00: vaegur 1200 s", s.vaegurSek === 1200, s.vaegurSek);
    tjek("20:00: brugeren spoerges ikke (ikke afbrudt)", s.afbrudt === false);
  } catch (e) { tjek("scenarie 2 koerte til ende", false, e.message); }

  // 3. Samlet paa tvaers af dele.
  try {
    const m = miljoe(); let kald = 0;
    const o = new m.Optager({ paaGraense: () => { kald++; } });
    await o.start(); await m.frem(15 * MIN); await o.stop();
    tjek("15 min brugt: 300 s tilbage", typeof o.restSek === "function" && o.restSek() === 300,
         typeof o.restSek === "function" ? o.restSek() : "ingen restSek");
    await o.fortsaet(); await m.frem(5 * MIN);
    tjek("del 2 stoppet ved 20:00 samlet", o.tilstand === "faerdig", o.tilstand);
    tjek("del 2 vaegur 300 s", o.dele[1] && o.dele[1].vaegurSek === 300, o.dele[1] && o.dele[1].vaegurSek);
    tjek("paaGraense kaldt een gang", kald === 1, kald);
    let afvist = null;
    try { await o.fortsaet(); } catch (e) { afvist = e; }
    tjek("fortsaet() afvist efter graensen", afvist && afvist.kode === "graense_naaet", afvist && (afvist.kode || afvist.message));
    tjek("dele uroerte efter afvisning", o.dele.length === 2, o.dele.length);
    await o.start();
    tjek("start() giver ny diktering med fuld tid", o.dele.length === 0 && o.restSek() === 1200, o.restSek && o.restSek());
    await o.stop();
  } catch (e) { tjek("scenarie 3 koerte til ende", false, e.message); }

  // 4. En kasseret del taeller ikke.
  try {
    const m = miljoe(); const o = new m.Optager();
    m.env.tabSek = 5;
    await o.start(); await m.frem(10 * MIN); const s = await o.stop();
    tjek("del med 5 s tab kasseres", s.aarsag === "for_stort_tab", s.aarsag);
    m.env.tabSek = 0;
    tjek("kasseret del taeller ikke mod graensen", typeof o.restSek === "function" && o.restSek() === 1200,
         typeof o.restSek === "function" ? o.restSek() : "ingen restSek");
  } catch (e) { tjek("scenarie 4 koerte til ende", false, e.message); }

  // 5. Vaern 1 er uaendret: mute giver afbrudt_men_hel, og delen taeller.
  try {
    const m = miljoe(); let afbrudt = 0;
    const o = new m.Optager({ paaAfbrydelse: () => { afbrudt++; } });
    await o.start(); await m.frem(30 * 1000);
    m.env.sidsteSpor.onmute();
    await m.frem(0);
    const s = o.dele[0] || {};
    tjek("mute: afbrudt_men_hel", s.aarsag === "afbrudt_men_hel", s.aarsag);
    tjek("mute: paaAfbrydelse kaldt", afbrudt === 1, afbrudt);
    tjek("mute: afbrudt del taeller (1170 s tilbage)", typeof o.restSek === "function" && o.restSek() === 1170,
         typeof o.restSek === "function" ? o.restSek() : "ingen restSek");
  } catch (e) { tjek("scenarie 5 koerte til ende", false, e.message); }

  // 6. Manuelt stop rydder graense-uret.
  try {
    const m = miljoe(); let kald = 0;
    const o = new m.Optager({ paaGraense: () => { kald++; } });
    await o.start(); await m.frem(1 * MIN); await o.stop();
    await m.frem(30 * MIN);
    tjek("intet graensekald efter manuelt stop", kald === 0, kald);
    tjek("stadig een del", o.dele.length === 1, o.dele.length);
  } catch (e) { tjek("scenarie 6 koerte til ende", false, e.message); }

  // 8. Muted fra start (telefonopkald, maalt 14/10): afvis, foer der optages.
  try {
    const m = miljoe(); const o = new m.Optager();
    m.env.muted = true;
    let afvist = null;
    try { await o.start(); } catch (e) { afvist = e; }
    tjek("muted spor: start() afvist", afvist && afvist.kode === "mikrofon_optaget", afvist ? (afvist.kode || afvist.message) : "ikke afvist");
    tjek("muted spor: optageren ikke startet", m.env.recorderStartet === 0, m.env.recorderStartet);
    tjek("muted spor: sporet lukket igen", m.env.sidsteSpor && m.env.sidsteSpor.stoppet === true);
    tjek("muted spor: tilstand ikke 'optager'", o.tilstand !== "optager", o.tilstand);
    m.env.muted = false;
    await o.start(); await m.frem(60 * 1000); const s = await o.stop();
    tjek("efter opkaldet: ny start virker", s.ok === true, s.aarsag);
  } catch (e) { tjek("scenarie 8 koerte til ende", false, e.message); }

  // 9. Muted under fortsaet(): de gemte dele roeres ikke.
  try {
    const m = miljoe(); const o = new m.Optager();
    await o.start(); await m.frem(60 * 1000); await o.stop();
    m.env.muted = true;
    let afvist = null;
    try { await o.fortsaet(); } catch (e) { afvist = e; }
    tjek("muted ved fortsaet(): afvist", afvist && afvist.kode === "mikrofon_optaget", afvist ? (afvist.kode || afvist.message) : "ikke afvist");
    tjek("muted ved fortsaet(): delen fra foer er der stadig", o.dele.length === 1, o.dele.length);
  } catch (e) { tjek("scenarie 9 koerte til ende", false, e.message); }

  // 7. S17: filen maa ligge i tilbud/.
  tjek("S17: ingen process.env, require( eller prompt", !/process\.env|require\(|prompt/.test(kilde));

  console.log("\n" + ok + "/" + fejl + "\n");
  process.exit(fejl ? 1 : 0);
})().catch(e => { console.error("Proeven vaeltede:", e); process.exit(2); });
