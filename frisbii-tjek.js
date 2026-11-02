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

// ─── T1b: doem katalogets produkter ud fra GET /plan og GET /add_on ──────────
// (Fase 3, 28/10-26.) Basisplanen skal findes som aktiv version, koste 0 kr.
// og have katalogets proeveperiode. Hvert add-on, der saelges, skal findes,
// vaere aktivt, koste katalogets pris ekskl. moms, vaere on_off og kunne
// bruges paa basisplanen. Kataloget sendes med som argument, saa denne fil
// ikke selv kender Frisbii-handles.
function doemProdukter(planer, addOnSvar, salg) {
  const domme = [];
  const p = salg.plan;
  const planDomme = doemPlan(planer, p.handle, p.proevedage);
  domme.push(...planDomme);
  if (planDomme.length && planDomme[0].ok) {
    const liste = Array.isArray(planer) ? planer : (planer && Array.isArray(planer.content) ? planer.content : []);
    const aktiv = liste.find((x) => x && x.handle === p.handle && x.state === "active");
    domme.push({
      navn: `Frisbii: koster basisplanen "${p.handle}" 0 kr.?`,
      ok: aktiv && aktiv.amount === p.prisOere,
      detalje: `amount=${aktiv && aktiv.amount} - forventede ${p.prisOere}`,
    });
  }
  const alle = Array.isArray(addOnSvar) ? addOnSvar : (addOnSvar && Array.isArray(addOnSvar.content) ? addOnSvar.content : []);
  for (const a of salg.addOns) {
    const f = alle.find((x) => x && x.handle === a.handle);
    const navn = `Frisbii: add-on "${a.handle}" (${a.navn})?`;
    if (!f) { domme.push({ navn, ok: false, detalje: "findes ikke - koer opret-frisbii-produkter.js" }); continue; }
    const afvig = [];
    if (f.state !== "active") afvig.push(`state=${f.state}`);
    if (f.amount !== a.prisOere) afvig.push(`amount=${f.amount}, forventede ${a.prisOere}`);
    if (f.amount_incl_vat !== false) afvig.push(`amount_incl_vat=${f.amount_incl_vat}, forventede false`);
    if (f.type !== "on_off") afvig.push(`type=${f.type}, forventede on_off`);
    const planOk = f.all_plans === true || (Array.isArray(f.eligible_plans) && f.eligible_plans.includes(p.handle));
    if (!planOk) afvig.push(`kan ikke bruges paa ${p.handle}`);
    domme.push({ navn, ok: afvig.length === 0, detalje: afvig.length ? afvig.join("; ") : `${a.prisOere / 100} kr. ekskl. moms, aktiv` });
  }
  return domme;
}

module.exports = { doemPlan, doemTestFelt, nyesteAbonnementFraEvents, doemProdukter };
