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
// 3. Den generelle pakke (T8, 18/11-26): fag uden egen pakke falder tilbage til den, og
//    en situation kan saette sit eget afgoerende felt (afgoerendeFor).
// Fase 4 T2, 8/11-26. Ren ASCII.
"use strict";

const P = require("./prompts/skrivehjaelp");
const { PACKS, sectorOf } = require("./prompts/skrivehjaelp-pakker");
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
// Rigtige fagnavne (T8): et fag, der ikke staar i en pakke, faar nu den generelle pakke, ikke Haandvaerk.
const FAG = { haandvaerk: "T\u00f8mrer", groen: "Anl\u00e6gsgartner", service: "Reng\u00f8ring", generel: "Fris\u00f8r" };

(async () => {
  console.log("1. Det afgoerende felt (lag 2)");
  let mangler = [], afvist = 0, godkendt = 0, situationer = 0;
  for (const [pk, pack] of Object.entries(PACKS)) {
    const trade = pack.trades && pack.trades[0] ? pack.trades[0] : FAG[pk];
    for (const [sid, sit] of Object.entries(pack.situations)) {
      situationer++;
      const afg = P.afgoerendeFor(pack, sid);
      if (afg === undefined) { mangler.push(`${pk}/${sid}: ingen regel`); continue; }
      if (afg !== null && typeof afg !== "string") { mangler.push(`${pk}/${sid}: afgoerende er hverken et felt-id, "andet" eller null`); continue; }
      if (afg && afg !== "andet" && !sit.fields.some((f) => f.id === afg)) { mangler.push(`${pk}/${sid}: feltet ${afg} findes ikke`); continue; }
      if (sectorOf(trade) !== pk) { mangler.push(`${pk}/${sid}: faget ${trade} giver pakken ${sectorOf(trade)}`); continue; }
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
  const { SPROG, sprogFor } = require("./prompts/skrivehjaelp-pakker");
  const udenSprog = [];
  for (const form of ["jeg", "vi"]) for (const [pk, pack] of Object.entries(PACKS)) for (const sid of Object.keys(pack.situations)) {
    const sp = SPROG[form];
    if (typeof sp.aabning[sid] !== "string" || !sp.aabning[sid].trim()) udenSprog.push(`${form}/${pk}/${sid}: ingen indledning`);
    if (!Object.prototype.hasOwnProperty.call(sp.afslutning, sid)) udenSprog.push(`${form}/${pk}/${sid}: ingen afslutning (null = bevidst ingen)`);
  }
  lig("Annes grundpakke: hver situation har en indledning og en afslutning, i jeg- og vi-form (13/11, 15/11)", udenSprog, []);
  const sp = P.bygSvar({ situation: "pris", felter: { pricetype: "Fast pris" }, kanal: "sms", tone: "venlig", besked: "x" }, { ...FIRMA, trade: "T\u00f8mrer" });
  lig("indledning og afslutning staar i systemfeltet, ikke i brugerfeltet (S6)",
    [sp.system.includes("INDLEDNING: " + SPROG.jeg.aabning.pris), sp.system.includes("AFSLUTNING: " + SPROG.jeg.afslutning.pris), sp.bruger.includes("INDLEDNING")], [true, true, false]);

  console.log("\n1b. Jeg eller vi (Ann og Anne 15/11)");
  const kl = (form) => P.bygSvar({ situation: "kvalitet", felter: { assess: "Jeg har ikke set det endnu" }, kanal: "sms", tone: "venlig", besked: "x" }, { ...FIRMA, trade: "T\u00f8mrer", form });
  const sj = kl(undefined).system, sv = kl("vi").system, sx = kl("os").system;
  lig("uden valg: jeg-form (standard)", [sj.includes("FORM: jeg-form"), sj.includes("jeg-form hele vejen"), sj.includes("AFSLUTNING: Jeg vender tilbage senest [dag], når jeg har undersøgt sagen.")], [true, true, true]);
  lig("vi: vi-form og Annes egne tekster", [sv.includes("FORM: vi-form"), sv.includes("vi-form hele vejen"), sv.includes("INDLEDNING: Tak fordi du gør os opmærksomme på det."), sv.includes("Det beklager vi selvfølgelig.")], [true, true, true, true]);
  lig("en ukendt værdi giver jeg-form", sx === sj, true);
  lig("ingen vi-vending i jeg-reglerne og omvendt", [sj.includes("Det beklager vi selvfølgelig."), sv.includes("Det beklager jeg selvfølgelig.")], [false, false]);
  lig("sprogFor: kun 'vi' giver vi-form", [sprogFor("vi") === SPROG.vi, sprogFor("jeg") === SPROG.jeg, sprogFor(null) === SPROG.jeg], [true, true, true]);
  lig("ingen ${ tilbage i reglerne", [/\$\{/.test(sj), /\$\{/.test(sv)], [false, false]);
  const af = P.bygSvar({ situation: "nyopgave", felter: { take: "Ja, jeg vil gerne se den først" }, andet: "Jeg kommer kl. 7. Vi kan rådgive om valg. Ring på 12 34 56 78.", kanal: "sms", tone: "venlig", besked: "x" }, { ...FIRMA, trade: "T\u00f8mrer" }).bruger;
  lig("Andet kunden skal vide: én linje pr. sætning, 'kl. 7' deles ikke (17/11)",
    [af.includes("  - Jeg kommer kl. 7."), af.includes("  - Vi kan rådgive om valg."), af.includes("  - Ring på 12 34 56 78.")], [true, true, true]);
  const op = (form) => P.bygOpslag({ idea: "ny terrasse", goal: "Salg", platform: "Facebook" }, { ...FIRMA, form }).system;
  const ko = (form) => P.bygKommentar({ comment: "flot", raw: "tak" }, { ...FIRMA, form }).system;
  lig("opslag og kommentar faar formen i systemfeltet", [op().includes("FORM: jeg-form"), op("vi").includes("FORM: vi-form"), ko().includes("FORM: jeg-form"), ko("vi").includes("FORM: vi-form")], [true, true, true, true]);
  ok(`${situationer} situationer: ${afvist} afvist uden feltet, ${godkendt} godkendt med det (eller uden beslutning)`);
  lig("fejlbeskeden naevner feltets navn (vises i appen)",
    kaster(() => P.bygSvar({ situation: "nyopgave", felter: {}, kanal: "sms", tone: "venlig", besked: "x" }, { ...FIRMA, trade: "T\u00f8mrer" })).message,
    "Udfyld: Vil du tage opgaven?");
  lig("kun mellemrum taeller ikke som udfyldt",
    kaster(() => P.bygSvar({ situation: "nyopgave", felter: { take: "   " }, kanal: "sms", tone: "venlig", besked: "x" }, { ...FIRMA, trade: "T\u00f8mrer" })) instanceof P.ValideringsFejl, true);
  lig("en ukendt situation afvises stadig", kaster(() => P.bygSvar({ situation: "findes-ikke", felter: {}, kanal: "sms", tone: "venlig", besked: "x" }, { ...FIRMA, trade: "T\u00f8mrer" })) instanceof P.ValideringsFejl, true);

  console.log("\n3. Den generelle pakke (T8)");
  const G = { ...FIRMA, trade: "Fris\u00f8r" };
  lig("fagene i den generelle pakke (Ann 18/11: Fitness og IT-support)", PACKS.generel.trades,
    ["Fris\u00f8r", "Revisor", "Restaurant", "Webshop", "Fotograf", "Hotel", "Fitness", "IT-support", "Butik", "Andet"]);
  lig("Annes otte situationer", Object.keys(PACKS.generel.situations), ["nyopgave", "flyt", "pris", "status", "support", "ros", "kvalitet", "andet"]);
  lig("tilbagefald: et fag uden pakke, et ukendt haandvaerksfag og intet fag giver generel; kendte fag er uaendrede",
    ["Bager", "Glarmester", "", undefined, "VVS", "Andet h\u00e5ndv\u00e6rk", "Anl\u00e6gsgartner", "Reng\u00f8ring", "Fitness"].map(sectorOf),
    ["generel", "generel", "generel", "generel", "haandvaerk", "haandvaerk", "groen", "service", "generel"]);
  lig("intet fag fra en pakke staar i to pakker", (() => { const set = {}; const dob = []; for (const [k, p] of Object.entries(PACKS)) for (const t of p.trades) { if (set[t]) dob.push(t); set[t] = k; } return dob; })(), []);
  lig("afgoerendeFor: pakkens eget felt foer standarden",
    [P.afgoerendeFor(PACKS.generel, "nyopgave"), P.afgoerendeFor(PACKS.generel, "andet"), P.afgoerendeFor(PACKS.generel, "pris"), P.afgoerendeFor(PACKS.generel, "ros"),
     P.afgoerendeFor(PACKS.haandvaerk, "nyopgave"), P.afgoerendeFor(PACKS.haandvaerk, "andet"), P.afgoerendeFor(PACKS.generel, "findes-ikke")],
    ["handle", "handle", "pricetype", null, "take", "andet", undefined]);
  const gs = (sit, felter, andet) => kaster(() => P.bygSvar({ situation: sit, felter, andet: andet || "", kanal: "sms", tone: "venlig", besked: "Hej." }, G));
  lig("generel/nyopgave: Annes spoergsmaal 1 er kravet, ikke Haandvaerks 'take'",
    [gs("nyopgave", { take: "Ja, jeg vil gerne se den f\u00f8rst" }).message, gs("nyopgave", { handle: "Jeg vil gerne hj\u00e6lpe kunden videre." })],
    ["Udfyld: Hvordan vil du gerne h\u00e5ndtere henvendelsen?", null]);
  lig("generel/andet: spoergsmaal 1 kraeves; fritekst alene er ikke nok",
    [gs("andet", {}, "Fakturaen er sendt igen").message, gs("andet", { handle: "Jeg kan svare p\u00e5 kundens sp\u00f8rgsm\u00e5l." })],
    ["Udfyld: Hvordan vil du gerne h\u00e5ndtere henvendelsen?", null]);
  lig("haandvaerk/andet kraever stadig fritekst (standarden er uaendret)",
    kaster(() => P.bygSvar({ situation: "andet", felter: {}, kanal: "sms", tone: "venlig", besked: "Hej." }, { ...FIRMA, trade: "VVS" })).message, "Skriv, hvad kunden skal vide");
  lig("generel/status og support: nye situationer med eget afgoerende felt",
    [gs("status", {}).message, gs("support", {}).message, gs("status", { state: "Jeg skal unders\u00f8ge sagen n\u00e6rmere." })],
    ["Udfyld: Hvad er status p\u00e5 henvendelsen?", "Udfyld: Hvordan vil du h\u00e5ndtere problemet?", null]);
  lig("generel/ros: intet krav, og linket falder tilbage til firmaets",
    P.bygSvar({ situation: "ros", felter: {}, kanal: "sms", tone: "venlig", besked: "Tak." }, { ...G, reviewLink: "https://g.page/x" }).bruger.includes("Link til anmeldelse https://g.page/x"), true);
  lig("en situation, der kun findes i den generelle pakke, afvises for et haandvaerksfag",
    kaster(() => P.bygSvar({ situation: "status", felter: { state: "x" }, kanal: "sms", tone: "venlig", besked: "Hej." }, { ...FIRMA, trade: "VVS" })).message, "Ukendt situation for denne branche");
  const gsys = P.bygSvar({ situation: "pris", felter: { pricetype: "Jeg kan give en fast pris." }, kanal: "sms", tone: "venlig", besked: "x" }, G).system;
  lig("systemfeltet: BRANCHE Generel, pakkens regel om 'ikke en haandvaerker' og Annes situationsnavn",
    [gsys.includes("BRANCHE: Generel"), gsys.includes("Kald aldrig virksomheden eller afsenderen en h\u00e5ndv\u00e6rker"), gsys.includes("SITUATION: Prisforesp\u00f8rgsel"), gsys.includes("REGLER FOR BRANCHEN: Kunden er typisk privatperson")],
    [true, true, true, false]);
  const ukendt = P.bygSvar({ situation: "kvalitet", felter: { assess: "Jeg skal unders\u00f8ge sagen f\u00f8rst." }, kanal: "sms", tone: "venlig", besked: "x" }, { ...FIRMA, trade: "Bager" });
  lig("et fag uden pakke (Bager) faar den generelle pakke i prompten", ukendt.system.includes("BRANCHE: Generel"), true);
  lig("et Haandvaerk-valg er ugyldigt i den generelle pakke",
    gs("kvalitet", { assess: "Kunden har ret, vi udbedrer" }) instanceof P.ValideringsFejl, true);
  lig("promptversionen er haevet (T8 og Anns afslutning 19/11)", P.SKRIVEHJAELP_PROMPT_VERSION, "2026-11-19");
  lig("ny opgave: Anns afslutning i alle pakker, jeg og vi, og den gamle er vaek (19/11)",
    [P.bygSvar({ situation: "nyopgave", felter: { take: "Nej, vi har for travlt lige nu" }, kanal: "sms", tone: "venlig", besked: "x" }, { ...FIRMA, trade: "T\u00f8mrer" }).system,
     P.bygSvar({ situation: "nyopgave", felter: { handle: "Det er desv\u00e6rre ikke noget, vi tilbyder." }, kanal: "sms", tone: "venlig", besked: "x" }, { ...FIRMA, trade: "Fris\u00f8r", form: "vi" }).system]
      .map((s) => [s.includes("AFSLUTNING: Du er altid velkommen til at sp\u00f8rge igen, hvis du p\u00e5 et senere tidspunkt f\u00e5r brug for hj\u00e6lp."), s.includes("gl\u00e6der")]),
    [[true, false], [true, false]]);

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
