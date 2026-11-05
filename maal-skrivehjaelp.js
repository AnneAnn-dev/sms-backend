// maal-skrivehjaelp.js — T1a-målingen til Skrivehjælp (Fase 4). IKKE en proev-*.js:
// den koster penge, kræver nøgle og netværk, og hører ikke til i CI.
//
//   node maal-skrivehjaelp.js --toer                       tørkørsel: ingen netværk, ingen omkostning
//   node --env-file=.env maal-skrivehjaelp.js              mod staging, standardmodellen
//   node --env-file=.env maal-skrivehjaelp.js --model mistral-medium-3.5-128b,llama-3.3-70b-instruct
//   node --env-file=.env maal-skrivehjaelp.js --kun opslag,kommentar --maks-oere 300
//   node --env-file=.env maal-skrivehjaelp.js --id injektion --gentag 10   (samme case 10 gange)
//   node --env-file=.env maal-skrivehjaelp.js --saet skrivehjaelp-saet-t1b-some.json --kun opslag,kommentar
//
// HVAD DEN MÅLER (form, pris og tid, aldrig kvalitet. Kvaliteten er Annes dom, T1b):
//   - pris pr. kald i øre, regnet af tekst-adapter.js' egen prisOere (ingen ny prisliste)
//   - svartid, og om modellen svarer i rigtig form (Svar: ### og noter. SoMe: præcis 2 forslag)
//   - flag til læsning: tal, der ikke stod i input, forbudte ord fra sættet, SMS over 450 tegn,
//     mail uden emne, ikke-dansk, en ræsonnerende model (tomt svar trods tokens)
//
// Bruger SAMME nøgle, adresse og leverandør som referatet (TILBUD_REFERAT_URL,
// SCW_GENAI_SECRET_KEY, TILBUD_REFERAT_LEVERANDOER), men vælger modellen selv. Modellen
// skal stå i tekst-adapter.js' prisliste, ellers stopper scriptet før første kald (fail-closed).
//
// Udskriver ALDRIG nøglen. Sættet er kunstigt, så resultatet må gerne indeholde teksterne.
// Resultatet skrives til claude-arbejdstrae\maalinger\skrivehjaelp\<tidsstempel>\.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const P = require("./prompts/skrivehjaelp");
const { PACKS } = require("./prompts/skrivehjaelp-pakker");

// ─── Argumenter ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const vaerdi = (n, std) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : std; };

