// frisbii-pakke.js
// -----------------------------------------------------------------------------
// Fase 3, T9a (31/10-26): "Din pakke" - kunden ser og aendrer sit abonnement
// fra Profil. Kun bag FASE3_SYNK. Indlaeses fra server.js med:
//   require("./frisbii-pakke")(app, supabase);
//
//   GET  /api/pakke              moduler, priser, status, datoer
//   POST /api/pakke/koeb         { modul }  tilkoeb, gaelder straks
//   POST /api/pakke/stop         { modul }  stop fra naeste periode
//   POST /api/pakke/fortryd      { modul }  fortryd et stop
//   POST /api/pakke/opsig        opsig hele abonnementet (periodens slut)
//   POST /api/pakke/genindfoer   fortryd opsigelsen
//
// Reglerne (Ann 25/10 + 28/10 + 31/10) og MAALINGERNE 31/10 (staging, sub-0139),
// som de rene funktioner herunder er bygget paa:
//   - Stop = PUT {timing: "renewal", remove_add_ons}. Modulet virker perioden ud.
//   - En straks-aendring (tilkoeb) SLETTER et ventende stop -> efter et tilkoeb
//     sendes de ventende stop igen. Et nyt stop ERSTATTER det forrige -> alle
//     stop sendes samlet. (docs "changesubscription" + maalt.)
//   - Fortryd = {timing: "renewal", cancel_change: true} (eller de resterende
//     stop igen). ALDRIG et nyt tilkoeb: det gav et ekstra eksemplar af samme
//     modul og dobbeltbetaling (maalt 31/10).
//   - Det sidste modul kan ikke stoppes; i stedet "Opsig abonnementet".
//   - Gammel plan (abonnement-standard): ingen aendringer herfra - add-ons kan
//     kun saettes paa ddk-basis. Kunden skriver til os (Ann 31/10, valg C).
//   - Efter hver aendring synkes firmaet straks, saa appen viser det nye.
//     Webhooken synker ogsaa og tildeler et nummer, hvis Telefonpasser koebes.
//   - Rabat (1/11-26, Ann: "summen skal vaere 0" for en pilot): har
//     abonnementet rabatter (subscription_discounts), hentes de med
//     GET /subscription/{h}/discount. En aktiv rabat, der gaelder alt eller
//     add-ons, vises som en linje og traekkes fra summerne. Maalt 1/11
//     (sub-0140): pilot-gratis, percentage 100, apply_to ["all"]. Modulernes
//     egne priser er uaendrede (prisen paa en raekke er listeprisen).
// -----------------------------------------------------------------------------
"use strict";

const { FASE3_SYNK } = require("./flags");
const { KATALOG } = require("./frisbii-katalog");
const { firmIdFromToken } = require("./auth");
const { synkFirma } = require("./frisbii-synk");
const { lavFrisbiiGet } = require("./frisbii-miljoe");

const API = "https://api.frisbii.com/v1";

const addOnHandle = (x) => (x && typeof x.add_on === "object" ? x.add_on && x.add_on.handle : x && x.add_on);

function handleTilModul(katalog = KATALOG) {
  const m = {};
  for (const [modul, a] of Object.entries(katalog.MODUL_ADDONS)) m[a.handle] = modul;
  return m;
}

// De rabatter, der rammer modulerne: aktive, ikke opbrugte, og gaelder "all"
// eller "add_on". Ren funktion. rabatter: GET /subscription/{h}/discount.
function virkendeRabatter(rabatter) {
  const liste = Array.isArray(rabatter) ? rabatter : (rabatter && Array.isArray(rabatter.content) ? rabatter.content : []);
  return liste
    .filter((r) => r && r.state === "active" && !r.fixed_usage_reached && !r.fixed_period_passed)
    .filter((r) => (r.apply_to || []).some((x) => x === "all" || x === "add_on"))
    .map((r) => {
      const procent = typeof r.percentage === "number" ? r.percentage : null;
      const beloebOere = procent === null && typeof r.amount === "number" ? r.amount : null;
      return { navn: r.name || (r.discount_dto && r.discount_dto.name) || "Rabat", procent, beloebOere };
    })
    .filter((r) => r.procent !== null || r.beloebOere !== null);
}

