// proev-referat-graenseflade.js -- proever tilbud/graenseflade.js' nye dele
// (Fase 2 punkt F, skive 1, 15/10-26) uden browser og uden server.
//
// Falsk fetch, falsk FormData og falsk window. Proeven skal FEJLE mod
// udgaven i b2073c4, hvor transskriber() ikke fandtes og saveReferater()
// kastede 'ikke_bygget' -- ellers beviser den ikke noget.
//
//   node proev-referat-graenseflade.js [sti-til-graenseflade.js]
//   (standard: tilbud/graenseflade.js)
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const fil = process.argv[2] || path.join(__dirname, "tilbud", "graenseflade.js");
const kilde = fs.readFileSync(fil, "utf8");

let ok = 0, fejl = 0;
function tjek(navn, betingelse, detalje) {
  if (betingelse) { ok++; console.log("  OK    " + navn); }
  else { fejl++; console.log("  FEJL  " + navn + (detalje !== undefined ? "  (" + detalje + ")" : "")); }
}

// Et nyt, rent miljoe pr. scenarie. `svar` er en funktion (metode, sti, krop)
// -> { status, data }, saa hvert scenarie selv bestemmer, hvad serveren siger.
function miljoe(svar) {
  const kald = [];
  class FalskFormData {
    constructor() { this.felter = []; }
    append(navn, vaerdi, filnavn) { this.felter.push({ navn, vaerdi, filnavn }); }
  }
  const ctx = {
    FormData: FalskFormData,
    fetch: async (sti, valg) => {
      const krop = valg.body instanceof FalskFormData ? valg.body
        : (valg.body === undefined ? undefined : JSON.parse(valg.body));
      kald.push({ metode: valg.method, sti, krop, headers: valg.headers });
      const s = svar(valg.method, sti, krop) || { status: 200, data: { ok: true } };
      return { ok: s.status >= 200 && s.status < 300, status: s.status, json: async () => s.data };
    },
    Promise, JSON, Map, Set, Object, Array, Error, Math, Number, String, isFinite,
    Date,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(kilde, ctx, { filename: fil });
  return { G: ctx.Graenseflade, kald };
}

(async () => {
  // 1. transskriber(): alle dele i ET kald, i den raekkefoelge, de blev givet.
  try {
    const { G, kald } = miljoe((m, sti) =>
      sti === "/api/tilbud/transskriber" ? { status: 200, data: { ok: true, tekst: "en\n\nto", lydsekunderIAlt: 42 } } : null);
    tjek("transskriber findes", typeof G.transskriber === "function", typeof G.transskriber);
    const r = await G.transskriber([
      { blob: { navn: "A" }, filnavn: "del-1.mp4" },
      { blob: { navn: "B" }, filnavn: "del-2.mp4" },
    ]);
    tjek("transskriber: ét kald", kald.length === 1, kald.length);
    tjek("transskriber: POST til /api/tilbud/transskriber",
      kald[0] && kald[0].metode === "POST" && kald[0].sti === "/api/tilbud/transskriber");
    const felter = kald[0] && kald[0].krop && kald[0].krop.felter || [];
    tjek("transskriber: to felter, begge hedder 'dele'",
      felter.length === 2 && felter.every((f) => f.navn === "dele"), JSON.stringify(felter.map((f) => f.navn)));
    tjek("transskriber: rækkefølgen er bevaret",
      felter.map((f) => f.vaerdi.navn).join("") === "AB", felter.map((f) => f.vaerdi && f.vaerdi.navn).join(""));
    tjek("transskriber: filnavnet går med", felter[0] && felter[0].filnavn === "del-1.mp4");
    tjek("transskriber: Content-Type sættes IKKE (browseren skal skrive grænsen)",
      kald[0] && !("Content-Type" in kald[0].headers), JSON.stringify(kald[0] && kald[0].headers));
    tjek("transskriber: serverens tekst kommer tilbage", r && r.tekst === "en\n\nto", r && r.tekst);
  } catch (e) { tjek("scenarie 1 koerte til ende", false, e.message); }

  // 2. transskriber() uden dele: afvist, foer der ringes.
  try {
    const { G, kald } = miljoe(() => null);
    let afvist = null;
    try { await G.transskriber([]); } catch (e) { afvist = e; }
    tjek("ingen dele: afvist med ingen_lyd", afvist && afvist.kode === "ingen_lyd", afvist ? afvist.kode : "ikke afvist");
    tjek("ingen dele: intet kald", kald.length === 0, kald.length);
  } catch (e) { tjek("scenarie 2 koerte til ende", false, e.message); }

  // 3. saveReferater(): en ny kladde med KUN transskriptionen.
  try {
    const { G, kald } = miljoe((m, sti) => {
      if (m === "GET" && sti === "/api/tilbud/opgaver/op1") return { status: 200, data: { ok: true, referater: [] } };
      if (m === "POST" && sti === "/api/tilbud/referater")
        return { status: 201, data: { ok: true, referat: { id: "ref1", status: "kladde", moede_dato: "2026-10-15" } } };
      return null;
    });
    const liste = await G.loadReferater("op1");
    const nyt = { id: "ny-x", titel: "Noter 15/10", dato: "2026-10-15", status: "kladde",
                  transskript: "OSB-plader på loftet", varighedSek: 41.6 };
    liste.push(nyt);
    await G.saveReferater("op1", liste);
    const post = kald.find((k) => k.metode === "POST");
    tjek("saveReferater: POST til /api/tilbud/referater", !!post);
    const krop = (post && post.krop) || {};
    tjek("saveReferater: lead_id er opgaven", krop.lead_id === "op1", krop.lead_id);
    tjek("saveReferater: transskript sendt uændret", krop.transskript === "OSB-plader på loftet", krop.transskript);
    tjek("saveReferater: intet ai_udkast eller indhold opfundet",
      !("ai_udkast" in krop) && !("indhold" in krop), Object.keys(krop).join(","));
    tjek("saveReferater: varighed rundet til hele sekunder", krop.varighed_sek === 42, krop.varighed_sek);
    tjek("saveReferater: kun felter, serveren kender",
      Object.keys(krop).every((k) => ["lead_id", "titel", "moede_dato", "transskript", "ai_udkast",
        "indhold", "felter", "varighed_sek", "ai_model", "ai_prompt_version"].includes(k)), Object.keys(krop).join(","));
    tjek("saveReferater: serverens id skrives tilbage", nyt.id === "ref1", nyt.id);

    // Gemmes listen igen uaendret, sker der intet.
    const foer = kald.length;
    await G.saveReferater("op1", liste);
    tjek("uændret liste: intet kald", kald.length === foer, kald.length - foer);

    // Rettes titlen, sendes kun titlen -- og aldrig transskript (kan ikke rettes).
    nyt.titel = "Loftet";
    await G.saveReferater("op1", liste);
    const patch = kald.slice(foer).find((k) => k.metode === "PATCH");
    tjek("rettet titel: PATCH /api/tilbud/referater/ref1", patch && patch.sti === "/api/tilbud/referater/ref1", patch && patch.sti);
    tjek("rettet titel: kun titel i kroppen",
      patch && JSON.stringify(Object.keys(patch.krop)) === '["titel"]', patch && JSON.stringify(patch.krop));
  } catch (e) { tjek("scenarie 3 koerte til ende", false, e.message); }

  // 4. En fjernet raekke er en fejl, ikke en tavs sletning.
  try {
    const { G, kald } = miljoe((m, sti) =>
      m === "GET" ? { status: 200, data: { ok: true, referater: [{ id: "r1", titel: "A", status: "kladde" }] } } : null);
    await G.loadReferater("op1");
    let afvist = null;
    try { await G.saveReferater("op1", []); } catch (e) { afvist = e; }
    tjek("fjernet referat: afvist med sletning_findes_ikke",
      afvist && afvist.kode === "sletning_findes_ikke", afvist ? afvist.kode : "ikke afvist");
    tjek("fjernet referat: intet skrivende kald", !kald.some((k) => k.metode !== "GET"));
  } catch (e) { tjek("scenarie 4 koerte til ende", false, e.message); }

  // 5. Serverens afvisning naar frem med serverens besked (fx modulspaerren).
  try {
    const { G } = miljoe(() => ({ status: 403, data: { error: "modul_mangler",
      besked: "Dit abonnement omfatter ikke denne del. Du kan tilføje den under Profil." } }));
    let afvist = null;
    try { await G.hentKvote(); } catch (e) { afvist = e; }
    tjek("hentKvote: 403 kastes som ApiFejl med koden", afvist && afvist.kode === "modul_mangler", afvist ? afvist.kode : "ikke afvist");
    tjek("hentKvote: serverens besked bevaret", afvist && /abonnement/.test(afvist.message), afvist && afvist.message);
  } catch (e) { tjek("scenarie 5 koerte til ende", false, e.message); }

  // 6. S17: filen ligger i tilbud/ og maa ikke indeholde de tre ord.
  tjek("S17: ingen process.env, require( eller prompt", !/process\.env|require\(|prompt/.test(kilde));

  console.log("\n" + ok + "/" + fejl + "\n");
  process.exit(fejl ? 1 : 0);
})().catch((e) => { console.error("Proeven vaeltede:", e); process.exit(2); });
