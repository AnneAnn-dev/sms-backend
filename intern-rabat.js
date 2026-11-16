// intern-rabat.js
// -----------------------------------------------------------------------------
// 16/11-26: interne abonnementer (Ann, Anne, saelgeren) skal koste 0 kr. Det
// goeres med en RABAT paa 100 % paa hvert abonnement - IKKE ved at saette
// priser til 0. Hvorfor:
//   - Din pakke (frisbii-pakke.js) viser listepriserne fra frisbii-katalog.js og
//     traekker rabatter fra (subscription_discounts). En rabat vises derfor
//     rigtigt i appen; en egen pris paa et add-on gor ikke.
//   - Kataloget i Frisbii roeres aldrig. En pris sat til 0 dér gaelder alle
//     kunder (sket 16/11 i LIVE, rettet i haanden samme morgen).
//   - Rabatter kraever ikke Frisbii Growth (det goer kuponer).
//   - Samme form som pilot-rabatten, maalt 1/11 paa sub-0140:
//     percentage 100, apply_to ["all"].
//
//   node intern-rabat.js sub-0123 cust-0081           -> toerkoersel, staging
//   node intern-rabat.js sub-0123 --koer              -> sender, staging
//   node intern-rabat.js --prod cust-0081 cust-0084 cust-0086          -> toerkoersel, LIVE
//   node intern-rabat.js --prod cust-0081 cust-0084 cust-0086 --koer   -> sender, LIVE
//
// Argumenter: abonnement-handles (sub-...) eller kunde-handles (cust-...).
// En kunde slaas op og skal have PRAECIS ét abonnement, der ikke er udloebet
// - ellers stopper scriptet, foer noget sendes.
//
// Hvad der sendes (kun med --koer):
//   1) POST /discount  {handle: intern-gratis, 100 %, alt, uden slutdato}
//      - kun hvis rabatten ikke findes. Findes den, men afviger, STOP.
//   2) POST /subscription/{h}/discount  {discount: intern-gratis}
//      - kun paa abonnementer, der ikke allerede har den.
// Hvert kald sendes én gang; foerste afvisning stopper resten.
//
// Spaerrer (samme som opret-frisbii-produkter.js):
//   STAGING som standard. --prod kraever BAADE .ENV-ER-PROD (skift-prod.ps1)
//   og at noeglen hoerer til kontoen test-2-lommekontor.
//
// Roerer IKKE: kataloget, priser, aabne fakturaer (en allerede udstedt faktura
// annulleres i haanden), Supabase.
// Fjernes rabatten senere: i Frisbii paa abonnementet, eller
// DELETE /subscription/{h}/discount/{sub-rabat-handle} (handle staar i outputtet).
//
// Ingen persondata: der udskrives kun handles og tilstande, aldrig navne eller
// e-mails. Noeglen udskrives aldrig.
//
// Alternativ fravalgt: egen pris 0 kr. paa hvert abonnements add-ons. Virker i
// Frisbii, men appen viser stadig 500/400 kr., og et nyt tilkoeb faar listepris.
// Kendt begraensning i prod indtil naeste tog: et tilkoeb i appen paa et
// abonnement med 100 % rabat afvises med code 215 (rettet i staging, D25).
// Laeg moduler paa i Frisbii i stedet.
// -----------------------------------------------------------------------------
"use strict";

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const prod = argv.includes("--prod");
const koer = argv.includes("--koer");
const ukendte = argv.filter((a) => a.startsWith("--") && a !== "--prod" && a !== "--koer");
const maal = argv.filter((a) => !a.startsWith("--"));

if (ukendte.length) { console.log(`STOP: ukendt flag ${ukendte.join(", ")}. Intet er kaldt.`); process.exit(2); }
if (!maal.length) { console.log("STOP: angiv mindst ét sub-... eller cust-... handle. Intet er kaldt."); process.exit(2); }
const forkerte = maal.filter((m) => !/^(sub|cust)-[A-Za-z0-9_-]+$/.test(m));
if (forkerte.length) { console.log(`STOP: ${forkerte.join(", ")} ligner ikke et sub-/cust-handle. Intet er kaldt.`); process.exit(2); }

