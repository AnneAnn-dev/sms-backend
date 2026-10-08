// adresse.js
// -----------------------------------------------------------------------------
// Vores eget adresse-endpoint foran Klimadatastyrelsens Adressevaelger (D77).
//
// HVORFOR ET MELLEMLED: DAWA lukkede 1/10-26, og adressen paa tjenesten stod
// tre steder (kundeformularen i server.js, dashboard.html, vagt.js). Nu staar
// den ét sted — her — og browseren taler kun med os:
//   GET /api/adresse/soeg?q=...   -> { ok, forslag: [{ id, tekst }] }
//   GET /api/adresse/status       -> { ok }          (cachet 60 sek.)
//   GET /api/adresse/:id          -> { ok, tekst, vej, postnr, by }
// Svarer Adressevaelgeren ikke, svarer vi 503 { ok:false, nede:true }, og
// formularerne viser deres reservevej (postnr + by i egne felter).
//
// TOKEN: KDS anbefaler i dag én faelles, offentlig token ("adressevaelger123").
// Naar brugerstyring indfoeres (forventet ultimo 2026 / primo 2027), holder den
// op med at virke, og vi skal have vores egen. Den skal saa saettes som
// ADRESSE_TOKEN i Railway — og fordi kaldet gaar gennem serveren, kommer en
// privat token aldrig ud i browseren. Datoen staar i aarshjulet og i vagtens
// VAGT_UDLOEBSDATOER. KDS-svar 8/10-26; notifikationsservicen er tilmeldt.
//
// API'et (maalt 8/10-26 fra Anns maskine, ikke laest i en doku):
//   GET {API}/husnumre/soeg?tekst=...&maksimum=N&token=...
//       -> { status:"ok", fund:[{ type:"husnummer", id, titel, vejnavn, husnummer }] }
//   GET {API}/husnumre/{id}?token=...
//       -> { status:"ok", husnummer:{ adgangsadressebetegnelse, vejnavn,
//            husnummertekst, postnummer:{ postnr, navn }, supplerendebynavn:{ navn } } }
//   Ved fejl kan svaret vaere 200 med status:"fejl" — det behandles som nede.
//
// PERSONDATA: en adresse, kunden taster, er persondata. Den logges ALDRIG —
// kun statuskoder. Samme regel for id'et (det peger paa en bolig).
//
// LOFT: endpointet er offentligt (kundeformularen har intet login), saa det er
// en aaben dør ind til KDS med vores IP paa. Loftet er sat, saa en kunde, der
// taster en hel adresse, aldrig maerker det (et kald pr. tastetryk efter 200 ms
// pause), men en maskine stoppes.
// -----------------------------------------------------------------------------

"use strict";

const { opretLoft, klientIp } = require("./ratelimit");

const API_URL   = (process.env.ADRESSE_API_URL || "https://adressevaelger.dk").replace(/\/+$/, "");
const TOKEN     = process.env.ADRESSE_TOKEN || "adressevaelger123";   // offentlig faelles token, se ovenfor
const TIMEOUT_MS = 5000;
const MAKS_FORSLAG = 8;

const loft = opretLoft({ navn: "adresse", maks: 120, vinduetMs: 10 * 60 * 1000 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hentKds(sti) {
  const sep = sti.includes("?") ? "&" : "?";
  const res = await fetch(`${API_URL}${sti}${sep}token=${encodeURIComponent(TOKEN)}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) { const e = new Error("kds"); e.status = res.status; throw e; }
  const data = await res.json();
  if (!data || data.status !== "ok") { const e = new Error("kds"); e.status = "fejl-i-svar"; throw e; }
  return data;
}

// Kun statuskode eller fejltype i loggen — aldrig adressen, id'et eller URL'en
// (URL'en baerer tokenen, og den er privat, naar brugerstyringen kommer).
function logFejl(hvor, e) {
  console.warn(`⚠️  adresse/${hvor}: Adressevaelgeren svarede ikke (${e.status || e.name})`);
}

// Rens soegeteksten: kun almindelige tegn, maks 73 (Adressevaelgerens egen graense).
function rensSoeg(q) {
  return String(q || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 73);
}

let statusCache = { tid: 0, ok: false };

module.exports = function (app) {
  function loftet(req, res) {
    const r = loft.tjek(klientIp(req) || "ukendt");
    if (r.blokeret) {
      res.set("Retry-After", String(r.nulstillerOm));
      res.status(429).json({ ok: false, loft: true });
      return true;
    }
    return false;
  }

  app.get("/api/adresse/status", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (Date.now() - statusCache.tid < 60_000) return res.status(statusCache.ok ? 200 : 503).json({ ok: statusCache.ok, nede: !statusCache.ok });
    try {
      await hentKds("/husnumre/soeg?tekst=a&maksimum=1");
      statusCache = { tid: Date.now(), ok: true };
    } catch (e) {
      logFejl("status", e);
      statusCache = { tid: Date.now(), ok: false };
    }
    res.status(statusCache.ok ? 200 : 503).json({ ok: statusCache.ok, nede: !statusCache.ok });
  });

  app.get("/api/adresse/soeg", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (loftet(req, res)) return;
    const q = rensSoeg(req.query.q);
    if (q.length < 2) return res.json({ ok: true, forslag: [] });
    try {
      const data = await hentKds(`/husnumre/soeg?tekst=${encodeURIComponent(q)}&maksimum=${MAKS_FORSLAG}`);
      const forslag = (Array.isArray(data.fund) ? data.fund : [])
        .filter((f) => f && f.id && f.titel)
        .map((f) => ({ id: String(f.id), tekst: String(f.titel) }));
      res.json({ ok: true, forslag });
    } catch (e) {
      logFejl("soeg", e);
      res.status(503).json({ ok: false, nede: true });
    }
  });

  app.get("/api/adresse/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (loftet(req, res)) return;
    if (!UUID.test(req.params.id)) return res.status(400).json({ ok: false });
    try {
      const data = await hentKds(`/husnumre/${req.params.id}`);
      const h = data.husnummer || {};
      const postnr = h.postnummer && h.postnummer.postnr ? String(h.postnummer.postnr) : "";
      const by     = h.postnummer && h.postnummer.navn   ? String(h.postnummer.navn)   : "";
      if (!/^\d{4}$/.test(postnr) || !by) {
        // Et husnummer uden postnummer kan ikke bruges i et lead — svar som
        // "ikke fundet", saa formularen beder om postnr/by i haanden.
        return res.status(404).json({ ok: false });
      }
      const vej = [h.vejnavn, h.husnummertekst].filter(Boolean).join(" ");
      const supp = h.supplerendebynavn && h.supplerendebynavn.navn ? String(h.supplerendebynavn.navn) : "";
      res.json({
        ok: true,
        tekst: String(h.adgangsadressebetegnelse || `${vej}, ${postnr} ${by}`),
        vej: supp ? `${vej}, ${supp}` : vej,
        postnr,
        by,
      });
    } catch (e) {
      logFejl("opslag", e);
      res.status(503).json({ ok: false, nede: true });
    }
  });

  console.log("🏠 Adresse-endpoint registreret paa /api/adresse (Adressevaelger)");
};
