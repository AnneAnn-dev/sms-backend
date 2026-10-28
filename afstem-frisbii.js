// afstem-frisbii.js
// -----------------------------------------------------------------------------
// Fase 3, T3 (28/10-26): afstemning mellem Frisbii og databasen (D15, AA2).
//
// SKRIVER INTET - hverken hos Frisbii eller i Supabase. Laeser begge sider,
// sammenligner firma for firma, og melder hver uenighed. Rettelser laver et
// menneske bagefter (eller gensynk, naar T5 findes).
//
//   node afstem-frisbii.js
//
// Afstemmer det miljoe, din profil peger paa. Supabase-projekt og Frisbii-
// konto SKAL hoere til samme miljoe (staging: hehrvdmtzokzbnbihcel +
// lommekontor; prod: glymuxqtrbpeyzmflilf + test-2-lommekontor) - ellers STOP,
// foer der sammenlignes. En blandet profil ville give uenigheder, der ikke findes.
//
// Hvad den melder (frisbii-afstem.js):
//   - moduler: betaler for noget, han ikke har / har noget, han ikke betaler for
//   - status: Frisbii lever, firmaet er inactive / udloebet, firmaet er aktivt
//     eller har stadig et nummer / billing_status afviger
//   - ukendte produkter (fx et add-on, kataloget ikke kender) og dobbelt betaling
//   - abonnementer, der lever hos Frisbii uden et firma (D93)
//
// BEGRAENSNING: abonnementer uden firma findes via kontoens seneste 100 events
// (/list/subscription svarer 422, maalt 25/10). Et gammelt, stille abonnement
// uden firma kan derfor slippe forbi. Det staar i outputtet.
//
// Ingen persondata: kun firma-id (8 tegn) og abonnements-handles.
// Exit 0 = enige. Exit 1 = uenighed (eller kunne ikke laese en side).
// -----------------------------------------------------------------------------
"use strict";

require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");
const { modulsaet } = require("./frisbii-modulsaet");
const { sammenlignFirma, abonnementerUdenFirma } = require("./frisbii-afstem");

const MILJOER = [
  { navn: "staging", ref: "hehrvdmtzokzbnbihcel", frisbii: "lommekontor" },
  { navn: "prod",    ref: "glymuxqtrbpeyzmflilf", frisbii: "test-2-lommekontor" },
];
const API = "https://api.frisbii.com/v1";

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "FRISBII_PRIVATE_KEY"]) {
  if (!process.env[k]) { console.error(`Mangler ${k} i miljoeet. Intet er laest.`); process.exit(1); }
}
const AUTH = "Basic " + Buffer.from(process.env.FRISBII_PRIVATE_KEY + ":").toString("base64");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function hent(sti) {
  const r = await fetch(API + sti, { headers: { Authorization: AUTH, Accept: "application/json" } });
  let data = null;
  try { data = await r.json(); } catch (e) { data = null; }
  return { ok: r.ok, status: r.status, data };
}
const liste = (d) => (!d ? [] : Array.isArray(d) ? d : Array.isArray(d.content) ? d.content : []);
const kort = (id) => String(id).slice(0, 8);

