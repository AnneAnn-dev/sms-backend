// proev-opkald.js -- D2, proeve 1 af 3: kerneflowet opkald -> TwiML -> SMS.
//
//   node proev-opkald.js
//
// HVAD DER SKAL VAERE SANDT (Ann, 31/10-26):
//   Naar en kunde ringer til et aktivt firmas nummer, faar kunden PRAECIS EN
//   SMS fra firmaets nummer med et link til firmaets egen formular, og Twilio
//   faar firmaets egen hilsen tilbage. Et ukendt nummer, et hvidlistet nummer
//   eller et kald uden gyldig Twilio-signatur giver INGEN SMS.
//
// HVORFOR: det er den vej, produktet lever af, og den vej, D2 blev skrevet
// til. Aarsag Aa1 i registret - "Lomme Kontor" i TwiML og SMS-fejlen - blev
// begge fundet af mennesker. Denne proeve fanger dem foer deploy.
//
// SADAN VIRKER DEN: onboarding.js monteres paa en tom Express-app med en
// falsk database (tabeller som arrays i hukommelsen) og en falsk Twilio.
// Der kaldes rigtigt over HTTP paa 127.0.0.1, med en rigtig Twilio-signatur
// regnet med en test-noegle - saa signaturkontrollen proeves, som den er.
//
// INTET NETVAERK UD AF MASKINEN: Twilio-klientens messages/calls er erstattet,
// og global fetch kaster (mail.js bruger fetch til Scaleway). Ingen .env
// laeses - proeven saetter selv de faa variabler, den skal bruge. Lokalt
// groent er derfor det samme som groent i CI. Koeres i CI via kor-proever.js.
//
// D2, 31/10-26. Ren ASCII.
"use strict";

// --- Miljoeet: kun proevens egne, falske vaerdier ---------------------------
const TEST_TOKEN = "proeve-auth-token-ikke-en-rigtig-noegle";
const BASE = "https://opgave.eksempel.dk";
const SYSTEMNUMMER = "+4570000000";
process.env.TWILIO_ACCOUNT_SID = "AC" + "0".repeat(32);
process.env.TWILIO_AUTH_TOKEN = TEST_TOKEN;
process.env.TWILIO_SYSTEM_NUMBER = SYSTEMNUMMER;
process.env.BASE_URL = BASE + "/";   // med skraastreg: onboarding.js skal fjerne den

const http = require("http");
const path = require("path");
const express = require("express");
const twilio = require("twilio");

// --- Spaerre for netvaerk ---------------------------------------------------
const netForsoeg = [];
global.fetch = async (url) => { netForsoeg.push(String(url)); throw new Error("proeve: netvaerk spaerret"); };

// --- Falsk Twilio: messages.create og calls.create optages ------------------
let sendt = [];            // { to, from, body }
let smsFejler = false;
Object.defineProperty(twilio.Twilio.prototype, "messages", {
  configurable: true,
  get() {
    return { create: async (m) => {
      if (smsFejler) { const e = new Error("proeve: Twilio afviste"); e.code = 21610; throw e; }
      sendt.push({ to: m.to, from: m.from, body: m.body });
      return { sid: "SM" + sendt.length };
    } };
  },
});
Object.defineProperty(twilio.Twilio.prototype, "calls", {
  configurable: true,
  get() { return { create: async () => { throw new Error("proeve: opkald ud er spaerret"); } }; },
});

// --- Alarmer optages (sendAdminAlert) ---------------------------------------
// mail.js indlaeses rigtigt, og kun sendAdminAlert byttes ud, FOER onboarding.js
// laeses - onboarding.js tager funktionen ud ved indlaesning.
let alarmer = [];
const mailSti = require.resolve("./mail");
const aegteMail = require(mailSti);
require.cache[mailSti].exports = { ...aegteMail, sendAdminAlert: async (a) => { alarmer.push(a.subject); } };

