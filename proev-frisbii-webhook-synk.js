// proev-frisbii-webhook-synk.js -- proever frisbii-webhook-synk.js (T6) med
// attrapper for synk, alarm og log, plus at frisbii-webhook.js kalder den det
// rigtige sted. Ingen netvaerk, ingen database, ingen miljoevariabler (koeres i
// CI via kor-proever.js).
//
//   node proev-frisbii-webhook-synk.js
//
// Fase 3, T6 (29/10-26). Ren ASCII.
"use strict";

const fs = require("fs");
const path = require("path");
const { efterEvent, alarmVedFejl, KENDTE_EVENTS } = require("./frisbii-webhook-synk");

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  return a === b ? ok(n, a) : nej(n, `fik ${a}, forventede ${b}`);
};

// Attrapper. synk svarer med det givne resultat (eller kaster), og alle kald taelles.
function attrap({ svar, kast, alarmKaster } = {}) {
  const k = { synk: [], alarm: [], log: [], fejl: [] };
  return {
    k,
    synk: async (abonnement) => { k.synk.push(abonnement); if (kast) throw new Error(kast); return svar; },
    alarm: async (b) => { k.alarm.push(b.subject); if (alarmKaster) throw new Error("smtp nede"); },
    log: { log: (...a) => k.log.push(a.join(" ")), error: (...a) => k.fejl.push(a.join(" ")) },
  };
}
const SKREVET = { status: "skrevet", firma: "5bca56b7-xxxx", saet: { moduler: ["telefon"], til: "2026-11-08T09:42:23.632Z", ukendte: [] },
  funktion: { oprettet: [], fornyet: ["telefon"], overtaget: [], afsluttet: [], slettet: [] } };
const UKENDT = { status: "ukendt", firma: "5bca56b7-xxxx", saet: { moduler: ["telefon"], til: "2026-11-08T09:42:23.632Z", ukendte: ["add-on:fase3-maaling-a"] } };
const ev = (event_type, subscription = "sub-0124") => ({ id: "ev1", event_type, subscription });
async function kaster(fn) { try { await fn(); return null; } catch (e) { return e; } }

