// proev-frisbii-kunde.js -- proever frisbii-kunde.js (Fase 3, T8a: samme firma
// hele vejen, D91) mod en lille falsk database og en falsk Supabase Auth.
// Ingen netvaerk, ingen database, ingen miljoevariabler (koeres i CI via
// kor-proever.js).
//
//   node proev-frisbii-kunde.js
//
// 31/10-26. Ren ASCII.
"use strict";

const { kundeBeslutning, firmaerMedEmail, findAuthBrugerId, sikrLogin, genoplivFirma, alarmTekst } = require("./frisbii-kunde");

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  return a === b ? ok(n, a) : nej(n, `fik ${a}, forventede ${b}`);
};
async function kaster(fn) { try { await fn(); return null; } catch (e) { return e; } }

// Falsk Supabase: tabeller som arrays + auth.admin med en brugerliste.
function lavDb(start, { brugere = [], createFejl = null } = {}) {
  const t = JSON.parse(JSON.stringify(start));
  t.firm_users = t.firm_users || [];
  const log = { ilike: null, listSider: 0 };
  function q(tabel) {
    const st = { filtre: [], op: "select" };
    const match = (r) => st.filtre.every((f) => f(r));
    const koer = () => {
      const rows = t[tabel];
      if (st.op === "insert") { rows.push({ ...st.v }); return { data: [{ ...st.v }], error: null }; }
      const hit = rows.filter(match);
      if (st.op === "update") { hit.forEach((r) => Object.assign(r, st.v)); }
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const o = {
      select() { return o; },
      eq(k, v) { st.filtre.push((r) => r[k] === v); return o; },
      ilike(k, m) {
        log.ilike = m;
        const ren = m.replace(/\\([\\%_])/g, "$1").toLowerCase();
        st.filtre.push((r) => String(r[k] || "").toLowerCase() === ren);
        return o;
      },
      update(v) { st.op = "update"; st.v = v; return o; },
      insert(v) { st.op = "insert"; st.v = v; return o; },
      maybeSingle: async () => { const r = koer(); return { data: r.data[0] || null, error: null }; },
      then(res, rej) { return Promise.resolve(koer()).then(res, rej); },
    };
    return o;
  }
  const auth = { admin: {
    createUser: async ({ email }) => {
      if (createFejl) return { data: null, error: createFejl };
      if (brugere.some((u) => u.email.toLowerCase() === email)) return { data: null, error: { code: "email_exists", message: "already registered" } };
      const u = { id: "U-ny", email }; brugere.push(u); return { data: { user: u }, error: null };
    },
    listUsers: async ({ page, perPage }) => { log.listSider++; return { data: { users: brugere.slice((page - 1) * perPage, page * perPage) }, error: null }; },
  } };
  return { t, log, from: q, auth };
}

(async () => {
  console.log("1. kundeBeslutning (Anns beslutninger 31/10)");
  const B = (firmaer, abonnement = "sub-9") => kundeBeslutning({ firmaer, abonnement }).handling;
  lig("ingen firmaer -> ny", B([]), "ny");
  lig("abonnementet har allerede et firma -> behandlet", B([{ id: "F1", status: "onboarding", frisbii_subscription: "sub-9" }]), "behandlet");
  lig("behandlet vinder, ogsaa med flere firmaer", B([{ id: "F1", status: "inactive", frisbii_subscription: "sub-1" }, { id: "F2", status: "active", frisbii_subscription: "sub-9" }]), "behandlet");
  lig("udloebet firma -> genopliv (2)", B([{ id: "F1", status: "inactive", frisbii_subscription: "sub-1" }]), "genopliv");
  lig("aktivt abonnement -> koerer (1)", B([{ id: "F1", status: "active", frisbii_subscription: "sub-1" }]), "koerer");
  lig("opsagt, men ikke udloebet -> koerer (1)", B([{ id: "F1", status: "active", billing_status: "cancelled", frisbii_subscription: "sub-1" }]), "koerer");
  lig("pilot uden abonnement -> pilot", B([{ id: "F1", status: "active", frisbii_subscription: null }]), "pilot");
  lig("flere firmaer -> flere", B([{ id: "F1", status: "inactive", frisbii_subscription: "sub-1" }, { id: "F2", status: "inactive", frisbii_subscription: "sub-2" }]), "flere");

  console.log("\n2. firmaerMedEmail");
  let db = lavDb({ firms: [{ id: "F1", email: "Anne_Ann@Firma.dk" }, { id: "F2", email: "anneXann@firma.dk" }] });
  let f = await firmaerMedEmail(db, "anne_ann@firma.dk");
  lig("store/smaa bogstaver skiller ikke; _ er et tegn, ikke et joker", f.map((x) => x.id), ["F1"]);
  lig("moenstret er escapet", db.log.ilike, "anne\\_ann@firma.dk");

  console.log("\n3. sikrLogin (D91-roden: firm_users)");
  db = lavDb({ firm_users: [] });
  let l = await sikrLogin({ supabase: db, firmId: "F1", email: "ny@firma.dk", firmName: "Ny" });
  lig("ny kunde: ny bruger og kobling", [l.nyBruger, l.nyKobling, db.t.firm_users], [true, true, [{ firm_id: "F1", user_id: "U-ny", role: "owner" }]]);
  const mange = Array.from({ length: 450 }, (_, i) => ({ id: "U" + i, email: `k${i}@x.dk` }));
  db = lavDb({ firm_users: [] }, { brugere: mange });
  l = await sikrLogin({ supabase: db, firmId: "F2", email: "k420@x.dk", firmName: "K" });
  lig("login findes (side 3): koblet til firmaet, ingen ny bruger", [l.userId, l.nyBruger, l.nyKobling, db.log.listSider], ["U420", false, true, 3]);
  l = await sikrLogin({ supabase: db, firmId: "F2", email: "k420@x.dk", firmName: "K" });
  lig("anden gang: ingen dobbelt-kobling", [l.nyKobling, db.t.firm_users.length], [false, 1]);
  db = lavDb({}, { createFejl: { code: "unexpected_failure", message: "Auth nede" } });
  let e = await kaster(() => sikrLogin({ supabase: db, firmId: "F1", email: "a@b.dk", firmName: "A" }));
  lig("anden Auth-fejl: kaster (kalderen alarmerer)", e && /Auth nede/.test(e.message), true);
  lig("findAuthBrugerId: ukendt e-mail -> null", await findAuthBrugerId(lavDb({}, { brugere: mange }), "nej@x.dk"), null);

  console.log("\n4. genoplivFirma");
  const synk = (moduler) => async () => ({ status: "skrevet", saet: { moduler, til: "2026-12-01T00:00:00Z" } });
  const num = (svar) => async () => svar;
  const start = (ekstra = {}) => ({ firms: [{ id: "F1", name: "Mogens Maler", status: "inactive", billing_status: "expired",
    frisbii_subscription: "sub-1", frisbii_customer: "c-1", nummer_verificeret_at: "2026-09-01T00:00:00Z", verification_status: "verified", ...ekstra }] });
  const deps = (db, moduler, n) => ({ supabase: db, twilioClient: {}, hent: null, synkFirma: synk(moduler), nummerEfterSynk: num(n), log: { log() {} }, nu: "2026-10-31T10:00:00.000Z" });
  const arg = { firma: { id: "F1", name: "Mogens Maler" }, abonnement: "sub-9", kundeHandle: "c-9" };

  db = lavDb(start());
  let g = await genoplivFirma(deps(db, ["telefon"], { status: "tildelt", nummer: "+4577777777", egetNummer: true }), arg);
  const F = () => db.t.firms[0];
  lig("eget nummer tilbage: aktiv med det samme, nyt abonnement paa firmaet",
    [g.status, g.aktiv, g.egetNummer, F().status, F().frisbii_subscription, F().frisbii_customer, F().billing_status, F().verification_status],
    ["genoplivet", true, true, "active", "sub-9", "c-9", "active", "verified"]);
  db = lavDb(start());
  g = await genoplivFirma(deps(db, ["telefon", "referat"], { status: "tildelt", nummer: "+4511111111" }), arg);
  lig("nyt nummer: onboarding igen, verifikation venter", [g.aktiv, g.egetNummer, F().status, F().verification_status], [false, false, "onboarding", "pending"]);
  db = lavDb(start({ nummer_verificeret_at: null }));
  g = await genoplivFirma(deps(db, ["telefon"], { status: "tildelt", nummer: "+4577777777", egetNummer: true }), arg);
  lig("eget nummer, men aldrig verificeret: onboarding", [g.aktiv, F().status], [false, "onboarding"]);
  db = lavDb(start());
  g = await genoplivFirma(deps(db, ["telefon"], { status: "tom", nummer: null }), arg);
  lig("puljen tom: onboarding, venter", [g.aktiv, g.venter, g.nummer, F().status], [false, true, null, "onboarding"]);
  db = lavDb(start());
  g = await genoplivFirma(deps(db, ["referat"], { status: "ingen telefon", nummer: null }), arg);
  lig("uden Telefonpasser: aktiv med det samme", [g.aktiv, F().status, g.moduler], [true, "active", ["referat"]]);
  db = lavDb(start());
  g = await genoplivFirma({ ...deps(db, [], {}), synkFirma: async () => ({ status: "ukendt" }) }, arg);
  lig("ukendt produkt: ikke aktiv (efterEvent giver dead-letter + alarm)", [g.status, g.aktiv, F().status], ["genoplivet", false, "onboarding"]);
  db = lavDb(start({ status: "onboarding", frisbii_subscription: "sub-9" }));
  g = await genoplivFirma(deps(db, ["telefon"], { status: "har" }), arg);
  lig("firmaet er ikke laengere udloebet (parallelt event): race, intet roert", [g.status, F().status], ["race", "onboarding"]);

  console.log("\n5. alarmTekst");
  const firma = { id: "F1abcdef-0", name: "Mogens Maler", frisbii_subscription: "sub-1" };
  const a1 = alarmTekst("koerer", { abonnement: "sub-9", firma, mailMaskeret: "mo***@x.dk" });
  lig("koerer: begge abonnementer naevnt, intet nyt firma", [/sub-9/.test(a1.text), /sub-1/.test(a1.text), /IKKE oprettet/.test(a1.text)], [true, true, true]);
  const a2 = alarmTekst("pilot", { abonnement: "sub-9", firma: { ...firma, frisbii_subscription: null }, mailMaskeret: "mo***@x.dk" });
  lig("pilot: siger hvorfor den ikke kobles", /frigive pilotens nummer/.test(a2.text), true);
  const a3 = alarmTekst("flere", { abonnement: "sub-9", firmaer: [firma, { id: "F2", status: "inactive" }], mailMaskeret: "mo***@x.dk" });
  lig("flere: lister firmaerne og siger dead-letter", [/2 firmaer/.test(a3.text), /dead-letter/.test(a3.text)], [true, true]);
  lig("ingen fuld e-mail i alarmerne", [a1, a2, a3].some((a) => /@x\.dk/.test(a.text) && !/mo\*\*\*@x\.dk/.test(a.text)), false);

  console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
  console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
  process.exit(fejlet ? 1 : 0);
})();
