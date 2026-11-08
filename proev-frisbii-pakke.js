// proev-frisbii-pakke.js -- proever frisbii-pakke.js (Fase 3, T9a: "Din pakke")
// mod Frisbii-svar, som de saa ud ved maalingen 31/10 (staging, sub-0139), og
// mod en falsk Frisbii/database for ruterne. Ingen netvaerk (koeres i CI via
// kor-proever.js).
//
//   node proev-frisbii-pakke.js
//
// 31/10-26. Rabat (pilot-gratis, maalt 1/11 paa sub-0140) tilfoejet 1/11-26. Ren ASCII.
"use strict";

process.env.FASE3_SYNK = "true";
const pakke = require("./frisbii-pakke");
const { tilstand, visning, planlaeg, virkendeRabatter, efterRabat } = pakke;
const { KATALOG } = require("./frisbii-katalog");

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  return a === b ? ok(n, a) : nej(n, `fik ${a}, forventede ${b}`);
};

// Svar som maalt 31/10 (sub-0139): add_on er en tekst, instans-handle = add-on-handle fra checkout.
const SUB = (ekstra = {}) => ({ handle: "sub-0139", state: "active", plan: "ddk-basis", in_trial: true, trial_end: "2026-11-07T10:59:59.791+00:00",
  next_period_start: "2026-11-07T10:59:59.791+00:00", is_cancelled: false, renewing: true, test: true, ...ekstra });
const A = (...h) => h.map(([inst, ao]) => ({ handle: inst, add_on: ao }));
const BEGGE = A(["modul-referat", "modul-referat"], ["modul-telefon", "modul-telefon"]);
const STOP_REF = { pending_change: { pending: true, remove_add_ons: ["modul-referat"] } };
const P = (h, m, sub, add) => planlaeg(h, m, tilstand(sub, add), { sub: "sub-0139", nyHandle: "ny-1" });
const S = "/subscription/sub-0139";
// Rabatten som maalt 1/11 (staging, sub-0140, GET /subscription/sub-0140/discount), forkortet.
const PILOT = { handle: "PILOTTEST_pilottest", discount: "pilot-gratis", state: "active", coupon: "pilottest", name: "Pilot gratis",
  percentage: 100, count: 0, invoices: [], apply_to: ["all"], apply_to_handles: [], fixed_usage_reached: false, fixed_period_passed: false };

