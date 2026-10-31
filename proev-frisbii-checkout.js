// proev-frisbii-checkout.js -- proever frisbii-checkout.js (Fase 3, T8b:
// moduler i checkout og "har allerede en konto", D91) mod en falsk Frisbii og
// en falsk database. Ingen netvaerk, ingen database (koeres i CI via
// kor-proever.js).
//
//   node proev-frisbii-checkout.js
//
// 31/10-26. Ren ASCII.
"use strict";

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  return a === b ? ok(n, a) : nej(n, `fik ${a}, forventede ${b}`);
};

process.env.FRISBII_PRIVATE_KEY = "p";
process.env.FRISBII_PLAN_HANDLE = "abonnement-standard";
process.env.SIMPLY_BASE_URL = "https://hjemmeside.invalid";
process.env.CHECKOUT_LOFT_MAKS = "50";

// Indlaes modulet med flaget sat - flags.js laeses ved require.
function indlaes(fase3) {
  process.env.FASE3_SYNK = fase3 ? "true" : "false";
  for (const k of Object.keys(require.cache)) if (/(flags|frisbii-checkout|ratelimit)\.js$/.test(k)) delete require.cache[k];
  return require("./frisbii-checkout");
}

function falskDb(firmaer, { fejl = false } = {}) {
  return { from() {
    const o = { select() { return o; },
      ilike(k, m) { o.m = m.replace(/\\([\\%_])/g, "$1").toLowerCase(); return o; },
      then(res, rej) {
        if (fejl) return Promise.resolve({ data: null, error: { message: "db nede" } }).then(res, rej);
        return Promise.resolve({ data: firmaer.filter((f) => f.email.toLowerCase() === o.m), error: null }).then(res, rej);
      } };
    return o;
  } };
}

let sendt = [];
global.fetch = async (url, opt) => {
  sendt.push({ url, krop: JSON.parse(opt.body) });
  return { ok: true, status: 200, text: async () => JSON.stringify({ id: "cs_1", url: "https://checkout.invalid/cs_1" }) };
};

async function kald(mod, db, krop) {
  const ruter = {};
  const app = { post: (s, f) => { ruter["POST " + s] = f; }, get: (s, f) => { ruter["GET " + s] = f; } };
  mod(app, db);
  let status = 200, data = null;
  const res = { status(s) { status = s; return res; }, json(d) { data = d; return res; }, set() { return res; }, sendFile(f) { data = { fil: f }; return res; } };
  sendt = [];
  await ruter["POST /checkout/start"]({ body: krop, headers: { "x-forwarded-for": "10.0.0." + Math.floor(Math.random() * 200) } }, res);
  return { status, data, frisbii: sendt[0] ? sendt[0].krop : null, ruter: Object.keys(ruter).sort() };
}

const KROP = { name: "Mogens", email: "Mogens@Maler.dk", company: "Mogens Maler" };