(async () => {
  console.log("1. Flaget slukket: intet sker");
  let a = attrap({ svar: SKREVET });
  let r = await efterEvent({ body: ev("subscription_changed"), aktiv: false, ...a });
  lig("slukket: ingen synk, ingen alarm, ingen log", [r.handling, a.k.synk.length, a.k.alarm.length, a.k.log.length], ["slukket", 0, 0, 0]);
  a = attrap();
  lig("slukket: alarmVedFejl sender intet", [await alarmVedFejl({ body: ev("invoice_settled"), fejl: new Error("x"), aktiv: false, ...a }), a.k.alarm.length], [false, 0]);

  console.log("\n2. Taendt: alle events med et abonnement synkes");
  for (const t of ["invoice_settled", "subscription_created", "subscription_cancelled", "subscription_expired"]) {
    a = attrap({ svar: SKREVET });
    r = await efterEvent({ body: ev(t), aktiv: true, ...a });
    lig(`${t}: synk kaldt med abonnementet, ingen 'uden egen case'-linje`, [r.handling, a.k.synk, a.k.log.some((l) => l.includes("uden egen case"))], ["skrevet", ["sub-0124"], false]);
  }
  a = attrap({ svar: SKREVET });
  r = await efterEvent({ body: ev("subscription_changed"), aktiv: true, ...a });
  lig("subscription_changed (D92): loglinje OG synk", [r.handling, a.k.synk, a.k.log.some((l) => l.includes("subscription_changed") && l.includes("uden egen case"))], ["skrevet", ["sub-0124"], true]);
  lig("  ... og synk-linjen naevner moduler og aendring", a.k.log.some((l) => l.includes("[telefon]") && l.includes("fornyet telefon")), true);
  a = attrap({ svar: SKREVET });
  r = await efterEvent({ body: { id: "ev2", event_type: "customer_changed" }, aktiv: true, ...a });
  lig("event uden abonnement: loglinje, ingen synk", [r.handling, a.k.synk.length, a.k.log.length], ["intet abonnement", 0, 1]);

  console.log("\n3. Intet firma");
  a = attrap({ svar: { status: "intet firma" } });
  r = await efterEvent({ body: ev("subscription_created", "sub-0122"), aktiv: true, ...a });
  lig("intet firma: ingen alarm, ingen fejl (betalt plan uden trial venter paa invoice_settled)", [r.handling, a.k.alarm.length], ["intet firma", 0]);

  console.log("\n4. Ukendt produkt: alarm + dead-letter, aldrig tomt saet");
  a = attrap({ svar: UKENDT });
  let e = await kaster(() => efterEvent({ body: ev("subscription_changed"), aktiv: true, ...a }));
  lig("ukendt produkt: kaster (webhooken bogfoerer fejl, ikke 'behandlet')", !!e, true);
  lig("  ... en alarm, der naevner produktet", [a.k.alarm.length, a.k.alarm[0] && a.k.alarm[0].includes("ukendt produkt")], [1, true]);
  lig("  ... og catch alarmerer ikke en gang til", [await alarmVedFejl({ body: ev("subscription_changed"), fejl: e, aktiv: true, ...a }), a.k.alarm.length], [false, 1]);
  a = attrap({ svar: UKENDT, alarmKaster: true });
  e = await kaster(() => efterEvent({ body: ev("subscription_changed"), aktiv: true, ...a }));
  lig("alarm-mailen fejler: kaster stadig med den egentlige fejl", [!!e, e && e.message.includes("ukendt produkt")], [true, true]);

  console.log("\n5. Synk fejler: kast + alarm i catch");
  a = attrap({ kast: "synkFirma: GET /subscription/sub-0124/add_on -> 503" });
  e = await kaster(() => efterEvent({ body: ev("invoice_settled"), aktiv: true, ...a }));
  lig("Frisbii nede: kaster, ingen alarm endnu", [!!e, a.k.alarm.length], [true, 0]);
  lig("  ... alarmVedFejl sender en alarm med eventet", [await alarmVedFejl({ body: ev("invoice_settled"), fejl: e, aktiv: true, ...a }), a.k.alarm.length, a.k.alarm[0].includes("invoice_settled")], [true, 1, true]);
  a = attrap({ svar: { status: "toerkoersel" } });
  lig("uventet status (toerkoersel) kaster", !!(await kaster(() => efterEvent({ body: ev("invoice_settled"), aktiv: true, ...a }))), true);

  console.log("\n6. frisbii-webhook.js kalder det rigtige sted");
  const kode = fs.readFileSync(path.join(__dirname, "frisbii-webhook.js"), "utf8");
  const iEfter = kode.indexOf("await efterEvent({"), iProc = kode.indexOf("await markProcessed(body.id)"), iFejl = kode.indexOf("await alarmVedFejl({");
  lig("efterEvent kaldes efter switchen og foer markProcessed", iEfter > kode.indexOf("switch (body.event_type)") && iEfter < iProc, true);
  lig("efterEvent og alarmVedFejl faar aktiv: FASE3_SYNK", (kode.match(/aktiv: FASE3_SYNK/g) || []).length, 2);
  lig("alarmVedFejl kaldes i catch efter markFailed", iFejl > kode.indexOf("await markFailed(body.id"), true);
  lig("synk kaldes med skriv: true", /synkFirma\(\{[^}]*skriv: true/.test(kode), true);
  const cases = [...kode.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]).sort();
  lig("KENDTE_EVENTS = webhookens cases", [...KENDTE_EVENTS].sort(), cases);

  console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
  console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
  process.exit(fejlet ? 1 : 0);
})();