const erProd = fs.existsSync(path.join(__dirname, ".ENV-ER-PROD"));
if (erProd && !prod) { console.log("STOP: .ENV-ER-PROD findes - miljoeet peger paa PROD. Intet er kaldt. (Mod LIVE: tilfoej --prod.)"); process.exit(2); }
if (prod && !erProd) { console.log("STOP: --prod, men .ENV-ER-PROD findes ikke - koer skift-prod.ps1 foerst. Intet er kaldt."); process.exit(2); }
require("dotenv").config({ quiet: true });

const API = "https://api.frisbii.com/v1";
const KONTO = prod ? "test-2-lommekontor" : "lommekontor";
const MILJOE = prod ? "PROD (LIVE)" : "staging";
const RABAT = {
  handle: "intern-gratis",
  name: "Intern - gratis",
  description: "Interne brugere (ejere og saelger). Sat af intern-rabat.js.",
  percentage: 100,
  apply_to: ["all"],
};
const KEY = process.env.FRISBII_PRIVATE_KEY;
if (!KEY) { console.log("STOP: FRISBII_PRIVATE_KEY mangler. Intet er kaldt."); process.exit(2); }
const AUTH = "Basic " + Buffer.from(KEY + ":").toString("base64");

async function kald(metode, sti, body) {
  const opt = { method: metode, headers: { Authorization: AUTH, Accept: "application/json" } };
  if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  const r = await fetch(API + sti, opt);
  let data = null;
  try { data = await r.json(); } catch (e) { data = null; }
  const besked = !r.ok && data && typeof data === "object"
    ? (data.code !== undefined ? "code=" + data.code + " " : "") + (data.message || data.error || "") : "";
  console.log(`   ${metode} ${sti}  ->  ${r.status}${besked ? "  (" + String(besked).slice(0, 200) + ")" : ""}`);
  return { ok: r.ok, status: r.status, data };
}
const liste = (d) => (!d ? [] : Array.isArray(d) ? d : Array.isArray(d.content) ? d.content : []);
const enc = encodeURIComponent;
const rabatHandleAf = (r) => (r && (typeof r.discount === "string" ? r.discount
  : (r.discount && r.discount.handle) || (r.discount_dto && r.discount_dto.handle))) || null;
const levende = (r) => !r.state || !["deleted", "expired", "cancelled"].includes(r.state);

function stop(tekst) { console.log(`\nSTOP: ${tekst}\nIntet er sendt.`); process.exit(1); }

