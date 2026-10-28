// frisbii-tjek.js
// -----------------------------------------------------------------------------
// Rene domme over Frisbiis svar - brugt af BAADE check-env.js (staging) og
// check-env-prod.js (prod). Ingen netvaerk, ingen miljoe-variabler: kalderen
// henter svaret, denne fil doemmer det. Saa er reglen ét sted, og staging og
// prod kan ikke glide fra hinanden (CLAUDE.md: "ingen ny dublet").
//
// Flyttet hertil 28/10-26 fra check-env.js (D26 bevist 27/10, D41 bevist 27/10)
// uden aendringer i logikken.
// -----------------------------------------------------------------------------
"use strict";

// ─── D41: doem test-feltet paa et abonnement ────────────────────────────────
// Ren funktion (ingen netvaerk), saa den kan proeves med kendte svar.
// Fail-closed: mangler abonnementet eller feltet, er svaret FEJL, ikke "ok".
function doemTestFelt(sub, subHandle, forventet) {
  const navn = "Frisbii: hoerer noeglen til testsiden (abonnementets test-felt)?";
  if (!sub || typeof sub !== "object") {
    return { navn, ok: false, detalje: "intet abonnement at aflaese - opret et testkoeb i staging, eller se D41" };
  }
  if (!Object.prototype.hasOwnProperty.call(sub, "test")) {
    return { navn, ok: false, detalje: `abonnement ${subHandle} har intet test-felt - Frisbii har aendret svaret?` };
  }
  const ok = sub.test === forventet;
  return {
    navn,
    ok,
    detalje: `abonnement ${subHandle}: test=${JSON.stringify(sub.test)} - forventede ${forventet}` +
      (ok ? "" : (sub.test === false ? " (LIVE-siden: rigtige penge!)" : "")),
  };
}

// ─── D26: doem planen ud fra Frisbiis svar paa GET /plan ──────────────────────
// Ren funktion (ingen netvaerk), saa den kan proeves med kendte svar.
// MAALT 25/10-26: GET /plan svarer med ALLE versioner af en plan under samme
// handle (12 raekker i staging, heraf én "active"; de oevrige "superseded" eller
// "deleted"). Derfor vaelges versionen med state=active - en gammel version med
// 5 dages proeve maa hverken goere tjekket groent eller roedt.
// Tre spoergsmaal, ikke ét (hullet fundet 16/8): planen findes ikke ·
// proeveperioden er tom · proeveperioden afviger fra det forventede.
function doemPlan(planer, handle, forventetDage) {
  const liste = Array.isArray(planer) ? planer : (planer && Array.isArray(planer.content) ? planer.content : []);
  const aktive = liste.filter((p) => p && p.handle === handle && p.state === "active");
  const domme = [];
  domme.push({
    navn: `Frisbii: findes planen "${handle}" som aktiv version?`,
    ok: aktive.length === 1,
    detalje: aktive.length === 1
      ? `ja (version ${aktive[0].version ?? "?"})`
      : `fundet ${aktive.length} aktive versioner af ${liste.filter((p) => p && p.handle === handle).length} med det handle - forventede 1`,
  });
  if (aktive.length !== 1) return domme; // de to naeste giver ingen mening uden en plan
  const p = aktive[0];
  const laengde = p.trial_interval_length;
  const enhed = p.trial_interval_unit;
  const harProeve = Number.isFinite(laengde) && laengde > 0 && !!enhed;
  domme.push({
    navn: "Frisbii: har planen en proeveperiode?",
    ok: harProeve,
    detalje: harProeve ? `${laengde} ${enhed}` : "NEJ - feltet er tomt; kunden ville blive trukket med det samme (D26)",
  });
  if (!harProeve) return domme;
  const rigtig = enhed === "days" && laengde === forventetDage;
  domme.push({
    navn: `Frisbii: er proeveperioden ${forventetDage} dage?`,
    ok: rigtig,
    detalje: rigtig ? `${laengde} ${enhed} (= forventet)` : `fundet ${laengde} ${enhed} - forventede ${forventetDage} days`,
  });
  return domme;
}

// Det nyeste abonnement i kontoens events. /list/subscription svarer 422
// (maalt 25/10), saa abonnementet findes via /event.
function nyesteAbonnementFraEvents(evData) {
  const ev = (Array.isArray(evData) ? evData : (evData && Array.isArray(evData.content) ? evData.content : []))
    .filter((e) => e && e.subscription)
    .sort((x, y) => String(y.created || "").localeCompare(String(x.created || "")));
  return ev.length ? ev[0].subscription : null;
}

module.exports = { doemPlan, doemTestFelt, nyesteAbonnementFraEvents };