(async () => {
  console.log("1. vaelgModuler, tilSalg, harKoerendeKonto (rene regler)");
  const m = indlaes(true);
  lig("tilSalg: kun Telefonpasser og Referat (Ann 31/10)", m.tilSalg().map((p) => [p.modul, p.navn, p.prisOere]), [["telefon", "Telefonpasser", 50000], ["referat", "Referat", 40000]]);
  lig("intet valg -> Telefonpasser (gamle knapper virker)", m.vaelgModuler(undefined), { ok: true, moduler: ["telefon"] });
  lig("tekst fra linket", m.vaelgModuler("referat, TELEFON"), { ok: true, moduler: ["referat", "telefon"] });
  lig("liste med dublet", m.vaelgModuler(["telefon", "telefon"]), { ok: true, moduler: ["telefon"] });
  lig("modul, der ikke saelges endnu -> afvist", m.vaelgModuler(["telefon", "tilbud"]), { ok: false, fejl: "ukendt_modul", ukendte: ["tilbud"] });
  lig("Hele pakken saelges ikke (Ann 31/10)", m.vaelgModuler("hele-pakken").fejl, "ukendt_modul");
  lig("tom liste -> afvist", m.vaelgModuler([]).fejl, "ingen_moduler");
  lig("objekt -> afvist", m.vaelgModuler({ a: 1 }).fejl, "ugyldige_moduler");
  lig("koerende abonnement -> har konto", m.harKoerendeKonto([{ status: "active", frisbii_subscription: "sub-1" }]), true);
  lig("opsagt, ikke udloebet -> har konto", m.harKoerendeKonto([{ status: "active", billing_status: "cancelled", frisbii_subscription: "sub-1" }]), true);
  lig("udloebet firma -> maa koebe (genoplives, T8a)", m.harKoerendeKonto([{ status: "inactive", frisbii_subscription: "sub-1" }]), false);
  lig("pilot uden abonnement -> maa koebe (alarm, T8a)", m.harKoerendeKonto([{ status: "active", frisbii_subscription: null }]), false);

  console.log("\n2. /checkout/start med FASE3_SYNK");
  let r = await kald(m, falskDb([]), { ...KROP, moduler: ["telefon", "referat"] });
  lig("ny kunde: basisplan + to add-ons", [r.status, r.frisbii && r.frisbii.prepare_subscription.plan, r.frisbii && r.frisbii.prepare_subscription.add_ons],
    [200, "ddk-basis", [{ add_on: "modul-referat" }, { add_on: "modul-telefon" }]]);
  lig("svaret er betalingssiden", r.data, { url: "https://checkout.invalid/cs_1", session_id: "cs_1" });
  r = await kald(m, falskDb([]), KROP);
  lig("uden moduler: Telefonpasser", r.frisbii.prepare_subscription.add_ons, [{ add_on: "modul-telefon" }]);
  r = await kald(m, falskDb([{ email: "mogens@maler.dk", status: "active", frisbii_subscription: "sub-1" }]), KROP);
  lig("koerende abonnement: 409 har_konto, intet kald til Frisbii", [r.status, r.data, r.frisbii], [409, { error: "har_konto" }, null]);
  r = await kald(m, falskDb([{ email: "mogens@maler.dk", status: "inactive", frisbii_subscription: "sub-1" }]), KROP);
  lig("udloebet firma: koebet gaar igennem", [r.status, !!r.frisbii], [200, true]);
  r = await kald(m, falskDb([], { fejl: true }), KROP);
  lig("databasen svarer ikke: koebet gaar igennem (T8a fanger det)", [r.status, !!r.frisbii], [200, true]);
  r = await kald(m, falskDb([]), { ...KROP, moduler: "faktura" });
  lig("modul, der ikke saelges: 400, intet kald til Frisbii", [r.status, r.data.error, r.frisbii], [400, "ukendt_modul", null]);
  r = await kald(m, falskDb([]), { ...KROP, company: "" });
  lig("firmanavn mangler stadig: 400 missing_company (D33)", [r.status, r.data.error], [400, "missing_company"]);
  lig("ruterne med flaget: produkter og bestil findes", r.ruter, ["GET /bestil", "GET /checkout/produkter", "POST /checkout/start"]);

  console.log("\n3. /checkout/start med flaget slukket (som foer T8b)");
  const gl = indlaes(false);
  r = await kald(gl, falskDb([{ email: "mogens@maler.dk", status: "active", frisbii_subscription: "sub-1" }]), { ...KROP, moduler: ["referat"] });
  lig("gammel plan, ingen add-ons, intet opslag", [r.status, r.frisbii.prepare_subscription.plan, r.frisbii.prepare_subscription.add_ons], [200, "abonnement-standard", undefined]);
  lig("ingen produkter- eller bestil-rute uden flaget", r.ruter, ["POST /checkout/start"]);

  console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
  console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
  process.exit(fejlet ? 1 : 0);
})();
