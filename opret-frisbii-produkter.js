// opret-frisbii-produkter.js
// -----------------------------------------------------------------------------
// Fase 3, T1b (28/10-26): opretter katalogets produkter i Frisbii-STAGING -
// basisplanen og de add-ons, der saelges - ud fra frisbii-katalog.js. Saa kan
// handles i koden og i Frisbii ikke glide fra hinanden (Ann 28/10).
//
//   node opret-frisbii-produkter.js           -> toerkoersel: viser hvad der mangler
//   node opret-frisbii-produkter.js --koer    -> opretter det, der mangler
//
// KUN STAGING. Stopper, foer noget kaldes, hvis .ENV-ER-PROD findes, og foer
// noget skrives, hvis noeglen ikke hoerer til kontoen "lommekontor".
// Prod faar sine produkter foerst paa vejen til prod (byggeplanen, trin 2).
//
// OPRETTER KUN DET, DER MANGLER. Findes et produkt allerede, men afviger det
// (pris, proeveperiode ...), aendres INTET - scriptet siger det, og Ann
// retter i Frisbii. Hvert kald sendes en gang; foerste afvisning stopper resten.
//
// Bagefter: node check-env.js --live skal vaere groen, ogsaa for produkterne.
// Ingen persondata. Noeglen udskrives aldrig.
// -----------------------------------------------------------------------------
"use strict";

const fs = require("fs");
const path = require("path");

if (fs.existsSync(path.join(__dirname, ".ENV-ER-PROD"))) {
  console.log("STOP: .ENV-ER-PROD findes - miljoeet peger paa PROD. Intet er kaldt.");
  process.exit(2);
}
require("dotenv").config({ quiet: true });

const { produkterTilSalg } = require("./frisbii-katalog");
const { doemProdukter } = require("./frisbii-tjek");

const API = "https://api.frisbii.com/v1";
const STAGING_HANDLE = "lommekontor";
const koer = process.argv.includes("--koer");
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

(async () => {
  console.log(`Fase 3 T1b - katalogets produkter i Frisbii-staging${koer ? "  [--koer]" : "  (toerkoersel)"}  ${new Date().toISOString()}\n`);

  // 1) Spaerre: kun staging-kontoen.
  const konto = await kald("GET", "/account");
  if (!konto.ok || konto.data.handle !== STAGING_HANDLE) {
    console.log(`STOP: kontoen er ${konto.data && konto.data.handle}, ikke ${STAGING_HANDLE}. Intet skrevet.`);
    process.exit(1);
  }
  console.log(`   konto = ${STAGING_HANDLE} (staging)\n`);

  // 2) Hvad findes, og hvad mangler?
  const salg = produkterTilSalg();
  const planer = liste((await kald("GET", "/plan")).data);
  const addOns = liste((await kald("GET", "/add_on")).data);
  const planFindes = planer.some((p) => p && p.handle === salg.plan.handle && p.state === "active");
  const findesIkke = (h) => !addOns.some((a) => a && a.handle === h);

  const opgaver = [];
  if (!planFindes) {
    opgaver.push({
      hvad: `basisplan ${salg.plan.handle} (0 kr., ${salg.plan.proevedage} dages proeve)`,
      metode: "POST", sti: "/plan",
      body: {
        handle: salg.plan.handle,
        name: "Dit Digitale Kontor - basis",
        description: "Grundabonnement. Modulerne koebes som tillaeg.",
        amount: salg.plan.prisOere,
        vat: 0.25,
        amount_incl_vat: false,
        currency: "DKK",
        interval_length: 1,
        schedule_type: "month_startdate",
        partial_period_handling: "bill_prorated",
        trial_interval_length: salg.plan.proevedage,
        trial_interval_unit: "days",
      },
    });
  }
  for (const a of salg.addOns) {
    if (!findesIkke(a.handle)) continue;
    opgaver.push({
      hvad: `add-on ${a.handle} (${a.navn}, ${a.prisOere / 100} kr. ekskl. moms)`,
      metode: "POST", sti: "/add_on",
      body: {
        handle: a.handle,
        name: a.navn,
        amount: a.prisOere,
        vat: 0.25,
        amount_incl_vat: false,
        type: "on_off",
        all_plans: false,
        eligible_plans: [salg.plan.handle],
      },
    });
  }

  console.log("\n=== Status foer");
  for (const d of doemProdukter(planer, addOns, salg)) console.log(`   ${d.ok ? "OK  " : "MANGLER/AFVIGER"}  ${d.navn} - ${d.detalje}`);

  if (!opgaver.length) {
    console.log("\nIntet at oprette. Afviger noget ovenfor, rettes det i Frisbii - scriptet aendrer ikke eksisterende produkter.");
    process.exit(0);
  }

  console.log("\n=== Det, der " + (koer ? "oprettes" : "VILLE blive oprettet"));
  for (const o of opgaver) {
    console.log(`\n - ${o.hvad}\n   ${o.metode} ${o.sti}\n   body = ${JSON.stringify(o.body)}`);
  }
  if (!koer) {
    console.log("\nTOERKOERSEL: intet sendt. Koer igen med --koer for at sende netop disse kald.");
    process.exit(0);
  }

  console.log("\n=== Sender");
  for (const o of opgaver) {
    const r = await kald(o.metode, o.sti, o.body);
    if (!r.ok) {
      console.log(`\nAFVIST: ${o.hvad}. De resterende kald er IKKE sendt. Send outputtet til chatten.`);
      process.exit(1);
    }
  }
  console.log("\nSENDT. Koer nu:  node check-env.js --live   - produkterne skal vaere groenne.");
})();