// Prisen efter rabatterne, i oere. Ren funktion.
function efterRabat(oere, rabatter) {
  let x = oere;
  for (const r of rabatter || []) {
    if (r.procent !== null) x = Math.round(x * (100 - Math.min(100, Math.max(0, r.procent))) / 100);
    else x = Math.max(0, x - r.beloebOere);
  }
  return x;
}

// Abonnementets tilstand, laest ud af Frisbiis svar. Ren funktion.
// sub: GET /subscription/{h}; addOns: GET /subscription/{h}/add_on (liste);
// rabatter: GET /subscription/{h}/discount (kun hvis subscription_discounts).
function tilstand(sub, addOns, katalog = KATALOG, rabatter = null) {
  const tilModul = handleTilModul(katalog);
  const liste = Array.isArray(addOns) ? addOns : (addOns && Array.isArray(addOns.content) ? addOns.content : []);
  const pc = sub && sub.pending_change && sub.pending_change.pending ? sub.pending_change : null;
  const ventendeStop = new Set((pc && pc.remove_add_ons) || []);
  const instanser = {};   // modul -> [instans-handles]
  const ukendte = [];
  for (const x of liste) {
    const h = addOnHandle(x);
    const m = tilModul[h];
    if (m) (instanser[m] = instanser[m] || []).push(x.handle);
    else ukendte.push(h);
  }
  return {
    plan: sub && sub.plan,
    gammelPlan: !!(sub && Object.prototype.hasOwnProperty.call(katalog.GAMLE_PLANER, sub.plan)),
    opsagt: !!(sub && sub.is_cancelled),
    udloeber: (sub && sub.expires) || null,
    naestePeriode: (sub && sub.next_period_start) || null,
    proeveTil: sub && sub.in_trial ? sub.trial_end || null : null,
    instanser, ventendeStop: [...ventendeStop], ukendte,
    andreAendringer: !!(pc && pc.add_ons && pc.add_ons.length),
    rabatter: virkendeRabatter(rabatter),
  };
}

// Det, appen viser. Ren funktion.
function visning(t, katalog = KATALOG) {
  const vent = new Set(t.ventendeStop);
  const moduler = [];
  let nu = 0, fraNaeste = 0;
  for (const [modul, a] of Object.entries(katalog.MODUL_ADDONS)) {
    const inst = t.instanser[modul] || [];
    const aktiv = inst.length > 0;
    const stopper = aktiv && inst.every((h) => vent.has(h));
    if (!aktiv && !a.saelges && !a.kommer) continue;
    let status = aktiv ? (stopper ? "stopper" : "aktiv") : (a.saelges ? "kan-koebes" : "kommer");
    if (t.opsagt && aktiv) status = "stopper";
    nu += aktiv ? a.prisOere * inst.length : 0;
    if (aktiv && !stopper && !t.opsagt) fraNaeste += a.prisOere * inst.length;
    moduler.push({ modul, navn: a.navn, prisOere: a.prisOere, status, dobbelt: inst.length > 1 });
  }
  const aktive = moduler.filter((m) => m.status === "aktiv").length;
  return {
    gammelPlan: t.gammelPlan, opsagt: t.opsagt,
    stopDato: t.opsagt ? t.udloeber : t.naestePeriode,
    proeveTil: t.proeveTil,
    moduler: moduler.map((m) => ({ ...m, sidste: m.status === "aktiv" && aktive === 1 })),
    rabatter: t.rabatter || [],
    prisFoerRabatOere: fraNaeste,
    prisNuOere: efterRabat(nu, t.rabatter), prisFraNaesteOere: efterRabat(fraNaeste, t.rabatter),
    saerlig: t.ukendte.length > 0 || t.andreAendringer,
  };
}

