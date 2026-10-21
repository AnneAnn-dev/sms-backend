// proev-ret-kunde.js — D88 opgave 2 ("Ret kunde"), 21/10-26.
//
//   node proev-ret-kunde.js
//
// To dele, begge uden net og uden database (staar i KOERES i kor-proever.js):
//   A. Modtagerreglen i phone.js (smsModtager / opgavensNummer) som tabeltest.
//   B. PATCH /api/tilbud/kunder/:id fra routes/tilbud/data.js mod en falsk
//      database i hukommelsen: fjern nummer, flyt aabne opgaver, 409/404.
//
// Den falske database efterligner kun det, ruten bruger. Den kan ikke bevise
// noget om RLS eller PostgREST — det goer proev-kunde-telefoner.js og
// proev-datafunktioner.js mod staging. Den beviser LOGIKKEN: hvilke opgaver
// der flyttes, at intet skrives ved 409, og at afsluttede opgaver er uroerte.

"use strict";

const Module = require("module");

// ─── Stubbe: ingen AppSignal, intet rigtigt login ────────────────────────────
const FIRMA_A = "aaaaaaaa-0000-4000-8000-000000000001";
const FIRMA_B = "bbbbbbbb-0000-4000-8000-000000000002";
const rapporteret = [];
const oprindeligLoad = Module._load;
Module._load = function (anmodning, ...resten) {
  if (anmodning === "@appsignal/nodejs") return { sendError: (e) => rapporteret.push(e) };
  if (/(^|\/)auth$/.test(anmodning)) {
    return { firmIdFromToken: async (_sb, req) => (req.headers && req.headers["x-firma"]) || null };
  }
  return oprindeligLoad.call(this, anmodning, ...resten);
};

const { smsModtager, opgavensNummer } = require("./phone");

let bestaaet = 0, fejlet = 0;
function tjek(navn, betingelse, detalje) {
  if (betingelse) { bestaaet++; console.log(`  OK    ${navn}`); }
  else { fejlet++; console.log(`  FEJL  ${navn}${detalje ? "  —  " + detalje : ""}`); }
}
const lig = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ─── A. Modtagerreglen ───────────────────────────────────────────────────────
console.log("\nA. smsModtager / opgavensNummer");
const TABEL = [
  // [leads.telefon, calls.from_number, forventet]
  [null, "+4511111111", { nummer: "+4511111111", kilde: "opkald", grund: null }],
  ["+4522222222", "+4511111111", { nummer: "+4522222222", kilde: "indtastet", grund: null }],
  ["", "+4511111111", { nummer: "+4511111111", kilde: "opkald", grund: null }],
  [null, "+46701234567", { nummer: null, kilde: "opkald", grund: "udenlandsk" }],
  [null, "Manuel oprettelse", { nummer: null, kilde: null, grund: "intet" }],
  [null, "anonymous", { nummer: null, kilde: null, grund: "intet" }],
  [null, "+7378742833", { nummer: null, kilde: null, grund: "intet" }],   // Twilio: skjult nummer
  [null, null, { nummer: null, kilde: null, grund: "intet" }],
  [null, "+451234", { nummer: null, kilde: null, grund: "intet" }],      // dansk, forkert laengde
  ["+4522222222", "+46701234567", { nummer: "+4522222222", kilde: "indtastet", grund: null }],
];
for (const [t, o, forventet] of TABEL) {
  const fik = smsModtager(t, o);
  tjek(`smsModtager(${JSON.stringify(t)}, ${JSON.stringify(o)})`, lig(fik, forventet), JSON.stringify(fik));
}
tjek("opgavensNummer: udenlandsk opkald er stadig opgavens nummer",
  opgavensNummer(null, "+46701234567") === "+46701234567");
tjek("opgavensNummer: indtastet gaar forud", opgavensNummer("+4522222222", "+4511111111") === "+4522222222");