const TOER = flag("--toer");
const LEVERANDOER = vaerdi("--leverandoer", "scaleway");
const MODELLER = vaerdi("--model", "mistral-medium-3.5-128b").split(",").map(s => s.trim()).filter(Boolean);
const KUN = vaerdi("--kun", "svar,opslag,kommentar").split(",").map(s => s.trim());
const MAKS_OERE = Number(vaerdi("--maks-oere", "1000"));
const ID_FILTER = vaerdi("--id", "") ? new RegExp(vaerdi("--id", "")) : null;
const GENTAG = Math.max(1, Number(vaerdi("--gentag", "1")) || 1);
const UD = vaerdi("--ud", path.join(os.homedir(), "claude-arbejdstrae", "maalinger", "skrivehjaelp",
  new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")));

// Faste kaldparametre. De står i resultatet, så en ny måling kan sammenlignes.
const PARAM = {
  svar:      { temperatur: 0.3, maksTokens: 800 },
  opslag:    { temperatur: 0.8, maksTokens: 1500 },
  kommentar: { temperatur: 0.5, maksTokens: 800 },
};

// ─── Sættet ──────────────────────────────────────────────────────────────────
const SAET_FIL = vaerdi("--saet", "skrivehjaelp-saet-t1a.json");
const SAET = JSON.parse(fs.readFileSync(path.join(__dirname, SAET_FIL), "utf8"));
const FIRMA = SAET.firma;
const FOERSTE_FAG = Object.fromEntries(Object.entries(PACKS).map(([k, p]) => [k, p.trades[0]]));

function udfyldteFelter(sit) {
  const f = {};
  for (const felt of sit.fields) {
    if (felt.id === "link") continue; // falder tilbage til firmaets link
    if (felt.type === "select") f[felt.id] = felt.options[0];
    else if (felt.placeholder) f[felt.id] = felt.placeholder.replace(/^Fx\s+/i, "");
  }
  return f;
}

function byggCases() {
  const cases = [];
  if (KUN.includes("svar")) {
    for (const [pk, pack] of Object.entries(PACKS)) {
      for (const [sid, sit] of Object.entries(pack.situations)) {
        const firma = { ...FIRMA, trade: FOERSTE_FAG[pk] };
        cases.push({ id: `svar-${pk}-${sid}-tom`, type: "svar", firma, maa_ikke: [],
          input: { situation: sid, felter: {}, kanal: "sms", tone: "venlig", besked: sit.example } });
        cases.push({ id: `svar-${pk}-${sid}-udfyldt`, type: "svar", firma, maa_ikke: [],
          input: { situation: sid, felter: udfyldteFelter(sit), kanal: sit.group === "klage" ? "mail" : "sms",
                   tone: sit.group === "klage" ? "imødekommende" : "venlig", besked: sit.example } });
      }
    }
    for (const c of SAET.svar_fjendtlige) {
      cases.push({ id: c.id, type: "svar", firma: { ...FIRMA, trade: c.trade }, maa_ikke: c.maa_ikke,
        input: { situation: c.situation, felter: c.felter || {}, kanal: c.kanal, tone: c.tone, besked: c.besked } });
    }
  }
  if (KUN.includes("opslag")) {
    for (const c of SAET.opslag) cases.push({ id: c.id, type: "opslag", firma: { ...FIRMA, trade: c.trade },
      maa_ikke: c.maa_ikke, tjek: c.tjek, input: { idea: c.idea, goal: c.goal, platform: c.platform } });
  }
  if (KUN.includes("kommentar")) {
    for (const c of SAET.kommentar) cases.push({ id: c.id, type: "kommentar", firma: { ...FIRMA, trade: c.trade },
      maa_ikke: c.maa_ikke, tjek: c.tjek, input: { comment: c.comment, raw: c.raw } });
  }
  const filtreret = ID_FILTER ? cases.filter(c => ID_FILTER.test(c.id)) : cases;
  if (GENTAG === 1) return filtreret;
  return filtreret.flatMap(c => Array.from({ length: GENTAG }, (_, n) => ({ ...c, id: `${c.id}#${n + 1}` })));
}

function byg(c) {
  if (c.type === "svar") return P.bygSvar(c.input, c.firma);
  if (c.type === "opslag") return P.bygOpslag(c.input, c.firma);
  return P.bygKommentar(c.input, c.firma);
}

// Al fri tekst fra brugeren eller kunden i et case. Må ALDRIG stå i systemfeltet (S6).
function friTekst(c) {
  const i = c.input;
  return [i.besked, i.andet, i.idea, i.comment, i.raw, c.firma.firm, c.firma.person,
    ...Object.values(i.felter || {})].filter(s => typeof s === "string" && s.trim().length >= 8);
}

// ─── Flag til læsning ────────────────────────────────────────────────────────
const tal = (s) => (String(s).match(/\d+(?:[.,]\d+)*/g) || []).map(x => x.replace(/[.,]/g, ""));
function flag_(c, prompt, tekster) {
  const fl = [];
  const kilde = new Set(tal(prompt.bruger + " " + prompt.system));
  for (const [i, t] of tekster.entries()) {
    const nye = [...new Set(tal(t).filter(n => !kilde.has(n)))];
    if (nye.length) fl.push(`forslag ${i + 1}: tal, der ikke stod i input: ${nye.join(", ")}`);
    for (const ord of c.maa_ikke) if (t.toLowerCase().includes(ord.toLowerCase())) fl.push(`forslag ${i + 1}: indeholder "${ord}"`);
    if (!/(\b(og|vi|du|det|der|ikke|med|til)\b|æ|ø|å)/i.test(t)) fl.push(`forslag ${i + 1}: ser ikke dansk ud`);
    if (c.type === "opslag") {
      const h = (t.match(/#[\wæøåÆØÅ]+/g) || []).length;
      if (h < 3 || h > 5) fl.push(`forslag ${i + 1}: ${h} hashtags (skal være 3-5)`);
    }
  }
  if (c.type === "svar") {
    const t = tekster[0] || "";
    // Måling 1 (06:16): uden fakta svarede modellen "Ja, det kan vi sagtens" og lovede dage og
    // priser. Grov fælde for den slags påstande, kun når håndværkeren intet har udfyldt.
    const ingenFakta = !Object.values(c.input.felter || {}).some(v => String(v || "").trim());
    const PAASTAND = /(^|[\s.!])((?<!hvis )ja[,.!]|det kan vi|med i prisen|er inkluderet|du behøver ikke|du skal ikke|vi kommer (mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|stadig))/i;
    if (ingenFakta && c.input.situation !== "ros" && PAASTAND.test(t)) fl.push("mulig påstand uden fakta: " + (t.match(PAASTAND)[0].trim()));
    // Måling 2: kendte fakta blev sat i parentes ("[fredag]", "[12 34 56 78]").
    const kendt = [...Object.values(c.input.felter || {}), c.firma.phone].filter(Boolean).map(v => String(v).toLowerCase());
    const iParentes = (t.match(/\[[^\]]+\]/g) || []).filter(p => { const x = p.slice(1, -1).toLowerCase().trim(); return x.length >= 3 && kendt.some(k => k.includes(x)); });
    if (iParentes.length) fl.push("kendt fakta i parentes: " + iParentes.join(" "));
    if (c.input.kanal === "sms" && [...t].length > 450) fl.push(`SMS på ${[...t].length} tegn (over 450)`);
    if (c.input.kanal === "mail" && !/^\s*Emne:/i.test(t)) fl.push("mail uden 'Emne:'");
  }
  return fl;
}

// ─── Kald ────────────────────────────────────────────────────────────────────
async function kald(konf, model, prompt, param) {
  const t0 = Date.now();
  const svar = await fetch(`${konf.url}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${konf.noegle}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, temperature: param.temperatur, max_tokens: param.maksTokens,
      messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.bruger }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  const ms = Date.now() - t0;
  if (!svar.ok) return { ms, httpFejl: svar.status };
  const raa = await svar.json();
  const valg = (raa.choices && raa.choices[0]) || {};
  return {
    ms,
    indhold: (valg.message && valg.message.content) || "",
    slut: valg.finish_reason || "",
    ind: (raa.usage && raa.usage.prompt_tokens) || 0,
    ud: (raa.usage && raa.usage.completion_tokens) || 0,
  };
}

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = (x) => Math.round(x * 100) / 100;

async function main() {
  const cases = byggCases();

  // Tørkørsel-tjek, køres ALTID før netværket: bygger alle prompts og afviser, hvis
  // brugertekst er havnet i systemfeltet, eller et tag kan lukkes indefra.
  let fejl = 0;
  for (const c of cases) {
    let p;
    try { p = byg(c); } catch (e) { console.log(`  FEJL  ${c.id}: ${e.message}`); fejl++; continue; }
    for (const s of friTekst(c)) if (p.system.includes(s)) { console.log(`  FEJL  ${c.id}: brugertekst i systemfeltet`); fejl++; }
    for (const navn of P._TAGNAVNE) {
      const aabne = (p.bruger.match(new RegExp(`<${navn}>`, "g")) || []).length;
      const lukke = (p.bruger.match(new RegExp(`</${navn}>`, "g")) || []).length;
      if (aabne > 1 || lukke > 1 || aabne !== lukke) { console.log(`  FEJL  ${c.id}: tagget <${navn}> optræder ${aabne}/${lukke} gange`); fejl++; }
    }
  }
  const antal = { svar: 0, opslag: 0, kommentar: 0 };
  for (const c of cases) antal[c.type]++;
  console.log(`\nPromptversion ${P.SKRIVEHJAELP_PROMPT_VERSION} · ${cases.length} cases (svar ${antal.svar}, opslag ${antal.opslag}, kommentar ${antal.kommentar}) · ${MODELLER.length} model(ler)`);
  console.log(`Tørkørsel: ${fejl ? fejl + " FEJL" : "0 fejl"} (S6-adskillelse og tags)`);
  if (fejl) process.exit(1);
  if (TOER) { console.log("Ingen netværk (--toer). Slut."); return; }

  if (fs.existsSync(path.join(process.cwd(), ".ENV-ER-PROD"))) {
    console.log("STOP: .ENV-ER-PROD findes. Miljøet peger på PROD. Kør skift-staging.ps1 først.");
    process.exit(1);
  }

  // Fail-closed: alle modeller skal kunne prissættes, FØR første kald.
  const konf = {};
  if (LEVERANDOER === "scaleway") {
    let adapter;
    try { adapter = require("./tekst-adapter"); }
    catch (e) { console.log("STOP: tekst-adapter.js kan ikke hentes: " + e.message); process.exit(1); }
    if (typeof adapter._hentKonfig !== "function" || typeof adapter.prisOere !== "function") {
      console.log("STOP: tekst-adapter.js eksporterer ikke _hentKonfig og prisOere som forventet. Skriptet skal tilpasses.");
      process.exit(1);
    }
    for (const m of MODELLER) {
      const env = { ...process.env, TILBUD_REFERAT_MODEL: m };
      try { const k = adapter._hentKonfig(env); konf[m] = { url: k.url, noegle: k.noegle, pris: (i, u) => adapter.prisOere(i, u, env) }; }
      catch (e) { console.log(`STOP (${m}): ${e.message}`); process.exit(1); }
    }
  } else {
    console.log(`STOP: ukendt --leverandoer '${LEVERANDOER}'. Kendte: scaleway`); process.exit(1);
  }
  const forste = konf[MODELLER[0]].url;
  const projekt = (forste.match(/[0-9a-f]{8}-[0-9a-f]{4}/i) || ["?"])[0];
  console.log(`Leverandør-URL: ${new URL(forste).host}, projekt ${projekt}… (tjek, at det er STAGING-projektet)`);
  console.log(`Loft for hele kørslen: ${MAKS_OERE} øre. Resultat i ${UD}\n`);

  fs.mkdirSync(UD, { recursive: true });
  const resultater = [];
  let brugt = 0;

  ydre:
  for (const m of MODELLER) {
    for (const c of cases) {
      if (brugt >= MAKS_OERE) { console.log(`\nSTOP: loftet på ${MAKS_OERE} øre er nået.`); break ydre; }
      const p = byg(c);
      const param = PARAM[c.type];
      let r;
      try { r = await kald(konf[m], m, p, param); }
      catch (e) { r = { ms: 0, netFejl: e.name === "TimeoutError" ? "timeout efter 120 s" : e.message }; }

      const res = { model: m, id: c.id, type: c.type, input: c.input, trade: c.firma.trade, tjek: c.tjek, ms: r.ms, param };
      if (r.httpFejl || r.netFejl) {
        res.fejl = r.httpFejl ? `HTTP ${r.httpFejl}` : r.netFejl;
      } else {
        res.tokensInd = r.ind; res.tokensUd = r.ud; res.slut = r.slut;
        res.oere = r2(konf[m].pris(r.ind, r.ud));
        brugt += res.oere;
        if (!r.indhold.trim() && r.ud > 0) res.fejl = `tomt svar trods ${r.ud} tokens: ræsonnerende model`;
        else if (c.type === "svar") {
          const s = P.splitAnswer(r.indhold);
          if (!s.svar) res.fejl = "tomt svar";
          res.svar = s.svar; res.noter = s.noter;
          if (!s.noter.length) res.formFlag = "ingen ### og noter";
          res.flag = flag_(c, p, [s.svar]);
        } else {
          const l = P.laesForslag(r.indhold);
          if (!l.ok) { res.fejl = "form: " + l.fejl; res.raat = r.indhold.slice(0, 2000); }
          else { res.forslag = l.forslag; res.flag = flag_(c, p, l.forslag); }
        }
        if (r.slut === "length") (res.flag = res.flag || []).push("afskåret ved max_tokens");
      }
      resultater.push(res);
      const status = res.fejl ? "FEJL " : (res.flag && res.flag.length) || res.formFlag ? "FLAG " : "OK   ";
      console.log(`  ${status} ${m.slice(0, 22).padEnd(22)} ${c.id.padEnd(34)} ${String(res.ms).padStart(6)} ms ${res.oere != null ? res.oere.toFixed(2).padStart(6) + " øre" : ""}`);
    }
  }

  // ─── Sammendrag ────────────────────────────────────────────────────────────
  const linjer = [];
  linjer.push(`# Måling Skrivehjælp · ${new Date().toLocaleString("da-DK")}`, "",
    `Promptversion \`${P.SKRIVEHJAELP_PROMPT_VERSION}\` · sæt \`${SAET_FIL}\` · i alt ${r2(brugt)} øre`, "",
    "| Model | Type | Kald | Fejl | Med flag | Øre median | Øre maks | Tid median (ms) | Tid maks (ms) | Tokens ud median |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const m of MODELLER) for (const t of ["svar", "opslag", "kommentar"]) {
    const rs = resultater.filter(r => r.model === m && r.type === t);
    if (!rs.length) continue;
    const ok = rs.filter(r => r.oere != null);
    linjer.push(`| ${m} | ${t} | ${rs.length} | ${rs.filter(r => r.fejl).length} | ${rs.filter(r => (r.flag && r.flag.length) || r.formFlag).length} | ` +
      `${r2(median(ok.map(r => r.oere)))} | ${r2(Math.max(0, ...ok.map(r => r.oere)))} | ${median(ok.map(r => r.ms))} | ${Math.max(0, ...ok.map(r => r.ms))} | ${median(ok.map(r => r.tokensUd))} |`);
  }
  linjer.push("", "Øre pr. kald → hvad loftet rækker til: 300 øre (3 kr./dag) og 5.000 øre (50 kr./md.) divideret med medianen ovenfor.", "");

  linjer.push("## Alle kald", "");
  for (const r of resultater) {
    linjer.push(`### ${r.id} · ${r.model}`, "");
    const i = r.input;
    if (r.type === "svar") linjer.push(`Fag: ${r.trade} · situation: ${i.situation} · ${i.kanal} · ${i.tone}`, "", "**Kundens besked:**", "", "> " + i.besked.replace(/\n/g, "\n> "), "",
      `**Fakta:** ${Object.entries(i.felter || {}).map(([k, v]) => `${k}=${v}`).join(" · ") || "(ingen)"}`, "");
    if (r.type === "opslag") linjer.push(`**Idé:** ${i.idea} · mål: ${i.goal} · ${i.platform}`, "");
    if (r.type === "kommentar") linjer.push("**Kommentar:** " + i.comment, "", "**Rå svar:** " + i.raw, "");
    if (r.tjek) linjer.push("**Tjek efter:** " + r.tjek, "", "**OK?** ☐ Ja ☐ Nej ☐ Delvis · **Noter:**", "");
    if (r.fejl) linjer.push(`**FEJL:** ${r.fejl}`, "");
    if (r.raat) linjer.push("```", r.raat, "```", "");
    if (r.svar) linjer.push("**Udkast:**", "", "```", r.svar, "```", "", r.noter.length ? "**Noter:** " + r.noter.join(" · ") : "", "");
    if (r.forslag) r.forslag.forEach((f, n) => linjer.push(`**Forslag ${n + 1}:**`, "", "```", f, "```", ""));
    const alleFlag = [...(r.flag || []), ...(r.formFlag ? [r.formFlag] : [])];
    if (alleFlag.length) linjer.push("**Flag:** " + alleFlag.join(" · "), "");
    if (r.oere != null) linjer.push(`*${r.ms} ms · ${r.tokensInd} ind / ${r.tokensUd} ud · ${r.oere} øre*`, "");
  }

  fs.writeFileSync(path.join(UD, "resultat.json"), JSON.stringify({ promptVersion: P.SKRIVEHJAELP_PROMPT_VERSION, modeller: MODELLER, resultater }, null, 2));
  fs.writeFileSync(path.join(UD, "oversigt.md"), linjer.join("\n"));
  console.log(`\nI alt ${r2(brugt)} øre. Skrevet: ${path.join(UD, "oversigt.md")}`);
}

main().catch(e => { console.error("Uventet fejl: " + (e && e.message)); process.exit(1); });
