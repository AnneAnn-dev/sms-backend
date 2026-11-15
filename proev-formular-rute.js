// proev-formular-rute.js -- D2, proeve 3 af 3: kundens formular bliver til en
// opgave hos det rigtige firma.
//
//   node proev-formular-rute.js
//
// HVAD DER SKAL VAERE SANDT (Ann, 31/10-26):
//   Naar kunden sender formularen, gemmes PRAECIS EN opgave hos det firma,
//   opkaldet gik til - uanset hvad formularen selv indeholder - og billederne
//   gemmes paa den opgave.
//
// HVORFOR: det er sidste led i kerneflowet (opkald -> SMS -> formular ->
// opgave). Billeduploaden var engang aldrig koblet til storage, og ingen
// opdagede det (Aa1). Og firm_id er hele tenant-isolationen paa en opgave:
// kommer den fra formularen i stedet for fra opkaldet, kan en fremmed laegge
// opgaver hos et andet firma.
//
// Bevidst tynd. formular-rute.js monteres paa en tom Express-app med en
// falsk database og et falsk storage i hukommelsen; der kaldes over rigtig
// HTTP med rigtig multipart, saa multer og billedgraenserne er med. Ingen
// .env, intet netvaerk (global fetch kaster). Koeres i CI via kor-proever.js.
// Graenserne i detaljer: proev-formular-graenser.js og -udloeb.js.
//
// D2 T3, 2/11-26. Ren ASCII.
"use strict";

process.env.FORMULAR_ENGANGS_AKTIV = "true";
process.env.FORMULAR_UDLOEB_AKTIV = "true";
delete process.env.KUNDE_MATCH_AKTIV;

const http = require("http");
const crypto = require("crypto");
const express = require("express");

const netForsoeg = [];
global.fetch = async (url) => { netForsoeg.push(String(url)); throw new Error("proeve: netvaerk spaerret"); };

// --- Falsk database og storage ----------------------------------------------
function lavDb(start, { leadFejl = false } = {}) {
  const t = JSON.parse(JSON.stringify(start));
  for (const k of ["calls", "leads", "lead_images", "firms", "push_subscriptions"]) t[k] = t[k] || [];
  const uploads = [];
  function q(tabel) {
    const st = { op: "select", filtre: [], head: false };
    const match = (r) => st.filtre.every((f) => f(r));
    const koer = () => {
      const rows = t[tabel];
      if (st.op === "insert") {
        if (tabel === "leads" && leadFejl) return { data: null, error: { code: "23502", message: "proeve: indsaettelse fejlede" } };
        const r = { id: crypto.randomUUID(), ...st.vaerdier };
        rows.push(r);
        return { data: [{ ...r }], error: null };
      }
      if (st.op === "update") {
        const hit = rows.filter(match);
        hit.forEach((r) => Object.assign(r, st.vaerdier));
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      const hit = rows.filter(match);
      return st.head ? { data: null, count: hit.length, error: null } : { data: hit.map((r) => ({ ...r })), error: null };
    };
    const o = {
      select(_k, opt) { if (opt && opt.head) st.head = true; return o; },
      eq(k, v) { st.filtre.push((r) => r[k] === v); return o; },
      is(k, v) { st.filtre.push((r) => (r[k] ?? null) === v); return o; },
      insert(v) { st.op = "insert"; st.vaerdier = v; return o; },
      update(v) { st.op = "update"; st.vaerdier = v; return o; },
      single: async () => { const r = koer(); return r.error ? r : { data: r.data[0] || null, error: r.data.length === 1 ? null : { code: "PGRST116" } }; },
      maybeSingle: async () => { const r = koer(); return { data: (r.data || [])[0] || null, error: r.error }; },
      then(res, rej) { return Promise.resolve(koer()).then(res, rej); },
    };
    return o;
  }
  const storage = { from: () => ({
    upload: async (sti, buf) => { uploads.push({ sti, bytes: buf.length }); return { error: null }; },
    getPublicUrl: (sti) => ({ data: { publicUrl: "https://lager.eksempel.dk/lead-images/" + sti } }),
  }) };
  return { t, uploads, from: q, storage };
}

// --- To firmaer og deres opkald ---------------------------------------------
const NU = new Date().toISOString();
const NI_DAGE_SIDEN = new Date(Date.now() - 9 * 86400000).toISOString();
const start = () => ({
  firms: [{ id: "firma-a", name: "Jensens Toemrer", owner_phone: "+4530000001" },
          { id: "firma-b", name: "Hansen VVS", owner_phone: "+4530000002" }],
  calls: [
    { id: "call-a", firm_id: "firma-a", from_number: "+4540000099", lead_token: "tokenAAAAAAA", created_at: NU, formular_brugt_at: null, status: null },
    { id: "call-gammel", firm_id: "firma-a", from_number: "+4540000098", lead_token: "tokenGAMMEL1", created_at: NI_DAGE_SIDEN, formular_brugt_at: null, status: null },
  ],
});

// --- Rammen -----------------------------------------------------------------
let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d !== undefined ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  return a === b ? ok(n, a) : nej(n, `fik ${a}, forventede ${b}`);
};