// ─── B. Falsk database ───────────────────────────────────────────────────────
function lavDb() {
  const t = { kunder: [], kunde_telefoner: [], leads: [], calls: [] };
  const skrivninger = [];
  let nr = 0;
  const nytId = () => `00000000-0000-4000-8000-${String(++nr).padStart(12, "0")}`;

  function embed(tabel, raekke, sel) {
    const ud = { ...raekke };
    if (tabel === "kunder" && /kunde_telefoner\(/.test(sel)) {
      ud.kunde_telefoner = t.kunde_telefoner.filter((k) => k.kunde_id === raekke.id)
        .map((k) => ({ telefon: k.telefon, created_at: k.created_at }));
    }
    if (tabel === "leads" && /calls\(/.test(sel)) {
      const c = t.calls.find((c) => c.id === raekke.call_id);
      ud.calls = c ? { from_number: c.from_number } : null;
    }
    return ud;
  }

  function from(tabel) {
    const filtre = [];
    let op = "select", sel = "*", data = null, retur = false;
    const q = {
      select(s) { if (op === "select") sel = s || "*"; else retur = true; return q; },
      eq(k, v) { filtre.push((r) => r[k] === v); return q; },
      in(k, vs) { filtre.push((r) => vs.includes(r[k])); return q; },
      is(k, v) { filtre.push((r) => (r[k] ?? null) === v); return q; },
      order() { return q; },
      limit() { return q; },
      insert(d) { op = "insert"; data = d; return q; },
      update(d) { op = "update"; data = d; return q; },
      delete() { op = "delete"; return q; },
      maybeSingle() { return koer("maybe"); },
      single() { return koer("single"); },
      then(ok, nej) { return koer("mange").then(ok, nej); },
    };
    const match = () => t[tabel].filter((r) => filtre.every((f) => f(r)));
    async function koer(form) {
      if (op === "insert") {
        const r = { id: nytId(), created_at: new Date(Date.now() + nr).toISOString(), ...data };
        if (tabel === "kunde_telefoner" &&
            t.kunde_telefoner.some((k) => k.firm_id === r.firm_id && k.telefon === r.telefon)) {
          return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "kunde_telefoner_firma_telefon_unik"' } };
        }
        t[tabel].push(r); skrivninger.push(["insert", tabel]);
        return { data: form === "mange" ? [r] : r, error: null };
      }
      if (op === "update") {
        if (tabel === "leads" && "telefon" in data && data.telefon !== null && !/^\+45\d{8}$/.test(data.telefon)) {
          return { data: null, error: { code: "23514", message: "leads_telefon_format" } };
        }
        const rs = match(); rs.forEach((r) => Object.assign(r, data));
        if (rs.length) skrivninger.push(["update", tabel, rs.length]);
        if (form === "mange") return { data: retur ? rs.map((r) => ({ id: r.id })) : null, error: null };
        return { data: rs[0] || null, error: null };
      }
      if (op === "delete") {
        const rs = match(); t[tabel] = t[tabel].filter((r) => !rs.includes(r));
        if (rs.length) skrivninger.push(["delete", tabel, rs.length]);
        return { data: null, error: null };
      }
      const rs = match().map((r) => embed(tabel, r, sel));
      if (form === "mange") return { data: rs, error: null };
      if (form === "single" && rs.length !== 1) return { data: null, error: { code: "PGRST116", message: "ikke én" } };
      return { data: rs[0] || null, error: null };
    }
    return q;
  }
  return { t, skrivninger, nytId, from };
}

function lavApp(db) {
  const ruter = {};
  const app = {};
  for (const m of ["get", "post", "patch", "put", "delete"]) app[m] = (sti, ...h) => { ruter[`${m.toUpperCase()} ${sti}`] = h[h.length - 1]; };
  require("./routes/tilbud/data.js")(app, db);
  return async function kald(firma, kundeId, krop) {
    const req = { headers: { "x-firma": firma }, params: { id: kundeId }, body: krop, query: {} };
    let status = 200, svar;
    const res = { status(s) { status = s; return res; }, json(j) { svar = j; return res; } };
    await ruter["PATCH /api/tilbud/kunder/:id"](req, res);
    return { status, svar };
  };
}

// Kunde med to numre og fem opgaver:
//   o1 aaben, fra opkald 11            -> sender til 11
//   o2 aaben, rettet til 11 (indtastet) -> sender til 11
//   o3 aaben, sender til 22
//   o4 AFSLUTTET, fra opkald 11        -> skal vaere uroert
//   o5 aaben, fra udenlandsk opkald    -> sender (ikke) til +46...
// + en kunde i FIRMA_B med nummer 99
function opsaet() {
  const db = lavDb();
  const K = "11111111-0000-4000-8000-00000000000a";
  const KB = "22222222-0000-4000-8000-00000000000b";
  db.t.kunder.push({ id: K, firm_id: FIRMA_A, navn: "Hr. Jensen", arkiveret_at: null });
  db.t.kunder.push({ id: KB, firm_id: FIRMA_B, navn: "Fremmed", arkiveret_at: null });
  db.t.kunde_telefoner.push(
    { firm_id: FIRMA_A, kunde_id: K, telefon: "+4511111111", created_at: "2026-10-01" },
    { firm_id: FIRMA_A, kunde_id: K, telefon: "+4522222222", created_at: "2026-10-02" },
    { firm_id: FIRMA_A, kunde_id: K, telefon: "+46701234567", created_at: "2026-10-03" },
    { firm_id: FIRMA_B, kunde_id: KB, telefon: "+4599999999", created_at: "2026-10-01" },
  );
  db.t.calls.push({ id: "c1", firm_id: FIRMA_A, from_number: "+4511111111" },
                  { id: "c3", firm_id: FIRMA_A, from_number: "+4533333333" },
                  { id: "c4", firm_id: FIRMA_A, from_number: "+4511111111" },
                  { id: "c5", firm_id: FIRMA_A, from_number: "+46701234567" });
  const L = (id, call_id, telefon, status) => ({ id, firm_id: FIRMA_A, kunde_id: K, call_id, telefon, status });
  db.t.leads.push(L("o1", "c1", null, "open"), L("o2", "c3", "+4511111111", "open"),
                  L("o3", null, "+4522222222", "open"), L("o4", "c4", null, "completed"),
                  L("o5", "c5", null, "open"));
  return { db, K, KB, kald: lavApp(db) };
}
const lead = (db, id) => db.t.leads.find((l) => l.id === id);
const numre = (db, K) => db.t.kunde_telefoner.filter((k) => k.kunde_id === K).map((k) => k.telefon).sort();

(async () => {
  console.log("\nB. PATCH /api/tilbud/kunder/:id");

  // 1. Fjern 11 uden valg -> 409, intet skrevet
  { const { db, K, kald } = opsaet();
    const r = await kald(FIRMA_A, K, { fjern_telefon: "11 11 11 11" });
    tjek("fjern nummer, som aabne opgaver bruger, uden valg -> 409 nummer_bruges", r.status === 409 && r.svar.error === "nummer_bruges", JSON.stringify(r));
    tjek("  ... antallet er 2 (o1 fra opkald, o2 indtastet; ikke den afsluttede o4)", r.svar && r.svar.opgaver === 2, r.svar && r.svar.opgaver);
    tjek("  ... og intet er skrevet", db.skrivninger.length === 0, JSON.stringify(db.skrivninger)); }

  // 2. Erstat 11 med nyt nummer 44 -> o1 og o2 sender til 44, o4 uroert, 11 vaek
  { const { db, K, kald } = opsaet();
    const r = await kald(FIRMA_A, K, { telefon: "44444444", fjern_telefon: "+4511111111", opgaver_til: "44444444" });
    tjek("erstat 11 med 44 -> 200", r.status === 200, JSON.stringify(r));
    tjek("  ... opgaver_flyttet = 2", r.svar && r.svar.opgaver_flyttet === 2, r.svar && r.svar.opgaver_flyttet);
    tjek("  ... o1 (fra opkald) og o2 (indtastet) sender nu til 44",
      lead(db, "o1").telefon === "+4544444444" && lead(db, "o2").telefon === "+4544444444");
    tjek("  ... den afsluttede o4 er uroert", lead(db, "o4").telefon === null);
    tjek("  ... o3 (22) og o5 er uroerte", lead(db, "o3").telefon === "+4522222222" && lead(db, "o5").telefon === null);
    tjek("  ... kundens numre: 11 vaek, 44 kommet til", lig(numre(db, K), ["+4522222222", "+4544444444", "+46701234567"]), JSON.stringify(numre(db, K)));
    tjek("  ... svaret har kundens nye numre", r.svar && r.svar.kunde && r.svar.kunde.telefoner.includes("+4544444444") && !r.svar.kunde.telefoner.includes("+4511111111")); }

  // 3. Fjern 11 og flyt til eksisterende 22
  { const { db, K, kald } = opsaet();
    const r = await kald(FIRMA_A, K, { fjern_telefon: "+4511111111", opgaver_til: "+4522222222" });
    tjek("fjern 11, opgaverne til kundens 22 -> 200, 2 flyttet", r.status === 200 && r.svar.opgaver_flyttet === 2, JSON.stringify(r)); }

  // 4. Fjern 11 og behold
  { const { db, K, kald } = opsaet();
    const r = await kald(FIRMA_A, K, { fjern_telefon: "+4511111111", behold_opgaver: true });
    tjek("fjern 11 med behold_opgaver -> 200, 2 beholdt", r.status === 200 && r.svar.opgaver_beholdt === 2 && r.svar.opgaver_flyttet === 0, JSON.stringify(r && r.svar));
    tjek("  ... opgaverne er uroerte", lead(db, "o1").telefon === null && lead(db, "o2").telefon === "+4511111111");
    tjek("  ... 11 er fjernet fra kunden", !numre(db, K).includes("+4511111111")); }

  // 5. Fjern et nummer, ingen aaben opgave bruger -> 200 uden valg
  { const { db, K, kald } = opsaet();
    db.t.leads = db.t.leads.filter((l) => l.id !== "o3");
    const r = await kald(FIRMA_A, K, { fjern_telefon: "+4522222222" });
    tjek("fjern nummer uden aabne opgaver -> 200 uden valg", r.status === 200 && !numre(db, K).includes("+4522222222"), JSON.stringify(r)); }

  // 6. Opkaldsnummeret som nyt maal -> gemmes som null (samme konvention som /lead-telefon)
  { const { db, K, kald } = opsaet();
    // o2 kom fra opkald 33, men er rettet til 11. Flyttes den til 33, er det opkaldets eget nummer.
    db.t.kunde_telefoner.push({ firm_id: FIRMA_A, kunde_id: K, telefon: "+4533333333", created_at: "2026-10-04" });
    const r = await kald(FIRMA_A, K, { fjern_telefon: "+4511111111", opgaver_til: "+4533333333" });
    tjek("flyt til opgavens eget opkaldsnummer -> leads.telefon = null (o2)", r.status === 200 && lead(db, "o2").telefon === null, JSON.stringify(lead(db, "o2")));
    tjek("  ... o1 (opkald 11) faar 33 som indtastet", lead(db, "o1").telefon === "+4533333333"); }

  // 7. Skift modtager uden at fjerne (opgaver_fra)
  { const { db, K, kald } = opsaet();
    const r = await kald(FIRMA_A, K, { opgaver_fra: "+4511111111", opgaver_til: "+4522222222" });
    tjek("opgaver_fra/til uden fjern -> 200, 2 flyttet, 11 bliver paa kunden",
      r.status === 200 && r.svar.opgaver_flyttet === 2 && numre(db, K).includes("+4511111111"), JSON.stringify(r && r.svar)); }

  // 8. Udenlandsk opkald kan flyttes til dansk nummer
  { const { db, K, kald } = opsaet();
    const r = await kald(FIRMA_A, K, { fjern_telefon: "+46701234567", opgaver_til: "+4522222222" });
    tjek("fjern udenlandsk nummer, o5 til 22 -> 200, 1 flyttet", r.status === 200 && r.svar.opgaver_flyttet === 1 && lead(db, "o5").telefon === "+4522222222", JSON.stringify(r && r.svar)); }

  // 9-16. Afvisninger — og intet skrevet ved nogen af dem
  const afvis = [
    ["fremmed kunde -> 404", FIRMA_B, "K", { fjern_telefon: "+4511111111", behold_opgaver: true }, 404, "ikke_fundet"],
    ["nummer, kunden ikke har -> 404 nummer_ikke_fundet", FIRMA_A, "K", { fjern_telefon: "+4599999999", behold_opgaver: true }, 404, "nummer_ikke_fundet"],
    ["opgaver_til en andens nummer -> 400 ikke_kundens_nummer", FIRMA_A, "K", { fjern_telefon: "+4511111111", opgaver_til: "+4599999999" }, 400, "ikke_kundens_nummer"],
    ["opgaver_til udenlandsk -> 400 ikke_sms_nummer", FIRMA_A, "K", { fjern_telefon: "+4511111111", opgaver_til: "+46701234567" }, 400, "ikke_sms_nummer"],
    ["nyt nummer, der er en andens (firma B's 99 er ok; her A's eget) -> 409", FIRMA_A, "K2", { telefon: "+4511111111" }, 409, "nummer_findes"],
    ["tomt telefon -> 400 nummer_kan_ikke_fjernes", FIRMA_A, "K", { telefon: "" }, 400, "nummer_kan_ikke_fjernes"],
    ["til og behold paa een gang -> 400", FIRMA_A, "K", { fjern_telefon: "+4511111111", opgaver_til: "+4522222222", behold_opgaver: true }, 400, "modstridende_valg"],
    ["fjern og brug samme nummer -> 400", FIRMA_A, "K", { fjern_telefon: "+4522222222", opgaver_til: "+4522222222" }, 400, "modstridende_numre"],
    ["opgaver_til uden fra -> 400", FIRMA_A, "K", { opgaver_til: "+4522222222" }, 400, "mangler_opgaver_fra"],
    ["ukendt felt -> 400", FIRMA_A, "K", { fjern_nummer: "+4511111111" }, 400, "ukendte_felter"],
    ["behold_opgaver som tekst -> 400", FIRMA_A, "K", { fjern_telefon: "+4511111111", behold_opgaver: "ja" }, 400, "ugyldigt_felt"],
    ["ugyldigt fjern_telefon -> 400", FIRMA_A, "K", { fjern_telefon: "abc" }, 400, "ugyldigt_nummer"],
  ];
  for (const [navn, firma, hvem, krop, st, kode] of afvis) {
    const { db, K, kald } = opsaet();
    let id = K;
    if (hvem === "K2") {   // en anden kunde i samme firma
      id = "33333333-0000-4000-8000-00000000000c";
      db.t.kunder.push({ id, firm_id: FIRMA_A, navn: "Anden", arkiveret_at: null });
    }
    const r = await kald(firma, id, krop);
    tjek(navn, r.status === st && r.svar && r.svar.error === kode && db.skrivninger.length === 0,
      `${r.status} ${r.svar && r.svar.error} skrivninger=${JSON.stringify(db.skrivninger)}`);
  }

  // 17. Gentaget kald efter afbrud: (2) gjort, (3) ikke -> nyt kald fjerner blot
  { const { db, K, kald } = opsaet();
    lead(db, "o1").telefon = "+4522222222"; lead(db, "o2").telefon = "+4522222222";  // som om (2) naaede igennem
    const r = await kald(FIRMA_A, K, { fjern_telefon: "+4511111111", opgaver_til: "+4522222222" });
    tjek("gentaget kald efter afbrud -> 200, 0 flyttet, 11 fjernet",
      r.status === 200 && r.svar.opgaver_flyttet === 0 && !numre(db, K).includes("+4511111111"), JSON.stringify(r && r.svar)); }

  // 18. Stamdata alene virker som foer
  { const { db, K, kald } = opsaet();
    const r = await kald(FIRMA_A, K, { navn: "Hr. P. Jensen" });
    tjek("ret navn alene -> 200, numre og opgaver uroerte",
      r.status === 200 && db.t.kunder[0].navn === "Hr. P. Jensen" && numre(db, K).length === 3 && lead(db, "o1").telefon === null); }

  tjek("ingen fejl sendt til AppSignal undervejs", rapporteret.length === 0, rapporteret.map((e) => e.message).join("; "));

  console.log(`\n${bestaaet} bestaaet, ${fejlet} fejlet`);
  process.exit(fejlet ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
