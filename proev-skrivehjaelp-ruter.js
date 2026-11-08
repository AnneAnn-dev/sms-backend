// proev-skrivehjaelp-ruter.js -- proever skrivehjaelp-ruter.js uden netvaerk, database
// eller noegle. Databasen, AppSignal og tekstmodellen er attrapper. Koeres i CI.
//
//   node proev-skrivehjaelp-ruter.js
//
// Det, der skal holde (Fase 4 T2, 8/11-26):
//  - firm_id fra tokenet; profil (branche og afsendernavn) foer foerste udkast
//  - 400 FOER kvoten og kaldet ved ugyldigt input og manglende afgoerende felt (lag 2)
//  - kvoten med den rigtige pulje: svar og kommentar i "svar", opslag i "facebook"
//  - HVERT kald bogfoeres, ogsaa et betalt kald med forkert form; et nyt forsoeg hoejst
//  - en leverandoerfejl uden pris bogfoeres ikke og proeves ikke igen
//  - ingen kundetekst i loggen
// Ren ASCII.
"use strict";

const Module = require("module");
const meldt = [];
const _load = Module._load;
Module._load = function (navn, ...rest) {
  if (navn === "@appsignal/nodejs") return { sendError: (e) => meldt.push(e) };
  return _load.call(this, navn, ...rest);
};

const ruter = require("./skrivehjaelp-ruter");

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const x = JSON.stringify(faktisk), y = JSON.stringify(forventet);
  return x === y ? ok(n, x.length > 110 ? x.slice(0, 107) + "..." : x) : nej(n, `fik ${x}, forventede ${y}`);
};

const ENV = {
  AI_FIRMA_MAANEDSLOFT_DKK: "70", AI_FIRMA_DAGSLOFT_DKK: "10", AI_GLOBALT_MAANEDSLOFT_DKK: "500", AI_KALD_LOFT_DKK: "5",
  AI_SVAR_MAANEDSLOFT_DKK: "10", AI_SVAR_DAGSLOFT_DKK: "2", AI_FACEBOOK_MAANEDSLOFT_DKK: "10", AI_FACEBOOK_DAGSLOFT_DKK: "2",
};
const BESKED = "Hej, kan I komme og kigge paa vores radiator? Mvh Kirsten Hemmeligsen";

// --- Databasen ------------------------------------------------------------
function db({ profil = { branche: "VVS", afsender_navn: "Peter", afsender_telefon: "12 34 56 78", telefon: "70 70 70 70" }, moduler = ["svar", "facebook"], forbrug = [], forbrugFejl = false } = {}) {
  const st = { indsat: [], opdateret: [] };
  const raekker = (tabel) => {
    if (tabel === "firma_moduler") return moduler.map((m) => ({ modul: m, fra: "2026-01-01T00:00:00Z", til: null }));
    if (tabel === "ai_forbrug") return forbrug;
    return [];
  };
  st.sb = {
    auth: { getUser: async (tok) => ({ data: { user: tok === "god" ? { id: "U1" } : null }, error: null }) },
    from(tabel) {
      const filtre = {};
      const o = {
        select() { return o; },
        eq(k, v) { filtre[k] = v; return o; }, gte() { return o; },
        in(k, v) { filtre[k] = v; return o; },
        single: async () => ({ data: tabel === "firm_users" ? { firm_id: "F1" } : null, error: null }),
        maybeSingle: async () => {
          if (tabel === "firms") return { data: { id: "F1", name: "Hansens VVS", owner_phone: "+4512345678" }, error: null };
          if (tabel === "firma_profil") return { data: { ...profil, ai_maanedsloft_dkk: null, ai_dagsloft_dkk: null }, error: null };
          return { data: null, error: null };
        },
        update(v) { st.opdateret.push({ tabel, v }); return { eq: async () => ({ error: null }) }; },
        insert: async (v) => { st.indsat.push({ tabel, v }); return { error: null }; },
        then(r) {
          if (tabel === "ai_forbrug" && forbrugFejl) return Promise.resolve({ data: null, error: { message: "nede" } }).then(r);
          let d = raekker(tabel);
          if (tabel === "ai_forbrug" && filtre.formaal) d = d.filter((x) => filtre.formaal.includes(x.formaal));
          return Promise.resolve({ data: d, error: null }).then(r);
        },
      };
      return o;
    },
  };
  return st;
}

// --- Tekstmodellen -------------------------------------------------------
function model(svar) {
  const m = { kald: [], svar: [...svar] };
  m.prisOereSkrivehjaelp = () => 2;
  m.skriv = async (arg) => {
    m.kald.push(arg);
    const s = m.svar.shift();
    if (s instanceof Error) throw s;
    return { raat: s, tokensInd: 900, tokensUd: 150, prisOere: 2.5, leverandoer: "scaleway", model: "mistral-medium-3.5-128b" };
  };
  return m;
}
const betaltFejl = (kode, prisOere) => Object.assign(new Error("tom"), { kode, prisOere, tokensInd: 900, tokensUd: 800, leverandoer: "scaleway", model: "m" });

