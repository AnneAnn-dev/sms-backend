// proev-frisbii-synk.js -- proever frisbii-synk.js (synkFirma) og
// frisbii-miljoe.js med attrapper for Supabase og Frisbii. Ingen netvaerk,
// ingen database, ingen miljoevariabler (koeres i CI via kor-proever.js).
//
//   node proev-frisbii-synk.js
//
// Fase 3, T5 (29/10-26). Ren ASCII.
"use strict";

const { synkFirma } = require("./frisbii-synk");
const { bestemMiljoe } = require("./frisbii-miljoe");

let bestaaet = 0, fejlet = 0;
const ok = (n, d) => (bestaaet++, console.log(`  OK    ${n}${d ? "  -  " + d : ""}`));
const nej = (n, d) => (fejlet++, console.log(`  FEJL  ${n}  -  ${d}`));
const lig = (n, faktisk, forventet) => {
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  return a === b ? ok(n, a) : nej(n, `fik ${a}, forventede ${b}`);
};

const NU = "2026-10-29T06:00:00.000Z";
const SUB = { handle: "sub-0124", state: "active", plan: "abonnement-standard", is_cancelled: false,
  next_period_start: "2026-11-01T09:42:23.632+00:00", dunning_invoices: 0 };

// Attrap for Supabase: firms + firma_moduler + rpc. Taeller kald til rpc.
function attrapDb({ firma = { id: "F1", status: "active", billing_status: "active", phone_number: "+45" }, raekker = [], fejl = {} } = {}) {
  const kald = { rpc: [] };
  const db = {
    kald,
    from(tabel) {
      const q = {
        select() { return q; },
        eq() { return q; },
        maybeSingle: async () => (fejl.firms ? { data: null, error: { message: "nede" } } : { data: firma, error: null }),
        then(res) { res(fejl.moduler ? { data: null, error: { message: "nede" } } : { data: raekker, error: null }); },
      };
      if (tabel !== "firms" && tabel !== "firma_moduler") throw new Error("ukendt tabel " + tabel);
      return q;
    },
    async rpc(navn, args) {
      kald.rpc.push({ navn, args });
      if (fejl.rpc) return { data: null, error: { message: "check_violation" } };
      return { data: { oprettet: [], fornyet: args.p_moduler, overtaget: [], afsluttet: [], slettet: [] }, error: null };
    },
  };
  return db;
}
function attrapFrisbii({ sub = SUB, addOns = [], status = {} } = {}) {
  return async (sti) => {
    if (sti === "/account") return { ok: true, status: 200, data: { handle: status.konto || "lommekontor" } };
    if (sti.endsWith("/add_on")) return status.addOn ? { ok: false, status: status.addOn, data: null } : { ok: true, status: 200, data: addOns };
    if (sti.startsWith("/subscription/")) return status.sub ? { ok: false, status: status.sub, data: null } : { ok: true, status: 200, data: sub };
    return { ok: false, status: 404, data: null };
  };
}
const addOn = (h) => ({ handle: "i-" + h, add_on: { handle: h } });
const telefonAuto = { modul: "telefon", fra: "2026-10-25T00:00:00Z", til: null, kilde: "auto" };
async function kaster(fn) { try { await fn(); return false; } catch (e) { return e.message; } }

