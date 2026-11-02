// proev-frisbii-nummer.js -- proever frisbii-nummer.js (Fase 3, T7b): hvad der
// sker og siges efter en synk - tildeling med "Dit nummer er klar", tom pulje
// med alarm, fravalg, spoegelser og lav pulje. Falsk database og Twilio i
// hukommelsen; ingen netvaerk, ingen miljoevariabler (koeres i CI).
//
//   node proev-frisbii-nummer.js
//
// 30/10-26. Ren ASCII.
"use strict";

delete process.env.LOW_POOL_THRESHOLD;
delete process.env.QUARANTINE_DAYS_PAID;
const { nummerOgBesked, alarmLavPulje } = require("./frisbii-nummer");

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  return a === b ? ok(n, a) : nej(n, `fik ${a}, forventede ${b}`);
};

function lavDb(start) {
  const t = JSON.parse(JSON.stringify(start));
  function q(tabel) {
    const st = { filtre: [], op: "select" };
    const match = (r) => st.filtre.every((f) => f(r));
    const koer = () => {
      const rows = t[tabel];
      if (st.op === "update") { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, st.v)); return { data: hit.map((r) => ({ ...r })), error: null }; }
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
      update(v) { st.op = "update"; st.v = v; return o; },
      maybeSingle: async () => ({ data: koer().data[0] || null, error: null }),
      then(res, rej) { return Promise.resolve(koer()).then(res, rej); },
    };
    return o;
  }
  return { t, from: q };
}
const twilio = (ejede) => ({ incomingPhoneNumbers: { list: async () => ejede.map((n) => ({ phoneNumber: n })) } });
function deps(db, tw, { mailFejler = false } = {}) {
  const k = { alarm: [], mail: [], log: [] };
  return {
    k,
    supabase: db, twilioClient: tw, loginUrl: "https://x/dashboard",
    alarm: async (b) => { k.alarm.push(b.subject); },
    sendNummerKlar: async (m) => { if (mailFejler) throw new Error("smtp"); k.mail.push(m); return { ok: true }; },
    log: { log: (...a) => k.log.push(a.join(" ")), warn: (...a) => k.log.push(a.join(" ")), error: (...a) => k.log.push(a.join(" ")) },
  };
}
const NU = "2026-10-30T08:00:00.000Z", FREM = "2026-11-08T09:42:23.632Z";
const FIRMA = (nr) => ({ id: "F1", name: "Dortes Dukker", email: "dorte@example.invalid", phone_number: nr, nummer_verificeret_at: null });
const synk = (moduler) => ({ status: "skrevet", firma: "F1", abonnement: "sub-0124", saet: { moduler, til: FREM } });

(async () => {
  console.log("1. Tilkoeb af Telefonpasser");
  let db = lavDb({ firms: [FIRMA(null)], phone_numbers: [{ id: 1, number: "+4511111111", firm_id: null, quarantined_until: null }, { id: 2, number: "+4500000000", firm_id: null, quarantined_until: null }] });
  let d = deps(db, twilio(["+4511111111"]));
  let n = await nummerOgBesked(d, synk(["telefon"]), NU);
  lig("tildelt, og kunden faar 'Dit nummer er klar' med nummeret", [n.status, d.k.mail.map((m) => [m.to, m.phoneNumber, m.firmName])], ["tildelt", [["dorte@example.invalid", "+4511111111", "Dortes Dukker"]]]);
  lig("  ... spoegelse + lav pulje (0 ledige) alarmeres", d.k.alarm.map((a) => a.split(" ")[0]), ["Spoegelsesnumre", "Nummerpulje"]);
  lig("  ... mailSendt = true", n.mailSendt, true);
  d = deps(db, twilio(["+4511111111"]));
  n = await nummerOgBesked(d, synk(["telefon"]), NU);
  lig("igen: 'har' - ingen ny mail, ingen alarm", [n.status, d.k.mail.length, d.k.alarm.length], ["har", 0, 0]);

  console.log("\n2. Tom pulje");
  db = lavDb({ firms: [FIRMA(null)], phone_numbers: [] });
  d = deps(db, twilio([]));
  n = await nummerOgBesked(d, synk(["telefon"]), NU);
  lig("tom: alarm 'venter paa et nummer' med firmanavn, ingen kundemail", [n.status, d.k.alarm, d.k.mail.length], ["tom", ["Nummerpuljen er TOM - Dortes Dukker venter paa et nummer"], 0]);

  console.log("\n3. Mailen fejler");
  db = lavDb({ firms: [FIRMA(null)], phone_numbers: [{ id: 1, number: "+4511111111", firm_id: null, quarantined_until: null }] });
  d = deps(db, twilio(["+4511111111"]), { mailFejler: true });
  n = await nummerOgBesked(d, synk(["telefon"]), NU);
  lig("nummeret ER tildelt, mailSendt = false, intet kast", [n.status, n.mailSendt, db.t.firms[0].phone_number], ["tildelt", false, "+4511111111"]);

  console.log("\n4. Fravalg og ingen telefon");
  db = lavDb({ firms: [FIRMA("+4511111111")], phone_numbers: [{ id: 1, number: "+4511111111", firm_id: "F1", quarantined_until: null }] });
  d = deps(db, null);
  n = await nummerOgBesked(d, synk(["referat"]), NU);
  lig("fravalg: frigivet, loglinje, ingen mail", [n.status, d.k.log.some((l) => l.includes("Telefon fravalgt")), d.k.mail.length], ["frigivet", true, 0]);
  n = await nummerOgBesked(deps(db, null), synk(["referat"]), NU);
  lig("igen: 'ingen telefon'", n.status, "ingen telefon");

  console.log("\n5. alarmLavPulje");
  const d5 = deps(lavDb({ firms: [], phone_numbers: [] }), null);
  lig("4 ledige (graense 3): ingen alarm", await alarmLavPulje(d5, 4), false);
  lig("3 ledige: alarm", await alarmLavPulje(d5, 3), true);

  console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
  console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
  process.exit(fejlet ? 1 : 0);
})();