function byg(data, opt) {
  const db = lavDb(data, opt);
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  require("./formular-rute")(app, db);
  return new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok({ db, s, port: s.address().port })); });
}

// Multipart som en browser sender den. filer: [{ navn, type, bytes }]
function send({ port }, token, felter, filer = []) {
  const graense = "----proeve" + crypto.randomBytes(8).toString("hex");
  const dele = [];
  for (const [k, v] of Object.entries(felter)) {
    dele.push(Buffer.from(`--${graense}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of filer) {
    dele.push(Buffer.from(`--${graense}\r\nContent-Disposition: form-data; name="billeder"; filename="${f.navn}"\r\nContent-Type: ${f.type}\r\n\r\n`));
    dele.push(Buffer.alloc(f.bytes || 10, 1), Buffer.from("\r\n"));
  }
  dele.push(Buffer.from(`--${graense}--\r\n`));
  const krop = Buffer.concat(dele);
  return new Promise((ok, fejl) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/formular/" + token, method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=" + graense, "Content-Length": krop.length } }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => ok({ status: res.statusCode, body: d }));
    });
    req.on("error", fejl); req.end(krop);
  });
}

const FELTER = { navn: "Kunde Kundesen", vej: "", postnr: "", by: "", opgave: "Utaet tag over koekkenet", titel: "  Utaet   tag  " };
const PNG = { navn: "tag.png", type: "image/png", bytes: 200 };

(async () => {
  let m, r;

  console.log("1. En gyldig formular - selv med andre firmaers id'er i formularen");
  m = await byg(start());
  r = await send(m, "tokenAAAAAAA", { ...FELTER, firm_id: "firma-b", call_id: "call-x", kunde_id: "k-fremmed" },
    [PNG, PNG, { navn: "faktura.pdf", type: "application/pdf" }]);
  const leads = m.db.t.leads;
  lig("svar 200 med kvittering", [r.status, r.body.includes("Tak for din besked")], [200, true]);
  lig("praecis en opgave", leads.length, 1);
  const lead = leads[0] || {};
  lig("hos det firma, opkaldet gik til - ikke formularens", lead.firm_id, "firma-a");
  lig("knyttet til opkaldet", lead.call_id, "call-a");
  lig("formularens kunde_id er ignoreret", lead.kunde_id, undefined);
  lig("tom adresse gemmes som '' (NOT NULL)", lead.address, "");
  lig("overskriften er renset", lead.titel, "Utaet tag");
  lig("to billeder paa opgaven", m.db.t.lead_images.map((b) => b.lead_id), [lead.id, lead.id]);
  lig("og i storage under opgavens mappe", m.db.uploads.map((u) => u.sti.split("/")[0]), [lead.id, lead.id]);
  lig("pdf'en kom ikke med - og kunden faar det at vide", r.body.includes("\u00c9n fil kom ikke med"), true);
  lig("opkaldet er afsluttet og linket brugt", [m.db.t.calls[0].status, !!m.db.t.calls[0].formular_brugt_at], ["completed", true]);

  console.log("\n2. Samme link igen");
  r = await send(m, "tokenAAAAAAA", FELTER);
  lig("410, stadig kun en opgave", [r.status, m.db.t.leads.length], [410, 1]);
  m.s.close();

  console.log("\n3. Ukendt og udloebet link");
  m = await byg(start());
  r = await send(m, "tokenFINDESIK", FELTER);
  lig("ukendt: 404, ingen opgave", [r.status, m.db.t.leads.length], [404, 0]);
  r = await send(m, "tokenGAMMEL1", FELTER);
  lig("udloebet: 410, ingen opgave, linket ikke taget i brug", [r.status, m.db.t.leads.length, m.db.t.calls[1].formular_brugt_at], [410, 0, null]);
  m.s.close();

  console.log("\n4. For mange billeder");
  m = await byg(start());
  r = await send(m, "tokenAAAAAAA", FELTER, [PNG, PNG, PNG, PNG, PNG, PNG]);
  lig("413, ingen opgave, linket kan bruges igen", [r.status, m.db.t.leads.length, m.db.t.calls[0].formular_brugt_at], [413, 0, null]);
  m.s.close();

  console.log("\n5. Databasen fejler");
  m = await byg(start(), { leadFejl: true });
  r = await send(m, "tokenAAAAAAA", FELTER);
  lig("500, ingen opgave, linket givet tilbage", [r.status, m.db.t.leads.length, m.db.t.calls[0].formular_brugt_at], [500, 0, null]);
  m.s.close();

  console.log("\n6. Intet forlod maskinen");
  lig("ingen netvaerkskald", netForsoeg, []);

  console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
  console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
  process.exit(fejlet ? 1 : 0);
})().catch((e) => { console.error("PROEVEN SELV FEJLEDE:", e); process.exit(1); });
