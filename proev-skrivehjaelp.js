// proev-skrivehjaelp.js -- proever Skrivehjaelps kerne uden netvaerk og uden noegle.
// Koeres i CI (kor-proever.js, KOERES).
//
//   node proev-skrivehjaelp.js
//
// 1. Det afgoerende felt (lag 1-2, Annes bilag A): hver situation i hver pakke har et,
//    og bygSvar afviser kaldet uden det. Maalt 8/11: uden fakta lovede modellen noget
//    i ca. halvdelen af 34 udkast. Derfor er feltet et krav, ikke en anbefaling.
// 2. tekst-adapter.skriv(): system og bruger adskilt (S6), egen laast model (D14),
//    prisen haenger paa en betalt fejl, og en raesonnerende model siger sit navn (J9).
// Fase 4 T2, 8/11-26. Ren ASCII.
"use strict";

const P = require("./prompts/skrivehjaelp");
const { PACKS } = require("./prompts/skrivehjaelp-pakker");
const a = require("./tekst-adapter");

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const x = JSON.stringify(faktisk), y = JSON.stringify(forventet);
  return x === y ? ok(n, x.length > 120 ? x.slice(0, 117) + "..." : x) : nej(n, `fik ${x}, forventede ${y}`);
};
const kaster = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const FIRMA = { firm: "Testfirma ApS", person: "Peter Testesen", phone: "12 34 56 78", city: "Hilleroed" };
const FAG = { haandvaerk: "Toemrer", groen: "Anlaegsgartner", service: "Rengoering" };