// --- Falsk database ---------------------------------------------------------
// Understoetter det, /opkald bruger: select/eq/is, single/maybeSingle,
// insert(...)[.select().single()], update(...).eq().is() og await/then.
function lavDb(start) {
  const t = JSON.parse(JSON.stringify(start));
  for (const k of ["firms", "calls", "firm_whitelist", "firma_moduler"]) t[k] = t[k] || [];
  let n = 0;
  function q(tabel) {
    const st = { op: "select", filtre: [] };
    const match = (r) => st.filtre.every((f) => f(r));
    const koer = () => {
      const rows = t[tabel];
      if (st.op === "insert") {
        const r = { id: tabel + "-" + (++n), ...st.vaerdier };
        rows.push(r);
        return { data: [{ ...r }], error: null };
      }
      if (st.op === "update") {
        const hit = rows.filter(match);
        hit.forEach((r) => Object.assign(r, st.vaerdier));
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      return { data: rows.filter(match).map((r) => ({ ...r })), error: null };
    };
    const o = {
      select() { return o; },
      eq(k, v) { st.filtre.push((r) => r[k] === v); return o; },
      is(k, v) { st.filtre.push((r) => (r[k] ?? null) === v); return o; },
      insert(v) { st.op = "insert"; st.vaerdier = v; return o; },
      update(v) { st.op = "update"; st.vaerdier = v; return o; },
      single: async () => {
        const r = koer();
        return r.data.length === 1 ? { data: r.data[0], error: null } : { data: null, error: { code: "PGRST116", message: "0 eller flere raekker" } };
      },
      maybeSingle: async () => { const r = koer(); return { data: r.data[0] || null, error: null }; },
      then(res, rej) { return Promise.resolve(koer()).then(res, rej); },
    };
    return o;
  }
  return { t, from: q };
}

// --- To firmaer, saa en forbytning kan ses ----------------------------------
const FIRMA_A = {
  id: "firma-a", name: "Jensens Toemrer og Snedker ApS", sms_navn: "Jensens Toemrer", slug: "jensens",
  voice_gender: "female", greeting_text: "Hej, du har ringet til Jensens Toemrer.",
  greeting_audio_url: "https://lyd.eksempel.dk/jensens.mp3",
  verification_status: "verified", status: "active", billing_status: "active",
  phone_number: "+4520000001", owner_phone: "+4530000001", nummer_verificeret_at: null,
};
const FIRMA_B = {
  id: "firma-b", name: "Hansen VVS", sms_navn: null, slug: "hansen-vvs",
  voice_gender: "male", greeting_text: "Hej, du har ringet til Hansen VVS.",
  greeting_audio_url: null,
  verification_status: "verified", status: "active", billing_status: "active",
  phone_number: "+4520000002", owner_phone: "+4530000002", nummer_verificeret_at: null,
};
const KUNDE = "+4540000099";
const MODUL_TELEFON = { firm_id: "firma-a", modul: "telefon", fra: "2026-01-01T00:00:00Z", til: null };
const MODUL_REFERAT = { firm_id: "firma-a", modul: "referat", fra: "2026-01-01T00:00:00Z", til: null };

// --- Proevens rammer --------------------------------------------------------
let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  return a === b ? ok(n, a) : nej(n, `fik ${a}, forventede ${b}`);
};
const sand = (n, b, d) => (b ? ok(n) : nej(n, d || "var falsk"));

// Monterer onboarding.js frisk med det oenskede FASE3_SYNK. flags.js laeser
// miljoeet ved indlaesning, saa begge filer smides ud af cachen foerst.
function byg(data, { fase3 = false } = {}) {
  process.env.FASE3_SYNK = fase3 ? "true" : "false";
  delete require.cache[require.resolve("./flags")];
  delete require.cache[require.resolve("./onboarding")];
  const db = lavDb(data);
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  require("./onboarding")(app, db);
  return new Promise((ok) => {
    const server = app.listen(0, "127.0.0.1", () => ok({ db, server, port: server.address().port }));
  });
}