async function koer({ metode = "POST", sti, krop, tok = "god", d = db(), m = model([]) }) {
  const app = {}; const logget = [];
  const log = { log: (...a) => logget.push(a.join(" ")), error: (...a) => logget.push(a.map(String).join(" ")), warn: (...a) => logget.push(a.map((x) => typeof x === "object" ? JSON.stringify(x) : String(x)).join(" ")) };
  const reg = {};
  ruter({ get: (s, f) => { reg["GET " + s] = f; }, post: (s, f) => { reg["POST " + s] = f; } }, d.sb, { tekstmodel: m, env: ENV, log });
  let status = 200, data;
  const res = { headersSent: false, set() { return res; }, status(s) { status = s; return res; }, json(x) { data = x; res.headersSent = true; return res; } };
  await reg[`${metode} ${sti}`]({ headers: { authorization: "Bearer " + tok }, body: krop || {} }, res);
  return { status, data, d, m, logget };
}

const SVAR = { situation: "nyopgave", felter: { take: "Ja, jeg vil gerne se den f\u00f8rst", visit: "torsdag kl. 15" }, kanal: "sms", tone: "venlig", besked: BESKED };
const GODT = "Hej Kirsten. Passer torsdag kl. 15?\n\nPeter, Hansens VVS, tlf. [12 34 56 78]\n###\n- Tjek tiden";
const forbrugt = (d) => d.indsat.filter((x) => x.tabel === "ai_forbrug").map((x) => [x.v.formaal, x.v.pris_oere]);

