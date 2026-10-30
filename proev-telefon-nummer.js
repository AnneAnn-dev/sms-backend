// proev-telefon-nummer.js -- proever telefon-nummer.js (Fase 3, T7a) mod en
// lille falsk database i hukommelsen og en falsk Twilio. Ingen netvaerk, ingen
// database, ingen miljoevariabler (koeres i CI via kor-proever.js).
//
//   node proev-telefon-nummer.js
//
// 30/10-26. Ren ASCII.
"use strict";

delete process.env.QUARANTINE_DAYS_PAID;
const { karantaeneTil, sikrTelefonModul, tildelNummer, frigivNummer, nummerPlan, nummerEfterSynk } = require("./telefon-nummer");

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  return a === b ? ok(n, a) : nej(n, `fik ${a}, forventede ${b}`);
};
async function kaster(fn) { try { await fn(); return null; } catch (e) { return e; } }

// Falsk Supabase: tabeller som arrays. Understoetter det, telefon-nummer.js og
// phone.js bruger: select/eq/is/or(quarantine)/order/limit/maybeSingle,
// update(...).eq/is.select, upsert(ignoreDuplicates).
function lavDb(start, { foerUpdate } = {}) {
  const t = JSON.parse(JSON.stringify(start));
  t.firma_moduler = t.firma_moduler || [];
  function q(tabel) {
    const st = { filtre: [], op: "select" };
    const match = (r) => st.filtre.every((f) => f(r));
    const koer = () => {
      const rows = t[tabel];
      if (st.op === "update") {
        if (foerUpdate) foerUpdate(tabel, st, t);
        const hit = rows.filter(match);
        hit.forEach((r) => Object.assign(r, st.vaerdier));
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      let hit = rows.filter(match);
      if (st.order) hit = hit.slice().sort((a, b) => String(a[st.order]).localeCompare(String(b[st.order])));
      if (st.limit) hit = hit.slice(0, st.limit);
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const o = {
      select() { return o; },
      eq(k, v) { st.filtre.push((r) => r[k] === v); return o; },
      is(k, v) { st.filtre.push((r) => (r[k] ?? null) === v); return o; },
      or(s) { const iso = s.split("lt.")[1]; st.filtre.push((r) => r.quarantined_until == null || r.quarantined_until < iso); return o; },
      order(k) { st.order = k; return o; },
      limit(n) { st.limit = n; return o; },
      update(v) { st.op = "update"; st.vaerdier = v; return o; },
      upsert(raekke) {
        const findes = t[tabel].some((r) => r.firm_id === raekke.firm_id && r.modul === raekke.modul);
        if (!findes) t[tabel].push({ ...raekke });
        return Promise.resolve({ error: null });
      },
      maybeSingle: async () => { const r = koer(); return { data: r.data[0] || null, error: null }; },
      then(res, rej) { return Promise.resolve(koer()).then(res, rej); },
    };
    return o;
  }
  return { t, from: q };
}
const twilio = (ejede) => ({ incomingPhoneNumbers: { list: async () => ejede.map((n) => ({ phoneNumber: n })) } });
const NU = "2026-10-30T08:00:00.000Z";

(async () => {
  console.log("1. Karantaenereglen (D95, Ann 30/10)");
  lig("aldrig verificeret -> ingen karantaene", karantaeneTil({ nummer_verificeret_at: null }, NU, 30), null);
  lig("verificeret -> 30 dage, uanset pris", karantaeneTil({ nummer_verificeret_at: "2026-09-01T00:00:00Z" }, NU, 30), "2026-11-29T08:00:00.000Z");
  lig("dage = 0 -> ingen karantaene", karantaeneTil({ nummer_verificeret_at: "2026-09-01T00:00:00Z" }, NU, 0), null);

  console.log("\n2. sikrTelefonModul (afloeser triggeren firma_faar_telefon)");
  let db = lavDb({ firms: [], phone_numbers: [], firma_moduler: [{ firm_id: "F1", modul: "telefon", kilde: "frisbii" }] });
  await sikrTelefonModul(db, "F2");
  await sikrTelefonModul(db, "F2");
  await sikrTelefonModul(db, "F1");
  lig("nyt firma faar en 'auto'-raekke, kun en", db.t.firma_moduler.filter((r) => r.firm_id === "F2"), [{ firm_id: "F2", modul: "telefon", kilde: "auto" }]);
  lig("eksisterende raekke roeres ikke (frisbii forbliver frisbii)", db.t.firma_moduler.find((r) => r.firm_id === "F1").kilde, "frisbii");

  console.log("\n3. tildelNummer");
  const pulje = () => [
    { id: 1, number: "+4511111111", firm_id: null, quarantined_until: null },
    { id: 2, number: "+4522222222", firm_id: null, quarantined_until: "2026-12-01T00:00:00Z" }, // karantaene
    { id: 3, number: "+4533333333", firm_id: null, quarantined_until: null },
  ];
  db = lavDb({ firms: [{ id: "F1", phone_number: null, nummer_verificeret_at: null }], phone_numbers: pulje() });
  let r = await tildelNummer({ supabase: db, twilioClient: twilio(["+4511111111", "+4522222222", "+4533333333"]), firmId: "F1" });
  lig("ledigt nummer: tildelt, begge registreringer sat", [r.status, r.nummer, db.t.firms[0].phone_number, db.t.phone_numbers[0].firm_id], ["tildelt", "+4511111111", "+4511111111", "F1"]);
  r = await tildelNummer({ supabase: db, twilioClient: twilio(["+4511111111", "+4533333333"]), firmId: "F1" });
  lig("anden koersel: 'har', intet nyt nummer taget", [r.status, db.t.phone_numbers.filter((p) => p.firm_id === "F1").length], ["har", 1]);
  db = lavDb({ firms: [{ id: "F1", phone_number: null }], phone_numbers: pulje() });
  r = await tildelNummer({ supabase: db, twilioClient: twilio(["+4522222222", "+4533333333"]), firmId: "F1" });
  lig("spoegelse og karantaene springes over", [r.status, r.nummer, r.spoegelser], ["tildelt", "+4533333333", ["+4511111111"]]);
  db = lavDb({ firms: [{ id: "F1", phone_number: null }], phone_numbers: [{ id: 2, number: "+4522222222", firm_id: null, quarantined_until: "2026-12-01T00:00:00Z" }] });
  r = await tildelNummer({ supabase: db, twilioClient: twilio(["+4522222222"]), firmId: "F1" });
  lig("kun karantaene-numre: 'tom', ingen undtagelse, intet skrevet", [r.status, db.t.firms[0].phone_number], ["tom", null]);
  // Kaploeb: en anden tager nummer 1, lige foer vores update.
  let snydt = false;
  db = lavDb({ firms: [{ id: "F1", phone_number: null }, { id: "F9", phone_number: null }], phone_numbers: pulje() }, {
    foerUpdate: (tabel, st, t) => { if (tabel === "phone_numbers" && !snydt) { snydt = true; t.phone_numbers[0].firm_id = "F9"; } },
  });
  r = await tildelNummer({ supabase: db, twilioClient: twilio(["+4511111111", "+4533333333"]), firmId: "F1" });
  lig("kaploeb om puljeraekken: taber proever naeste, ingen dobbelt-tildeling", [r.status, r.nummer, db.t.phone_numbers[0].firm_id], ["tildelt", "+4533333333", "F9"]);
  const e = await kaster(() => tildelNummer({ supabase: lavDb({ firms: [{ id: "F1", phone_number: null }], phone_numbers: pulje() }),
    twilioClient: { incomingPhoneNumbers: { list: async () => { throw new Error("Twilio nede"); } } }, firmId: "F1" }));
  lig("Twilio kan ikke spoerges: kaster (aldrig et uverificeret nummer)", !!e, true);

  console.log("\n4. frigivNummer");
  db = lavDb({ firms: [{ id: "F1", phone_number: "+4511111111", nummer_verificeret_at: "2026-09-01T00:00:00Z" }],
    phone_numbers: [{ id: 1, number: "+4511111111", firm_id: "F1", quarantined_until: null, last_firm_id: null }] });
  r = await frigivNummer({ supabase: db, firmId: "F1", nu: NU });
  lig("verificeret (fx DB Toemrer, 0 kr.): karantaene 30 dage", [r.status, r.karantaeneTil, db.t.phone_numbers[0].quarantined_until], ["frigivet", "2026-11-29T08:00:00.000Z", "2026-11-29T08:00:00.000Z"]);
  lig("  ... begge registreringer ryddet, last_firm_id gemt", [db.t.firms[0].phone_number, db.t.phone_numbers[0].firm_id, db.t.phone_numbers[0].last_firm_id], [null, null, "F1"]);
  r = await frigivNummer({ supabase: db, firmId: "F1", nu: NU });
  lig("anden koersel: 'intet', karantaenen roeres ikke", [r.status, db.t.phone_numbers[0].quarantined_until], ["intet", "2026-11-29T08:00:00.000Z"]);
  db = lavDb({ firms: [{ id: "F1", phone_number: "+4511111111", nummer_verificeret_at: null }],
    phone_numbers: [{ id: 1, number: "+4511111111", firm_id: "F1", quarantined_until: null }] });
  r = await frigivNummer({ supabase: db, firmId: "F1", nu: NU });
  lig("aldrig verificeret: frigives straks", [r.status, db.t.phone_numbers[0].quarantined_until], ["frigivet", null]);
  db = lavDb({ firms: [{ id: "F1", phone_number: null, nummer_verificeret_at: null }],
    phone_numbers: [{ id: 1, number: "+4511111111", firm_id: "F1", quarantined_until: null }] });
  r = await frigivNummer({ supabase: db, firmId: "F1", nu: NU });
  lig("halv registrering (kun puljeraekken): ryddes alligevel", [r.status, r.nummer, db.t.phone_numbers[0].firm_id], ["frigivet", "+4511111111", null]);
  lig("ukendt firma: kaster", !!(await kaster(() => frigivNummer({ supabase: lavDb({ firms: [], phone_numbers: [] }), firmId: "X" }))), true);

  console.log("\n5. nummerPlan og nummerEfterSynk (T7b)");
  const S = (moduler, til) => ({ moduler, til });
  const FREM = "2026-11-08T09:42:23.632Z", FORBI = "2026-10-29T00:00:00.000Z";
  lig("koebt + aktiv + intet nummer -> tildel", nummerPlan({ saet: S(["telefon"], FREM), harNummer: false, nu: NU }), "tildel");
  lig("koebt + aktiv + har nummer -> intet", nummerPlan({ saet: S(["telefon", "referat"], FREM), harNummer: true, nu: NU }), "intet");
  lig("koebt, respit gaaet (rykker) -> behold (beslutning 2, 28/10)", nummerPlan({ saet: S(["telefon"], FORBI), harNummer: true, nu: NU }), "behold");
  lig("ikke koebt + har nummer -> frigiv", nummerPlan({ saet: S(["referat"], FREM), harNummer: true, nu: NU }), "frigiv");
  lig("ikke koebt + intet nummer -> intet", nummerPlan({ saet: S(["referat"], FREM), harNummer: false, nu: NU }), "intet");
  lig("intet saet (fejl) -> aldrig tildel", nummerPlan({ saet: null, harNummer: false, nu: NU }), "intet");
  db = lavDb({ firms: [{ id: "F1", phone_number: null }], phone_numbers: pulje() });
  r = await nummerEfterSynk({ supabase: db, twilioClient: twilio(["+4511111111"]), firmId: "F1", saet: S(["telefon"], FREM), nu: NU });
  lig("tilkoeb: nummer tildelt", [r.status, db.t.firms[0].phone_number], ["tildelt", "+4511111111"]);
  db = lavDb({ firms: [{ id: "F1", phone_number: "+4511111111", nummer_verificeret_at: null }], phone_numbers: [{ id: 1, number: "+4511111111", firm_id: "F1" }] });
  r = await nummerEfterSynk({ supabase: db, twilioClient: null, firmId: "F1", saet: S(["telefon"], FORBI), nu: NU });
  lig("rykker: nummeret beholdes, intet roeres", [r.status, db.t.firms[0].phone_number], ["beholdt", "+4511111111"]);
  r = await nummerEfterSynk({ supabase: db, twilioClient: null, firmId: "F1", saet: S(["referat"], FREM), nu: NU });
  lig("fravalg: nummeret frigives straks (aldrig verificeret)", [r.status, db.t.firms[0].phone_number, db.t.phone_numbers[0].quarantined_until], ["frigivet", null, null]);
  r = await nummerEfterSynk({ supabase: db, twilioClient: null, firmId: "F1", saet: S(["referat"], FREM), nu: NU });
  lig("igen: 'ingen telefon'", r.status, "ingen telefon");

  console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
  console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
  process.exit(fejlet ? 1 : 0);
})();