// POST /opkald som Twilio goer det. signatur: "rigtig" | "ingen" | "forkert".
function ring({ port }, params, { signatur = "rigtig" } = {}) {
  const krop = new URLSearchParams(params).toString();
  const url = `https://127.0.0.1:${port}/opkald`;   // som onboarding.js bygger den
  const headers = { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(krop) };
  if (signatur === "rigtig") headers["X-Twilio-Signature"] = twilio.getExpectedTwilioSignature(TEST_TOKEN, url, params);
  if (signatur === "forkert") headers["X-Twilio-Signature"] = twilio.getExpectedTwilioSignature("en-anden-noegle", url, params);
  return new Promise((ok, fejl) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/opkald", method: "POST", headers }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => ok({ status: res.statusCode, type: res.headers["content-type"] || "", body: d }));
    });
    req.on("error", fejl); req.end(krop);
  });
}

// SMS'en sendes uden at vente (TwiML maa ikke forsinkes). Giv loeftet tid.
const roligt = () => new Promise((r) => setTimeout(r, 30));
const nulstil = () => { sendt = []; alarmer = []; smsFejler = false; };
const kald = (to, from = KUNDE) => ({ To: to, From: from, CallSid: "CA" + "1".repeat(32) });

(async () => {
  let m, r;

  console.log("1. Almindeligt kundeopkald til firma A (lydfil)");
  nulstil();
  m = await byg({ firms: [FIRMA_A, FIRMA_B] });
  r = await ring(m, kald(FIRMA_A.phone_number));
  await roligt();
  lig("svar 200 med XML", [r.status, /xml/.test(r.type)], [200, true]);
  lig("hilsen: firmaets egen lydfil", (r.body.match(/<Play>([^<]*)<\/Play>/) || [])[1], FIRMA_A.greeting_audio_url);
  sand("intet 'Lomme' i TwiML", !/lomme/i.test(r.body), r.body);
  sand("intet fra firma B i TwiML", !r.body.includes("Hansen"), r.body);
  lig("praecis en SMS", sendt.length, 1);
  const sms = sendt[0] || {};
  lig("SMS'en gaar til den, der ringede", sms.to, KUNDE);
  lig("SMS'en sendes fra firmaets nummer", sms.from, FIRMA_A.phone_number);
  lig("en opkaldsraekke, paa firma A", m.db.t.calls.map((c) => c.firm_id), ["firma-a"]);
  const token = (m.db.t.calls[0] || {}).lead_token;
  sand("opkaldet har et token", typeof token === "string" && token.length > 0);
  const link = `${BASE}/${FIRMA_A.slug}/${token}`;
  sand("SMS'en slutter med linket til firmaets egen formular", String(sms.body).endsWith("\n" + link), `body: ${JSON.stringify(sms.body)}`);
  sand("SMS'en bruger SMS-navnet, ikke det fulde firmanavn",
    String(sms.body).includes(FIRMA_A.sms_navn) && !String(sms.body).includes(FIRMA_A.name), JSON.stringify(sms.body));
  sand("ingen dobbelt skraastreg i linket", !String(sms.body).replace("https://", "").includes("//"));
  sand("intet 'Lomme' i SMS'en", !/lomme/i.test(String(sms.body)));
  lig("ingen alarm", alarmer, []);
  m.server.close();

  console.log("\n2. Almindeligt kundeopkald til firma B (ingen lydfil, mandestemme)");
  nulstil();
  m = await byg({ firms: [FIRMA_A, FIRMA_B] });
  r = await ring(m, kald(FIRMA_B.phone_number));
  await roligt();
  lig("hilsen: firmaets egen tekst med mandestemmen", /<Say voice="Polly\.Mads" language="da-DK">Hej, du har ringet til Hansen VVS\.<\/Say>/.test(r.body), true);
  sand("intet fra firma A i TwiML", !r.body.includes("Jensen"), r.body);
  lig("praecis en SMS, fra B's nummer", sendt.map((s) => s.from), [FIRMA_B.phone_number]);
  const tokenB = (m.db.t.calls[0] || {}).lead_token;
  sand("linket peger paa B's formular", String((sendt[0] || {}).body).endsWith(`\n${BASE}/${FIRMA_B.slug}/${tokenB}`), JSON.stringify((sendt[0] || {}).body));
  sand("uden SMS-navn bruges firmanavnet", String((sendt[0] || {}).body).includes(FIRMA_B.name));
  m.server.close();

  console.log("\n3. Signaturen");
  for (const s of ["ingen", "forkert"]) {
    nulstil();
    m = await byg({ firms: [FIRMA_A] });
    r = await ring(m, kald(FIRMA_A.phone_number), { signatur: s });
    await roligt();
    lig(`${s} signatur: 403, ingen SMS, ingen opkaldsraekke`, [r.status, sendt.length, m.db.t.calls.length], [403, 0, 0]);
    m.server.close();
  }

  console.log("\n4. Ukendt nummer");
  nulstil();
  m = await byg({ firms: [FIRMA_A] });
  r = await ring(m, kald("+4529999999"));
  await roligt();
  lig("laegger paa, ingen SMS, ingen opkaldsraekke", [r.status, /<Hangup\/>/.test(r.body), sendt.length, m.db.t.calls.length], [200, true, 0, 0]);
  m.server.close();

  console.log("\n5. Hvidlistet nummer");
  nulstil();
  m = await byg({ firms: [FIRMA_A], firm_whitelist: [{ id: "w1", firm_id: "firma-a", number: KUNDE }] });
  r = await ring(m, kald(FIRMA_A.phone_number));
  await roligt();
  lig("kort besked, ingen SMS, ingen opkaldsraekke", [/<Say/.test(r.body), sendt.length, m.db.t.calls.length], [true, 0, 0]);
  m.server.close();

  console.log("\n6. Firma uden aktiv telefon (porten i ruten; reglen selv: proev-telefon-nummer.js)");
  nulstil();
  m = await byg({ firms: [{ ...FIRMA_A, billing_status: "cancelled" }] });
  r = await ring(m, kald(FIRMA_A.phone_number));
  await roligt();
  lig("uden FASE3: opsagt -> ingen SMS, ingen opkaldsraekke", [sendt.length, m.db.t.calls.length], [0, 0]);
  sand("den, der ringer, hoerer firmaets navn i beskeden", r.body.includes("ikke l\u00e6ngere i drift") && r.body.includes(FIRMA_A.name), r.body);
  m.server.close();

  nulstil();
  m = await byg({ firms: [FIRMA_A], firma_moduler: [MODUL_REFERAT] }, { fase3: true });
  r = await ring(m, kald(FIRMA_A.phone_number));
  await roligt();
  lig("med FASE3: intet telefonmodul -> ingen SMS", sendt.length, 0);
  m.server.close();

  nulstil();
  m = await byg({ firms: [{ ...FIRMA_A, billing_status: "past_due" }], firma_moduler: [MODUL_TELEFON] }, { fase3: true });
  r = await ring(m, kald(FIRMA_A.phone_number));
  await roligt();
  lig("med FASE3: telefonmodul i respit -> praecis en SMS", sendt.length, 1);
  m.server.close();

  console.log("\n7. Twilio afviser SMS'en (den vigtigste fejlvej)");
  nulstil();
  smsFejler = true;
  m = await byg({ firms: [FIRMA_A] });
  r = await ring(m, kald(FIRMA_A.phone_number));
  await roligt();
  lig("opkaldet knaekker ikke: 200 med hilsen", [r.status, /<Play>/.test(r.body)], [200, true]);
  lig("alarm i indbakken", alarmer, ["Kunde-SMS med formular-link fejlede"]);
  m.server.close();

  console.log("\n8. Intet forlod maskinen");
  lig("ingen netvaerkskald", netForsoeg, []);

  console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
  console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
  process.exit(fejlet ? 1 : 0);
})().catch((e) => { console.error("PROEVEN SELV FEJLEDE:", e); process.exit(1); });