(async () => {
  console.log("1. Adgang og profil");
  let r = await koer({ sti: "/api/skrivehjaelp/svar", krop: SVAR, tok: "forkert" });
  lig("uden gyldigt login: 401", r.status, 401);
  r = await koer({ metode: "GET", sti: "/api/skrivehjaelp/profil", d: db({ moduler: ["telefon"] }) });
  lig("profil uden svar/facebook: 403", r.status, 403);
  r = await koer({ metode: "GET", sti: "/api/skrivehjaelp/profil", d: db({ profil: { branche: null, afsender_navn: null, telefon: null } }) });
  lig("profilen mangler: siges, og brancherne er Annes tre pakker", [r.status, r.data.profilMangler, r.data.brancher.map((b) => b.gruppe), r.data.situationer.length],
    [200, true, ["H\u00e5ndv\u00e6rk", "Gr\u00f8n sektor", "Service"], 0]);
  r = await koer({ metode: "GET", sti: "/api/skrivehjaelp/profil" });
  const ny = r.data.situationer.find((s) => s.id === "nyopgave");
  lig("med profil: situationerne for branchen, med det afgoerende felt", [r.data.firmanavn, r.data.afsenderNavn, ny.afgoerende, r.data.situationer.length], ["Hansens VVS", "Peter", "take", 11]);
  r = await koer({ sti: "/api/skrivehjaelp/profil", krop: { branche: "Bager", afsenderNavn: "Peter" } });
  lig("ukendt branche afvises", [r.status, r.data.error], [400, "ukendt_branche"]);
  r = await koer({ sti: "/api/skrivehjaelp/profil", krop: { branche: "VVS", afsenderNavn: "<b>Peter</b>" } });
  lig("navn med < > afvises", [r.status, r.data.error], [400, "ugyldigt_navn"]);
  r = await koer({ sti: "/api/skrivehjaelp/profil", krop: { branche: "VVS", afsenderNavn: "x".repeat(61) } });
  lig("navn over 60 tegn afvises", r.status, 400);
  r = await koer({ sti: "/api/skrivehjaelp/profil", krop: { branche: "Anl\u00e6gsgartner", afsenderNavn: "  Peter   Hansen " } });
  lig("gyldig profil uden nummer gemmes i firma_profil (mellemrum ryddet, tomt nummer = null)", [r.status, r.d.opdateret], [200, [{ tabel: "firma_profil", v: { branche: "Anl\u00e6gsgartner", afsender_navn: "Peter Hansen", afsender_telefon: null } }]]);
  r = await koer({ sti: "/api/skrivehjaelp/profil", krop: { branche: "VVS", afsenderNavn: "Peter", afsenderTelefon: " +45 12  34 56 78 " } });
  lig("telefonnummeret gemmes, som firmaet skrev det (Ann 8/11)", r.d.opdateret[0].v.afsender_telefon, "+45 12 34 56 78");
  r = await koer({ sti: "/api/skrivehjaelp/profil", krop: { branche: "VVS", afsenderNavn: "Peter", afsenderTelefon: "ring mig" } });
  lig("et telefonnummer uden cifre afvises", [r.status, r.data.error], [400, "ugyldigt_telefonnummer"]);
  r = await koer({ metode: "GET", sti: "/api/skrivehjaelp/profil" });
  lig("firmaets nummer og ejerens mobil er kun forslag; det valgte nummer staar for sig", [r.data.afsenderTelefon, r.data.telefonForslag], ["12 34 56 78", ["70 70 70 70", "+4512345678"]]);
  r = await koer({ sti: "/api/skrivehjaelp/svar", krop: SVAR, d: db({ profil: { branche: "VVS", afsender_navn: "Peter", afsender_telefon: null, telefon: "70 70 70 70" } }), m: model([GODT]) });
  lig("uden valgt nummer kommer hverken firmaets nummer eller ejerens mobil i prompten", [r.m.kald[0].bruger.includes("70 70 70 70"), r.m.kald[0].bruger.includes("12345678")], [false, false]);

  console.log("\n2. Svar: lag 2 og kvoten foer kaldet");
  r = await koer({ sti: "/api/skrivehjaelp/svar", krop: SVAR, d: db({ profil: { branche: "VVS", afsender_navn: null } }) });
  lig("profil uden navn: 409 profil_mangler, intet kald", [r.status, r.data.error, r.m.kald.length], [409, "profil_mangler", 0]);
  r = await koer({ sti: "/api/skrivehjaelp/svar", krop: { ...SVAR, felter: { visit: "torsdag" } } });
  lig("uden det afgoerende felt: 400 med feltets navn, intet kald, intet bogfoert", [r.status, r.data.besked, r.m.kald.length, forbrugt(r.d)], [400, "Udfyld: Vil du tage opgaven?", 0, []]);
  r = await koer({ sti: "/api/skrivehjaelp/svar", krop: { ...SVAR, kanal: "brevdue" } });
  lig("ukendt kanal: 400", r.status, 400);
  r = await koer({ sti: "/api/skrivehjaelp/svar", krop: SVAR, d: db({ forbrug: [{ formaal: "skrivehjaelp_svar", pris_oere: 200 }] }) });
  lig("dagsloftet for svar (2 kr.) er naaet: 402, intet kald", [r.status, r.data.error, r.m.kald.length], [402, "firma_dagsloft", 0]);
  r = await koer({ sti: "/api/skrivehjaelp/svar", krop: SVAR, d: db({ forbrug: [{ formaal: "skrivehjaelp_opslag", pris_oere: 500 }] }), m: model([GODT]) });
  lig("forbrug i facebook-puljen spaerrer ikke svar", r.status, 200);
  r = await koer({ sti: "/api/skrivehjaelp/svar", krop: SVAR, d: db({ forbrugFejl: true }) });
  lig("kvoten kan ikke laeses: 503, intet kald (fail-closed)", [r.status, r.data.error, r.m.kald.length], [503, "kvote_utilgaengelig", 0]);
  const mk = model([GODT]); mk.prisOereSkrivehjaelp = () => { throw Object.assign(new Error("SKRIVEHJAELP_MODEL mangler"), { kode: "referat_konfiguration" }); };
  r = await koer({ sti: "/api/skrivehjaelp/svar", krop: SVAR, m: mk });
  lig("SKRIVEHJAELP_MODEL mangler: 503 skrivehjaelp_ukonfigureret", [r.status, r.data.error, r.m.kald.length], [503, "skrivehjaelp_ukonfigureret", 0]);

  console.log("\n3. Svar: kaldet, formen og bogfoeringen");
  r = await koer({ sti: "/api/skrivehjaelp/svar", krop: SVAR, m: model([GODT]) });
  lig("godt svar: 200, renset (kendt telefon ud af parentes), noter", [r.status, r.data.svar, r.data.noter], [200, "Hej Kirsten. Passer torsdag kl. 15?\n\nPeter, Hansens VVS, tlf. 12 34 56 78", ["Tjek tiden"]]);
  lig("system og bruger hver for sig; kundens besked ikke i systemfeltet (S6)", [r.m.kald.length, r.m.kald[0].system.includes("Kirsten"), r.m.kald[0].bruger.includes("Kirsten")], [1, false, true]);
  lig("underskriften: navn og firmanavn (Ann 8/11)", r.m.kald[0].bruger.includes("Afsender: Peter, Hansens VVS"), true);
  lig("kaldparametre: 0,3 og 800 tokens og 30 s", [r.m.kald[0].temperatur, r.m.kald[0].maksTokens, r.m.kald[0].timeoutMs], [0.3, 800, 30000]);
  lig("bogfoert under skrivehjaelp_svar", forbrugt(r.d), [["skrivehjaelp_svar", 2.5]]);
  r = await koer({ sti: "/api/skrivehjaelp/svar", krop: SVAR, m: model(["BANAN", GODT]) });
  lig("forkert form, saa rigtig: 200, to kald, begge bogfoert", [r.status, r.m.kald.length, forbrugt(r.d).length, r.data.forsoeg], [200, 2, 2, 2]);
  r = await koer({ sti: "/api/skrivehjaelp/svar", krop: SVAR, m: model(["BANAN", "BANAN", GODT]) });
  lig("forkert form to gange: 502, IKKE et tredje kald, begge bogfoert", [r.status, r.data.error, r.m.kald.length, forbrugt(r.d).length], [502, "udkast_ubrugeligt", 2, 2]);
  r = await koer({ sti: "/api/skrivehjaelp/svar", krop: SVAR, m: model([betaltFejl("skrivehjaelp_tom", 6.1)]) });
  lig("tomt svar fra en raesonnerende model: 502, men bogfoert (betalt)", [r.status, r.data.error, forbrugt(r.d)], [502, "udkast_tomt", [["skrivehjaelp_svar", 6.1]]]);
  r = await koer({ sti: "/api/skrivehjaelp/svar", krop: SVAR, m: model([Object.assign(new Error("500"), { kode: "skrivehjaelp_kald", status: 500 }), GODT]) });
  lig("leverandoerfejl uden pris: 502, ikke bogfoert, ikke proevet igen", [r.status, r.data.error, forbrugt(r.d), r.m.kald.length], [502, "udkast_fejlede", [], 1]);
  lig("ingen kundetekst i loggen", r.logget.some((l) => l.includes("Kirsten") || l.includes("radiator")), false);

  console.log("\n4. Opslag og kommentar");
  const BEGGE = JSON.stringify({ forslag: [{ facebook: "FB 1 #a #b #c", instagram: "IG 1 #a #b #c" }, { facebook: "FB 2 #a #b #c", instagram: "IG 2 #a #b #c" }] });
  r = await koer({ sti: "/api/skrivehjaelp/opslag", krop: { idea: "Nyt tag i Hilleroed", goal: "Salg", platform: "Begge" }, m: model([BEGGE]) });
  lig("Begge: fire tekster, 2500 tokens, bogfoert under skrivehjaelp_opslag", [r.status, r.data.begge, r.data.forslag.length, r.m.kald[0].maksTokens, forbrugt(r.d)], [200, true, 2, 2500, [["skrivehjaelp_opslag", 2.5]]]);
  r = await koer({ sti: "/api/skrivehjaelp/opslag", krop: { idea: "x", goal: "Salg", platform: "Facebook" }, d: db({ forbrug: [{ formaal: "skrivehjaelp_svar", pris_oere: 500 }] }), m: model([JSON.stringify({ forslag: [{ tekst: "a #x #y #z" }, { tekst: "b #x #y #z" }] })]) });
  lig("opslag taeller i facebook-puljen, ikke i svar", [r.status, r.data.forslag], [200, ["a #x #y #z", "b #x #y #z"]]);
  r = await koer({ sti: "/api/skrivehjaelp/opslag", krop: { idea: "x", goal: "Spam", platform: "Facebook" } });
  lig("ukendt maal: 400", r.status, 400);
  r = await koer({ sti: "/api/skrivehjaelp/kommentar", krop: { comment: "Hvornaar aabner I?", raw: "kl 9" }, m: model([JSON.stringify({ forslag: [{ tekst: "Vi aabner kl. 9" }, { tekst: "Kl. 9, velkommen" }] })]) });
  lig("kommentarsvar bogfoeres under skrivehjaelp_kommentar", [r.status, forbrugt(r.d)], [200, [["skrivehjaelp_kommentar", 2.5]]]);

  console.log("\n5. Kvoten for skaermen");
  r = await koer({ metode: "GET", sti: "/api/skrivehjaelp/kvote", d: db({ forbrug: [{ formaal: "skrivehjaelp_svar", pris_oere: 150 }] }) });
  lig("begge puljer, hver for sig", [r.status, r.data.svar.forbrugtIDagOere, r.data.facebook.forbrugtIDagOere, r.data.svar.dagsloftOere], [200, 150, 0, 200]);
  r = await koer({ metode: "GET", sti: "/api/skrivehjaelp/kvote", d: db({ moduler: ["svar"] }) });
  lig("kun svar-modulet: kun svar-puljen", Object.keys(r.data), ["svar"]);

  console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
  console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
  process.exit(fejlet ? 1 : 0);
})();