(async () => {
  console.log("1. tilstand og visning");
  let t = tilstand(SUB(), BEGGE);
  lig("instanser pr. modul", t.instanser, { referat: ["modul-referat"], telefon: ["modul-telefon"] });
  let v = visning(t);
  lig("to aktive moduler, prisen nu 900 kr.", [v.moduler.filter((m) => m.status === "aktiv").map((m) => m.modul), v.prisNuOere, v.prisFraNaesteOere], [["telefon", "referat"], 90000, 90000]);
  lig("kommende moduler vises graatonet, Booking og Hele pakken ikke", v.moduler.filter((m) => m.status === "kommer").map((m) => m.modul), ["tilbud", "faktura", "svar-some"]);
  lig("proeveperioden og stop-datoen", [v.proeveTil, v.stopDato], ["2026-11-07T10:59:59.791+00:00", "2026-11-07T10:59:59.791+00:00"]);
  v = visning(tilstand(SUB(STOP_REF), BEGGE));
  lig("ventende stop: Referat 'stopper', 500 kr. fra naeste periode", [v.moduler.find((m) => m.modul === "referat").status, v.prisFraNaesteOere], ["stopper", 50000]);
  lig("Telefonpasser er nu det sidste aktive modul", v.moduler.find((m) => m.modul === "telefon").sidste, true);
  v = visning(tilstand(SUB(), A(["modul-telefon", "modul-telefon"], ["modul-referat", "modul-referat"], ["t9-x", "modul-referat"])));
  lig("to eksemplarer af Referat (maalt 31/10): meldes som dobbelt, prisen taeller begge", [v.moduler.find((m) => m.modul === "referat").dobbelt, v.prisNuOere], [true, 130000]);
  v = visning(tilstand(SUB({ is_cancelled: true, expires: "2026-11-07T10:59:59.791+00:00" }), BEGGE));
  lig("opsagt: alt 'stopper', intet fra naeste periode", [v.opsagt, v.moduler.filter((m) => m.status === "stopper").length, v.prisFraNaesteOere], [true, 2, 0]);
  lig("gammel plan genkendes", visning(tilstand(SUB({ plan: "abonnement-standard" }), [])).gammelPlan, true);

  console.log("\n2. planlaeg - koeb");
  lig("tilkoeb straks", P("koeb", "referat", SUB(), A(["modul-telefon", "modul-telefon"])).kald,
    [{ metode: "PUT", sti: S, krop: { timing: "immediate", add_ons: [{ add_on: "modul-referat", handle: "ny-1" }] } }]);
  lig("tilkoeb, mens et andet modul stopper: stoppet sendes igen bagefter (straks-aendringen sletter det)",
    P("koeb", "referat", SUB({ pending_change: { pending: true, remove_add_ons: ["modul-telefon"] } }), A(["modul-telefon", "modul-telefon"])).kald.map((k) => k.krop),
    [{ timing: "immediate", add_ons: [{ add_on: "modul-referat", handle: "ny-1" }] }, { timing: "renewal", remove_add_ons: ["modul-telefon"] }]);
  lig("koeb af et modul, der stopper = FORTRYD, aldrig et ekstra eksemplar", P("koeb", "referat", SUB(STOP_REF), BEGGE).kald,
    [{ metode: "PUT", sti: S, krop: { timing: "renewal", cancel_change: true } }]);
  lig("har det allerede", P("koeb", "telefon", SUB(), BEGGE).fejl, "har_modulet");
  lig("saelges ikke endnu", P("koeb", "tilbud", SUB(), BEGGE).fejl, "saelges_ikke");
  lig("ukendt modul", P("koeb", "hund", SUB(), BEGGE).fejl, "ukendt_modul");

  console.log("\n3. planlaeg - stop og fortryd");
  lig("stop Referat fra naeste periode", P("stop", "referat", SUB(), BEGGE).kald,
    [{ metode: "PUT", sti: S, krop: { timing: "renewal", remove_add_ons: ["modul-referat"] } }]);
  lig("stop fjerner ALLE eksemplarer af modulet", P("stop", "referat", SUB(), A(["modul-telefon", "modul-telefon"], ["modul-referat", "modul-referat"], ["t9-x", "modul-referat"])).kald[0].krop.remove_add_ons,
    ["modul-referat", "t9-x"]);
  lig("det sidste modul kan ikke stoppes", P("stop", "telefon", SUB(), A(["modul-telefon", "modul-telefon"])).fejl, "sidste_modul");
  lig("ogsaa ikke, naar det andet allerede stopper", P("stop", "telefon", SUB(STOP_REF), BEGGE).fejl, "sidste_modul");
  lig("stopper allerede", P("stop", "referat", SUB(STOP_REF), BEGGE).fejl, "stopper_allerede");
  lig("fortryd det eneste stop: cancel_change", P("fortryd", "referat", SUB(STOP_REF), BEGGE).kald[0].krop, { timing: "renewal", cancel_change: true });
  const TRE = A(["modul-telefon", "modul-telefon"], ["modul-referat", "modul-referat"], ["modul-svar", "modul-svar"]);
  const TO_STOP = { pending_change: { pending: true, remove_add_ons: ["modul-referat", "modul-svar"] } };
  lig("stop et modul mere: begge stop sendes samlet (et nyt stop erstatter det forrige)", P("stop", "svar", SUB(STOP_REF), TRE).kald[0].krop.remove_add_ons, ["modul-referat", "modul-svar"]);
  lig("fortryd det ene af to stop: det andet sendes igen", P("fortryd", "referat", SUB(TO_STOP), TRE).kald[0].krop, { timing: "renewal", remove_add_ons: ["modul-svar"] });
  lig("fortryd uden stop", P("fortryd", "referat", SUB(), BEGGE).fejl, "stopper_ikke");

  console.log("\n3b. Rabat (Ann 1/11: summen skal vaere 0 for en pilot)");
  lig("pilot-gratis som maalt: virker, 100 %", virkendeRabatter([PILOT]), [{ navn: "Pilot gratis", procent: 100, beloebOere: null }]);
  lig("ikke aktiv / brugt op / udloebet / kun plan: virker ikke", virkendeRabatter([{ ...PILOT, state: "deleted" }, { ...PILOT, fixed_usage_reached: true }, { ...PILOT, fixed_period_passed: true }, { ...PILOT, apply_to: ["plan"] }]), []);
  lig("rabat paa add-ons med fast beloeb", virkendeRabatter([{ ...PILOT, percentage: undefined, amount: 10000, apply_to: ["add_on"] }]), [{ navn: "Pilot gratis", procent: null, beloebOere: 10000 }]);
  lig("efterRabat: 100 % -> 0, 50 % -> halvdelen, 100 kr. af 900 kr., aldrig under 0",
    [efterRabat(90000, [{ procent: 100, beloebOere: null }]), efterRabat(90000, [{ procent: 50, beloebOere: null }]), efterRabat(90000, [{ procent: null, beloebOere: 10000 }]), efterRabat(5000, [{ procent: null, beloebOere: 10000 }])],
    [0, 45000, 80000, 0]);
  v = visning(tilstand(SUB({ subscription_discounts: ["PILOTTEST_pilottest"] }), BEGGE, KATALOG, [PILOT]));
  lig("pilot med begge moduler: rabatlinje, summen 0, listepriser uaendrede",
    [v.rabatter, v.prisNuOere, v.prisFraNaesteOere, v.prisFoerRabatOere, v.moduler.filter((m) => m.status === "aktiv").map((m) => m.prisOere)],
    [[{ navn: "Pilot gratis", procent: 100, beloebOere: null }], 0, 0, 90000, [50000, 40000]]);
  v = visning(tilstand(SUB(), BEGGE));
  lig("uden rabat: som foer (900 kr., ingen rabatlinje)", [v.rabatter, v.prisNuOere, v.prisFraNaesteOere], [[], 90000, 90000]);

  console.log("\n3b. Pakken \"Kundehenvendelser og SoMe\" (Fase 4, Ann 8/11): en vare, to moduler");
  const MED_PAKKE = A(["modul-telefon", "modul-telefon"], ["modul-svar-some-1", "modul-svar-some"]);
  v = visning(tilstand(SUB(), MED_PAKKE));
  lig("pakken er en linje med pakkens navn og pris", v.moduler.filter((m) => m.modul === "svar-some").map((m) => [m.navn, m.prisOere, m.status]),
    [["Kundehenvendelser og SoMe", 20000, "aktiv"]]);
  lig("svar og facebook vises ikke for sig", v.moduler.some((m) => m.modul === "svar" || m.modul === "facebook"), false);
  lig("prisen: Telefonpasser + pakken = 700 kr.", v.prisNuOere, 70000);
  lig("stop pakken: hele pakken stoppes", P("stop", "svar-some", SUB(), MED_PAKKE).kald[0].krop, { timing: "renewal", remove_add_ons: ["modul-svar-some-1"] });
  lig("koeb pakken: saelges ikke endnu", P("koeb", "svar-some", SUB(), BEGGE).fejl, "saelges_ikke");
  const KP = JSON.parse(JSON.stringify(KATALOG)); KP.PAKKER["svar-some"].saelges = true;
  lig("naar den saelges: tilkoeb med pakkens handle",
    planlaeg("koeb", "svar-some", tilstand(SUB(), BEGGE, KP), { sub: "sub-0139", katalog: KP, nyHandle: "ny-1" }).kald[0].krop,
    { timing: "immediate", add_ons: [{ add_on: "modul-svar-some", handle: "ny-1" }] });
  lig("kan ikke stoppe enkeltmodulet svar, naar man kun har pakken", P("stop", "svar", SUB(), MED_PAKKE).fejl, "har_ikke_modulet");

  console.log("\n4. planlaeg - opsig, genindfoer, spaerrer");
  lig("opsig", P("opsig", null, SUB(), BEGGE).kald, [{ metode: "POST", sti: S + "/cancel", krop: {} }]);
  const OPSAGT = SUB({ is_cancelled: true, expires: "2026-11-07T10:59:59.791+00:00" });
  lig("genindfoer", P("genindfoer", null, OPSAGT, BEGGE).kald, [{ metode: "POST", sti: S + "/uncancel", krop: {} }]);
  lig("opsagt: koeb og stop afvises (genindfoer foerst)", [P("koeb", "referat", OPSAGT, A(["modul-telefon", "modul-telefon"])).fejl, P("stop", "referat", OPSAGT, BEGGE).fejl], ["opsagt", "opsagt"]);
  lig("gammel plan: alt afvises (valg C)", P("koeb", "referat", SUB({ plan: "abonnement-standard" }), []).fejl, "gammel_plan");
  lig("ukendt add-on paa abonnementet: afvises", P("stop", "referat", SUB(), A(["modul-telefon", "modul-telefon"], ["modul-referat", "modul-referat"], ["x", "fremmed"])).fejl, "saerligt_abonnement");

  console.log("\n5. Ruterne mod falsk Frisbii og database");
  const sendt = [], hentet = [];
  let rabatNede = false;
  let frisbiiSub = SUB(), frisbiiAdd = BEGGE;
  const fetchFn = async (url, opt = {}) => {
    const sti = url.replace("https://api.frisbii.com/v1", "");
    if (opt.method && opt.method !== "GET") { sendt.push({ metode: opt.method, sti, krop: JSON.parse(opt.body) }); return { ok: true, status: 200, json: async () => ({}) }; }
    hentet.push(sti);
    if (sti.endsWith("/discount")) return rabatNede ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => [PILOT] };
    const d = sti.endsWith("/add_on") ? frisbiiAdd : frisbiiSub;
    return { ok: true, status: 200, json: async () => d };
  };
  const supabase = {
    auth: { getUser: async (tok) => ({ data: { user: tok === "god" ? { id: "U1" } : null }, error: null }) },
    rpc: async () => ({ data: {}, error: null }),
    from(tabel) {
      const o = { select() { return o; }, eq() { return o; },
        single: async () => ({ data: tabel === "firm_users" ? { firm_id: "F1" } : null, error: null }),
        maybeSingle: async () => ({ data: tabel === "firms" ? { id: "F1", frisbii_subscription: "sub-0139", status: "active", billing_status: "active", phone_number: null } : null, error: null }),
        then(r) { return Promise.resolve({ data: [], error: null }).then(r); } };
      return o;
    },
  };
  const ruter = {};
  pakke({ get: (s, f) => { ruter["GET " + s] = f; }, post: (s, f) => { ruter["POST " + s] = f; } }, supabase, { noegle: "k", fetchFn, log: { log() {}, error() {} } });
  async function kald(navn, krop, tok = "god") {
    let status = 200, data;
    const res = { status(s) { status = s; return res; }, json(d) { data = d; return res; }, set() { return res; } };
    await ruter[navn]({ headers: { authorization: "Bearer " + tok }, body: krop || {} }, res);
    return { status, data };
  }
  let r = await kald("GET /api/pakke");
  lig("GET /api/pakke: to aktive, 900 kr.", [r.status, r.data.abonnement, r.data.prisNuOere], [200, true, 90000]);
  r = await kald("GET /api/pakke", null, "forkert");
  lig("uden login: 401", r.status, 401);
  r = await kald("POST /api/pakke/stop", { modul: "referat" });
  lig("POST stop: et PUT med timing renewal til Frisbii", [r.status, sendt.map((k) => k.krop.timing)], [200, ["renewal"]]);
  sendt.length = 0; frisbiiSub = SUB(STOP_REF);
  r = await kald("POST /api/pakke/koeb", { modul: "referat" });
  lig("POST koeb af et modul, der stopper: cancel_change, intet tilkoeb", sendt.map((k) => k.krop), [{ timing: "renewal", cancel_change: true }]);
  sendt.length = 0;
  r = await kald("POST /api/pakke/stop", { modul: "telefon" });
  lig("POST stop af sidste aktive modul: 409, intet sendt", [r.status, r.data.error, sendt.length], [409, "sidste_modul", 0]);
  frisbiiSub = SUB({ subscription_discounts: ["PILOTTEST_pilottest"] }); hentet.length = 0;
  r = await kald("GET /api/pakke");
  lig("GET /api/pakke for en pilot: rabatterne hentes, summen 0", [r.status, hentet.filter((x) => x.endsWith("/discount")).length, r.data.prisFraNaesteOere, r.data.rabatter.length], [200, 1, 0, 1]);
  frisbiiSub = SUB(); hentet.length = 0;
  r = await kald("GET /api/pakke");
  lig("GET /api/pakke uden rabat: rabatterne hentes ikke", [r.status, hentet.filter((x) => x.endsWith("/discount")).length], [200, 0]);
  frisbiiSub = SUB({ subscription_discounts: ["PILOTTEST_pilottest"] }); rabatNede = true;
  r = await kald("GET /api/pakke");
  lig("rabatterne svarer ikke: 502 (aldrig en forkert sum)", [r.status, r.data.error], [502, "frisbii_utilgaengelig"]);
  rabatNede = false;
  lig("ruterne findes", Object.keys(ruter).sort(), ["GET /api/pakke", "POST /api/pakke/fortryd", "POST /api/pakke/genindfoer", "POST /api/pakke/koeb", "POST /api/pakke/opsig", "POST /api/pakke/stop"]);

  console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
  console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
  process.exit(fejlet ? 1 : 0);
})();