(async () => {
  console.log(`Intern rabat (100 %) i Frisbii-${MILJOE}${koer ? "  [--koer]" : "  (toerkoersel)"}  ${new Date().toISOString()}\n`);

  // 1) Kontoen skal passe til miljoeet.
  const konto = await kald("GET", "/account");
  if (!konto.ok || !konto.data || konto.data.handle !== KONTO) stop(`kontoen er ${konto.data && konto.data.handle}, ikke ${KONTO}.`);
  console.log(`   konto = ${KONTO} (${MILJOE})\n`);

  // 2) Rabatten: findes den, og er den som forventet?
  console.log("=== Rabatten");
  const r = await kald("GET", `/discount/${enc(RABAT.handle)}`);
  let opretRabat = false;
  if (r.status === 404) {
    opretRabat = true;
    console.log(`   ${RABAT.handle} findes ikke - oprettes.`);
  } else if (!r.ok) {
    stop(`Frisbii svarede ${r.status} paa rabatten.`);
  } else {
    const d = r.data || {};
    const afvig = [];
    if (d.percentage !== 100) afvig.push(`percentage=${d.percentage}`);
    if (!Array.isArray(d.apply_to) || !d.apply_to.includes("all")) afvig.push(`apply_to=${JSON.stringify(d.apply_to)}`);
    if (d.state && d.state !== "active") afvig.push(`state=${d.state}`);
    if (d.fixed_count || d.fixed_period) afvig.push("har en slutdato/et antal");
    if (afvig.length) stop(`${RABAT.handle} findes, men afviger: ${afvig.join(", ")}. Ret den i Frisbii eller slet den.`);
    console.log(`   ${RABAT.handle} findes: 100 %, alt, ingen slutdato. OK`);
  }

  // 3) Find abonnementerne.
  console.log("\n=== Abonnementerne");
  const subs = [];
  for (const m of maal) {
    if (m.startsWith("sub-")) { subs.push({ sub: m, fra: m }); continue; }
    const l = await kald("GET", `/list/subscription?customer=${enc(m)}&size=100`);
    if (!l.ok) stop(`kunne ikke slaa abonnementer op for ${m} (${l.status}). Angiv sub-handlet i stedet.`);
    const aktive = liste(l.data).filter((s) => s && s.state !== "expired");
    if (aktive.length !== 1) {
      stop(`${m} har ${aktive.length} abonnementer, der ikke er udloebet (${aktive.map((s) => s.handle + "/" + s.state).join(", ") || "ingen"}). Angiv det rigtige sub-handle i stedet.`);
    }
    subs.push({ sub: aktive[0].handle, fra: m });
  }

  const opgaver = [];
  for (const s of subs) {
    const a = await kald("GET", `/subscription/${enc(s.sub)}`);
    if (!a.ok) stop(`${s.sub} kunne ikke hentes (${a.status}).`);
    const st = a.data || {};
    if (st.state === "expired") stop(`${s.sub} er udloebet.`);
    let har = false;
    if (Array.isArray(st.subscription_discounts) && st.subscription_discounts.length) {
      const d = await kald("GET", `/subscription/${enc(s.sub)}/discount`);
      if (!d.ok) stop(`rabatterne paa ${s.sub} kunne ikke hentes (${d.status}).`);
      har = liste(d.data).some((x) => rabatHandleAf(x) === RABAT.handle && levende(x));
      const andre = liste(d.data).filter((x) => rabatHandleAf(x) !== RABAT.handle && levende(x)).map(rabatHandleAf);
      if (andre.length) console.log(`   bemaerk: ${s.sub} har ogsaa rabatten/rabatterne ${andre.join(", ")}`);
    }
    const plan = typeof st.plan === "string" ? st.plan : st.plan && st.plan.handle;
    console.log(`   ${s.fra === s.sub ? s.sub : s.fra + " -> " + s.sub}: state=${st.state}, plan=${plan}${har ? ", HAR ALLEREDE intern-gratis" : ""}`);
    if (!har) {
      opgaver.push({
        hvad: `intern-gratis paa ${s.sub}`,
        metode: "POST", sti: `/subscription/${enc(s.sub)}/discount`,
        body: { handle: `intern-gratis-${s.sub}`, discount: RABAT.handle },
      });
    }
  }
  if (opretRabat) opgaver.unshift({ hvad: `rabatten ${RABAT.handle}`, metode: "POST", sti: "/discount", body: RABAT });

  if (!opgaver.length) { console.log("\nIntet at goere: alle abonnementer har allerede rabatten."); process.exit(0); }

  console.log("\n=== Det, der " + (koer ? "sendes" : "VILLE blive sendt"));
  for (const o of opgaver) console.log(`\n - ${o.hvad}\n   ${o.metode} ${o.sti}\n   body = ${JSON.stringify(o.body)}`);
  if (!koer) { console.log("\nTOERKOERSEL: intet sendt. Koer igen med --koer for at sende netop disse kald."); process.exit(0); }

  console.log("\n=== Sender");
  for (const o of opgaver) {
    const s = await kald(o.metode, o.sti, o.body);
    if (!s.ok) { console.log(`\nAFVIST: ${o.hvad}. De resterende kald er IKKE sendt. Send outputtet til chatten.`); process.exit(1); }
  }
  console.log("\nSENDT. Koer nu samme kommando uden --koer: alle abonnementer skal staa med \"HAR ALLEREDE intern-gratis\".\n" +
    "Tjek derefter i Frisbii, at naeste faktura er 0 kr., og i appen (Din pakke), at summen er 0 kr.");
})();