// Hvilke kald mod Frisbii skal der til? Ren funktion.
// Returnerer { kald: [{ metode, sti, krop }] } eller { fejl, status }.
function planlaeg(handling, modul, t, { sub, katalog = KATALOG, nyHandle } = {}) {
  const s = `/subscription/${encodeURIComponent(sub)}`;
  if (t.gammelPlan) return { fejl: "gammel_plan", status: 409 };
  if (t.ukendte.length || t.andreAendringer) return { fejl: "saerligt_abonnement", status: 409 };
  if (handling === "opsig") return t.opsagt ? { fejl: "allerede_opsagt", status: 409 } : { kald: [{ metode: "POST", sti: `${s}/cancel`, krop: {} }] };
  if (handling === "genindfoer") return t.opsagt ? { kald: [{ metode: "POST", sti: `${s}/uncancel`, krop: {} }] } : { fejl: "ikke_opsagt", status: 409 };
  if (t.opsagt) return { fejl: "opsagt", status: 409 };

  const a = katalog.MODUL_ADDONS[modul];
  if (!a) return { fejl: "ukendt_modul", status: 400 };
  const inst = t.instanser[modul] || [];
  const vent = new Set(t.ventendeStop);
  const stopper = inst.length > 0 && inst.every((h) => vent.has(h));
  const genStop = (liste) => liste.length
    ? { metode: "PUT", sti: s, krop: { timing: "renewal", remove_add_ons: liste } }
    : { metode: "PUT", sti: s, krop: { timing: "renewal", cancel_change: true } };

  if (handling === "koeb") {
    if (stopper) return planlaeg("fortryd", modul, t, { sub, katalog });   // aldrig et ekstra eksemplar
    if (inst.length) return { fejl: "har_modulet", status: 409 };
    if (!a.saelges) return { fejl: "saelges_ikke", status: 400 };
    const kald = [{ metode: "PUT", sti: s, krop: { timing: "immediate", add_ons: [{ add_on: a.handle, handle: nyHandle || `${a.handle}-${Date.now().toString(36)}` }] } }];
    if (t.ventendeStop.length) kald.push(genStop(t.ventendeStop)); // straks-aendringen slettede dem
    return { kald };
  }
  if (handling === "stop") {
    if (!inst.length) return { fejl: "har_ikke_modulet", status: 409 };
    if (stopper) return { fejl: "stopper_allerede", status: 409 };
    const andreAktive = Object.entries(t.instanser).filter(([m, hs]) => m !== modul && hs.some((h) => !vent.has(h))).length;
    if (andreAktive === 0) return { fejl: "sidste_modul", status: 409 };
    return { kald: [genStop([...new Set([...t.ventendeStop, ...inst])])] };
  }
  if (handling === "fortryd") {
    if (!stopper) return { fejl: "stopper_ikke", status: 409 };
    const tilbage = t.ventendeStop.filter((h) => !inst.includes(h));
    return { kald: [genStop(tilbage)] };
  }
  return { fejl: "ukendt_handling", status: 400 };
}