(async () => {
  const nu = new Date().toISOString();

  // 1) Samme miljoe paa begge sider?
  const miljoe = MILJOER.find((m) => process.env.SUPABASE_URL.includes(m.ref));
  const konto = await hent("/account");
  const handle = konto.ok ? konto.data.handle : `HTTP ${konto.status}`;
  console.log("=".repeat(72));
  console.log("AFSTEMNING FRISBII <-> DATABASE  (kun laesning)  " + nu);
  console.log(`  Supabase:      ${miljoe ? miljoe.navn + " (" + miljoe.ref + ")" : "UKENDT projekt"}`);
  console.log(`  Frisbii-konto: ${handle}`);
  console.log("=".repeat(72));
  if (!miljoe || handle !== miljoe.frisbii) {
    console.log(`STOP: Supabase og Frisbii hoerer ikke til samme miljoe (forventede ${miljoe ? miljoe.frisbii : "?"}). Intet sammenlignet.`);
    process.exit(1);
  }

  // 2) Databasesiden
  const { data: firmaer, error: fErr } = await supabase
    .from("firms").select("id, status, billing_status, phone_number, frisbii_subscription")
    .not("frisbii_subscription", "is", null);
  if (fErr) { console.error("Kunne ikke laese firms:", fErr.message); process.exit(1); }
  const ids = firmaer.map((f) => f.id);
  const { data: raekker, error: rErr } = ids.length
    ? await supabase.from("firma_moduler").select("firm_id, modul, fra, til, kilde").in("firm_id", ids)
    : { data: [], error: null };
  if (rErr) { console.error("Kunne ikke laese firma_moduler:", rErr.message); process.exit(1); }
  console.log(`\nDatabasen: ${firmaer.length} firma(er) med et Frisbii-abonnement\n`);

  // 3) Firma for firma
  let antalUenige = 0;
  for (const f of firmaer.sort((a, b) => String(a.frisbii_subscription).localeCompare(String(b.frisbii_subscription)))) {
    const s = await hent(`/subscription/${encodeURIComponent(f.frisbii_subscription)}`);
    const a = s.ok ? await hent(`/subscription/${encodeURIComponent(f.frisbii_subscription)}/add_on`) : null;
    let resultat;
    if (!s.ok) {
      resultat = { uenig: [`abonnementet findes ikke hos Frisbii (HTTP ${s.status})`], info: [] };
    } else {
      const saet = modulsaet(s.data, a && a.ok ? a.data : undefined, nu);
      resultat = sammenlignFirma({
        sub: s.data, saet, nu,
        firma: { status: f.status, billing_status: f.billing_status, har_nummer: f.phone_number != null },
        raekker: raekker.filter((r) => r.firm_id === f.id),
      });
    }
    const dom = resultat.uenig.length ? "UENIG" : "OK   ";
    if (resultat.uenig.length) antalUenige++;
    console.log(`${dom}  firma ${kort(f.id)}  ${f.frisbii_subscription}  (status ${f.status}, billing ${f.billing_status})`);
    resultat.uenig.forEach((u) => console.log(`         ! ${u}`));
    resultat.info.forEach((i) => console.log(`           ${i}`));
  }

  // 4) Abonnementer hos Frisbii uden firma (via de seneste 100 events)
  const ev = await hent("/event?size=100");
  if (!ev.ok) { console.error(`Kunne ikke laese events (HTTP ${ev.status}).`); process.exit(1); }
  const handles = [...new Set(liste(ev.data).map((e) => e && e.subscription).filter(Boolean))];
  const ukendteSubs = handles.filter((h) => !firmaer.some((f) => f.frisbii_subscription === h));
  const subs = [];
  for (const h of ukendteSubs) {
    const s = await hent(`/subscription/${encodeURIComponent(h)}`);
    if (s.ok) subs.push(s.data);
  }
  const udenFirma = abonnementerUdenFirma(subs, firmaer.map((f) => f.frisbii_subscription));
  console.log(`\nAbonnementer hos Frisbii uden firma (blandt ${handles.length} i de seneste 100 events):`);
  if (!udenFirma.length) console.log("OK     ingen");
  for (const h of udenFirma) {
    antalUenige++;
    console.log(`UENIG  ${h}  lever hos Frisbii, men intet firma i databasen (D93: naeste fornyelse opretter et)`);
  }

  console.log("\n" + "-".repeat(72));
  if (antalUenige) {
    console.log(`${antalUenige} uenighed(er). Intet er rettet - laes linjerne med ! og beslut.`);
    process.exit(1);
  }
  console.log("Enige. Frisbii og databasen siger det samme.");
})();