(async () => {
  console.log("1. Toerkoersel og skrivning");
  let db = attrapDb({ raekker: [telefonAuto] });
  let r = await synkFirma({ supabase: db, hent: attrapFrisbii(), abonnement: "sub-0124", nu: NU });
  lig("uden skriv: toerkoersel, rpc ikke kaldt", [r.status, db.kald.rpc.length], ["toerkoersel", 0]);
  lig("  ... og den viser det saet, der ville blive skrevet", [r.saet.moduler, r.saet.til], [["telefon"], "2026-11-08T09:42:23.632Z"]);
  db = attrapDb({ raekker: [telefonAuto] });
  r = await synkFirma({ supabase: db, hent: attrapFrisbii(), abonnement: "sub-0124", nu: NU, skriv: true });
  lig("med skriv: rpc kaldt en gang med firma, moduler og til", [r.status, db.kald.rpc],
    ["skrevet", [{ navn: "synk_frisbii_moduler", args: { p_firm: "F1", p_moduler: ["telefon"], p_til: "2026-11-08T09:42:23.632Z" } }]]);

  console.log("\n2. Ukendte produkter: skriver aldrig af sig selv");
  db = attrapDb({ raekker: [telefonAuto] });
  r = await synkFirma({ supabase: db, hent: attrapFrisbii({ addOns: [addOn("fase3-maaling-a")] }), abonnement: "sub-0124", nu: NU, skriv: true });
  lig("ukendt add-on + skriv: status ukendt, rpc IKKE kaldt", [r.status, db.kald.rpc.length], ["ukendt", 0]);
  db = attrapDb({ raekker: [telefonAuto] });
  r = await synkFirma({ supabase: db, hent: attrapFrisbii({ addOns: [addOn("fase3-maaling-a")] }), abonnement: "sub-0124", nu: NU, skriv: true, ignorerUkendte: true });
  lig("ukendt add-on + skriv + ignorerUkendte: skriver de kendte", [r.status, db.kald.rpc[0] && db.kald.rpc[0].args.p_moduler], ["skrevet", ["telefon"]]);

  console.log("\n3. Ingen firma");
  db = attrapDb({ firma: null });
  r = await synkFirma({ supabase: db, hent: attrapFrisbii(), abonnement: "sub-0122", nu: NU, skriv: true });
  lig("abonnement uden firma: 'intet firma', rpc ikke kaldt", [r.status, db.kald.rpc.length], ["intet firma", 0]);

  console.log("\n4. Fejl kaster (saa webhooken kan dead-lettere og proeve igen)");
  lig("Frisbii-abonnement 500 -> kaster", !!(await kaster(() => synkFirma({ supabase: attrapDb(), hent: attrapFrisbii({ status: { sub: 500 } }), abonnement: "sub-0124", nu: NU, skriv: true }))), true);
  db = attrapDb();
  const m = await kaster(() => synkFirma({ supabase: db, hent: attrapFrisbii({ status: { addOn: 503 } }), abonnement: "sub-0124", nu: NU, skriv: true }));
  lig("add-ons kan ikke laeses -> kaster, rpc IKKE kaldt (aldrig 'ingen moduler')", [!!m, db.kald.rpc.length], [true, 0]);
  lig("databasen nede -> kaster", !!(await kaster(() => synkFirma({ supabase: attrapDb({ fejl: { firms: true } }), hent: attrapFrisbii(), abonnement: "sub-0124", nu: NU }))), true);
  lig("databasefunktionen afviser -> kaster", !!(await kaster(() => synkFirma({ supabase: attrapDb({ fejl: { rpc: true } }), hent: attrapFrisbii(), abonnement: "sub-0124", nu: NU, skriv: true }))), true);
  lig("intet abonnement -> kaster", !!(await kaster(() => synkFirma({ supabase: attrapDb(), hent: attrapFrisbii(), nu: NU }))), true);

  console.log("\n5. Samme miljoe paa begge sider (frisbii-miljoe.js)");
  const S = "https://hehrvdmtzokzbnbihcel.supabase.co", P = "https://glymuxqtrbpeyzmflilf.supabase.co";
  lig("staging + lommekontor = enig", (await bestemMiljoe(S, attrapFrisbii())).enig, true);
  lig("prod + test-2-lommekontor = enig", (await bestemMiljoe(P, attrapFrisbii({ status: { konto: "test-2-lommekontor" } }))).enig, true);
  lig("prod-database + staging-Frisbii = IKKE enig", (await bestemMiljoe(P, attrapFrisbii())).enig, false);
  lig("staging-database + 'Dur ikke' = IKKE enig", (await bestemMiljoe(S, attrapFrisbii({ status: { konto: "test-2-lommekontor_test" } }))).enig, false);
  lig("ukendt projekt = IKKE enig", (await bestemMiljoe("https://andet.supabase.co", attrapFrisbii())).enig, false);

  console.log(`\n${bestaaet}/${bestaaet + fejlet}`);
  console.log(`${bestaaet} bestaaet, ${fejlet} fejlet.`);
  process.exit(fejlet ? 1 : 0);
})();