(async () => {
  console.log("1. Det afgoerende felt (lag 2)");
  let mangler = [], afvist = 0, godkendt = 0, situationer = 0;
  for (const [pk, pack] of Object.entries(PACKS)) {
    const trade = pack.trades && pack.trades[0] ? pack.trades[0] : FAG[pk];
    for (const [sid, sit] of Object.entries(pack.situations)) {
      situationer++;
      if (!Object.prototype.hasOwnProperty.call(P.AFGOERENDE, sid)) { mangler.push(`${pk}/${sid}: ingen regel`); continue; }
      const afg = P.AFGOERENDE[sid];
      if (afg && afg !== "andet" && !sit.fields.some((f) => f.id === afg)) { mangler.push(`${pk}/${sid}: feltet ${afg} findes ikke`); continue; }
      const grund = { situation: sid, felter: {}, kanal: "sms", tone: "venlig", besked: "Hej, et spoergsmaal." };
      const firma = { ...FIRMA, trade };
      const e = kaster(() => P.bygSvar(grund, firma));
      if (afg === null) { if (!e) godkendt++; else mangler.push(`${pk}/${sid}: afvist uden at have et afgoerende felt (${e.message})`); continue; }
      if (e instanceof P.ValideringsFejl) afvist++; else mangler.push(`${pk}/${sid}: blev IKKE afvist uden ${afg}`);
      // Med kun det afgoerende felt udfyldt skal det gaa igennem.
      const felter = {}; let andet = "";
      if (afg === "andet") andet = "Fakturaen er sendt igen";
      else { const f = sit.fields.find((x) => x.id === afg); felter[afg] = f.type === "select" ? f.options[0] : "en oplysning"; }
      const e2 = kaster(() => P.bygSvar({ ...grund, felter, andet }, firma));
      if (e2) mangler.push(`${pk}/${sid}: afvist, selvom ${afg} var udfyldt (${e2.message})`); else godkendt++;
    }
  }
  lig("alle situationer i alle pakker har et afgoerende felt, der findes", mangler, []);
  ok(`${situationer} situationer: ${afvist} afvist uden feltet, ${godkendt} godkendt med det (eller uden beslutning)`);
  lig("fejlbeskeden naevner feltets navn (vises i appen)",
    kaster(() => P.bygSvar({ situation: "nyopgave", felter: {}, kanal: "sms", tone: "venlig", besked: "x" }, { ...FIRMA, trade: "Toemrer" })).message,
    "Udfyld: Vil du tage opgaven?");
  lig("kun mellemrum taeller ikke som udfyldt",
    kaster(() => P.bygSvar({ situation: "nyopgave", felter: { take: "   " }, kanal: "sms", tone: "venlig", besked: "x" }, { ...FIRMA, trade: "Toemrer" })) instanceof P.ValideringsFejl, true);
  lig("en ukendt situation afvises stadig", kaster(() => P.bygSvar({ situation: "findes-ikke", felter: {}, kanal: "sms", tone: "venlig", besked: "x" }, { ...FIRMA, trade: "Toemrer" })) instanceof P.ValideringsFejl, true);

  console.log("\n2. tekst-adapter.skriv()");
  const ENV = {
    TILBUD_REFERAT_LEVERANDOER: "scaleway",
    TILBUD_REFERAT_URL: "https://api.scaleway.ai/11111111-2222-3333-4444-555555555555/v1",
    TILBUD_REFERAT_MODEL: "mistral-small-3.2-24b-instruct-2506",
    SKRIVEHJAELP_MODEL: "mistral-medium-3.5-128b",
    SCW_GENAI_SECRET_KEY: "test",
  };
  let sidst = null;
  const svarMed = (krop, status = 200) => async (url, opt) => {
    sidst = { url, body: JSON.parse(opt.body) };
    return { ok: status < 400, status, json: async () => krop };
  };
  const GODT = { choices: [{ message: { content: "Hej.\n###\n- Tjek" }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 200 } };

  let r = await a.skriv({ system: "SYSTEM", bruger: "<kundens_besked>\nhej\n</kundens_besked>" }, ENV, svarMed(GODT));
  lig("system og bruger sendes som to beskeder (S6)", sidst.body.messages.map((m) => m.role), ["system", "user"]);
  lig("systemfeltet indeholder ikke brugerens tekst", sidst.body.messages[0].content.includes("hej"), false);
  lig("Skrivehjaelp bruger SKRIVEHJAELP_MODEL, ikke referatets model (D14)", [sidst.body.model, r.model], ["mistral-medium-3.5-128b", "mistral-medium-3.5-128b"]);
  lig("den raa tekst kommer tilbage uroert", r.raat, "Hej.\n###\n- Tjek");
  lig("prisen: 1000 ind og 200 ud med mistral-medium = ca. 2,24 oere", Math.round(r.prisOere * 100) / 100, Math.round(((1000 * 1.5 + 200 * 7.5) / 1e6) * 7.46 * 100 * 100) / 100);
  lig("prisOereSkrivehjaelp giver samme tal", a.prisOereSkrivehjaelp(1000, 200, ENV), r.prisOere);
  lig("referatets pris er uaendret (sin egen model)", a.prisOere(1000, 200, ENV) !== r.prisOere, true);

  let e = null;
  try { await a.skriv({ system: "S", bruger: "B" }, ENV, svarMed({ choices: [{ message: { content: "" } }], usage: { prompt_tokens: 900, completion_tokens: 800 } })); } catch (x) { e = x; }
  lig("tomt svar trods tokens: raesonnerende model, og prisen haenger paa fejlen (J9)", [e && e.kode, e && e.slags, e && e.prisOere > 0], ["skrivehjaelp_tom", "raesonnerende", true]);
  e = null;
  try { await a.skriv({ system: "S", bruger: "B" }, ENV, svarMed({}, 500)); } catch (x) { e = x; }
  lig("HTTP 500: kaldfejl uden pris (intet at bogfoere)", [e && e.kode, e && e.status, e && e.prisOere], ["skrivehjaelp_kald", 500, undefined]);
  e = null;
  try { await a.skriv({ system: "S", bruger: "B" }, ENV, async () => { const x = new Error("afbrudt"); x.name = "AbortError"; throw x; }); } catch (x) { e = x; }
  lig("timeout siges som timeout", [e && e.kode, e && e.timeout], ["skrivehjaelp_kald", true]);
  e = null;
  try { await a.skriv({ system: "S", bruger: "B" }, { ...ENV, SKRIVEHJAELP_MODEL: "" }, svarMed(GODT)); } catch (x) { e = x; }
  lig("SKRIVEHJAELP_MODEL mangler: konfigurationsfejl FOER kaldet", [e && e.kode, /SKRIVEHJAELP_MODEL mangler/.test(e && e.message), sidst.body.model], ["skrivehjaelp_konfiguration", true, "mistral-medium-3.5-128b"]);
  e = null;
  try { await a.skriv({ system: "S", bruger: "B" }, { ...ENV, SKRIVEHJAELP_MODEL: "mistral-latest" }, svarMed(GODT)); } catch (x) { e = x; }
  lig("et alias afvises (D14)", [e && e.kode, /alias/.test(e && e.message)], ["skrivehjaelp_konfiguration", true]);
  e = null;
  try { await a.skriv({ system: "S", bruger: "B" }, { ...ENV, SKRIVEHJAELP_MODEL: "ukendt-model-1" }, svarMed(GODT)); } catch (x) { e = x; }
  lig("en model uden pris afvises (fail-closed paa prisen)", [e && e.kode, /prisen for/.test(e && e.message)], ["skrivehjaelp_konfiguration", true]);
  e = null;
  try { await a.skriv({ system: "", bruger: "B" }, ENV, svarMed(GODT)); } catch (x) { e = x; }
  lig("tomt systemfelt afvises", e && e.kode, "skrivehjaelp_brug");
  r = await a.skriv({ system: "S", bruger: "B" }, ENV, svarMed({ ...GODT, choices: [{ message: { content: "Hej" }, finish_reason: "length" }] }));
  lig("afskaaret ved max_tokens meldes", r.afskaaret, true);

  console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
  console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
  process.exit(fejlet ? 1 : 0);
})();