function lavFrisbiiSkriv(noegle, fetchFn = fetch) {
  const auth = "Basic " + Buffer.from(noegle + ":").toString("base64");
  return async function skriv({ metode, sti, krop }) {
    const r = await fetchFn(API + sti, { method: metode, headers: { Authorization: auth, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(krop || {}) });
    let data = null; try { data = await r.json(); } catch (e) { data = null; }
    return { ok: r.ok, status: r.status, data };
  };
}

function pakkeModul(app, supabase, { noegle = process.env.FRISBII_PRIVATE_KEY, fetchFn = fetch, log = console } = {}) {
  if (!FASE3_SYNK) return;
  const hent = lavFrisbiiGet(noegle, fetchFn);
  const skriv = lavFrisbiiSkriv(noegle, fetchFn);

  // Frisbiis tre svar -> tilstand, eller null (Frisbii svarede ikke).
  async function hentTilstand(sub) {
    const h = encodeURIComponent(sub);
    const [s, a] = [await hent(`/subscription/${h}`), await hent(`/subscription/${h}/add_on`)];
    if (!s.ok || !a.ok) { log.error(`❌ /api/pakke: Frisbii svarede ${s.status}/${a.status} for ${sub}`); return null; }
    let rabatter = null;
    if (s.data && Array.isArray(s.data.subscription_discounts) && s.data.subscription_discounts.length) {
      const d = await hent(`/subscription/${h}/discount`);
      if (!d.ok) { log.error(`❌ /api/pakke: Frisbii svarede ${d.status} paa rabatterne for ${sub}`); return null; }
      rabatter = d.data;
    }
    return tilstand(s.data, a.data, KATALOG, rabatter);
  }

  async function firmaOgTilstand(req, res) {
    const firmId = await firmIdFromToken(supabase, req);
    if (!firmId) { res.status(401).json({ error: "Ikke logget ind" }); return null; }
    const { data: firma, error } = await supabase.from("firms").select("id, frisbii_subscription").eq("id", firmId).maybeSingle();
    if (error || !firma) { res.status(503).json({ error: "firma_utilgaengeligt" }); return null; }
    if (!firma.frisbii_subscription) { res.json({ abonnement: false }); return null; }
    const sub = firma.frisbii_subscription;
    const t = await hentTilstand(sub);
    if (!t) { res.status(502).json({ error: "frisbii_utilgaengelig" }); return null; }
    return { firma, sub, t };
  }

  app.get("/api/pakke", async (req, res) => {
    try {
      const f = await firmaOgTilstand(req, res);
      if (!f) return;
      res.set("Cache-Control", "no-store");
      res.json({ abonnement: true, ...visning(f.t) });
    } catch (e) {
      log.error("❌ /api/pakke:", e.message);
      res.status(500).json({ error: "serverfejl" });
    }
  });

  for (const handling of ["koeb", "stop", "fortryd", "opsig", "genindfoer"]) {
    app.post(`/api/pakke/${handling}`, async (req, res) => {
      try {
        const f = await firmaOgTilstand(req, res);
        if (!f) return;
        const modul = req.body && typeof req.body.modul === "string" ? req.body.modul : null;
        const p = planlaeg(handling, modul, f.t, { sub: f.sub });
        if (p.fejl) return res.status(p.status).json({ error: p.fejl });
        for (const k of p.kald) {
          const r = await skriv(k);
          if (!r.ok) {
            log.error(`❌ /api/pakke/${handling}: Frisbii afviste ${k.metode} ${k.sti} (${r.status}):`, JSON.stringify(r.data));
            return res.status(502).json({ error: "frisbii_afviste" });
          }
        }
        log.log(`📦 Din pakke: ${handling}${modul ? " " + modul : ""} paa ${f.sub} (firma ${String(f.firma.id).slice(0, 8)})`);
        try {
          await synkFirma({ supabase, hent, abonnement: f.sub, skriv: true });
        } catch (e) {
          log.error("⚠️  /api/pakke: synk efter aendringen fejlede (webhooken proever ogsaa):", e.message);
        }
        const ny = await hentTilstand(f.sub);
        res.json({ ok: true, abonnement: true, ...(ny ? visning(ny) : {}) });
      } catch (e) {
        log.error(`❌ /api/pakke/${handling}:`, e.message);
        res.status(500).json({ error: "serverfejl" });
      }
    });
  }
  log.log("📦 Din pakke registreret paa /api/pakke (FASE3_SYNK)");
}

module.exports = pakkeModul;
module.exports.tilstand = tilstand;
module.exports.visning = visning;
module.exports.planlaeg = planlaeg;
module.exports.virkendeRabatter = virkendeRabatter;
module.exports.efterRabat = efterRabat;
