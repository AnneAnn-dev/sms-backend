// frisbii-modulsaet.js
// -----------------------------------------------------------------------------
// Fase 3, T2 (28/10-26): hvilke moduler har et firma ifoelge Frisbii, og
// hvor laenge? Ren funktion - ingen netvaerk, ingen database, ingen miljoe.
// Kalderen (synk, T5) henter abonnementet og dets add-ons; denne fil doemmer.
//
// REGLERNE (Ann 25/10 og 28/10, byggeplanen "Fase 3 byggeplan"):
//  - Aktivt abonnement:  til = next_period_start + 7 dages respit.
//  - Opsagt (is_cancelled): til = expires (periodens slut), INGEN respit.
//    Maalt 28/10 paa sub-0124: expires og cancelled_date findes KUN, mens
//    abonnementet er opsagt; efter "Genindfoer" er de vaek igen.
//  - I rykkerforloeb (dunning_invoices > 0 eller state on_hold):
//    til = current_period_start + 7 dage - respitten regnes fra den ubetalte
//    periode, ikke fra den naeste. IKKE MAALT (ingen fejlet betaling i
//    staging endnu) - bevises i Port 3 med et testkort, der afvises.
//  - Udloebet (state expired): til = nu. Raekkerne bliver staaende med til i
//    fortiden, saa kraevModul(..., { kunSkrivning: true }) stadig lader ham
//    laese sit eget (C17).
//  - Ukendt tilstand: ingen moduler, til = nu, og en "ukendt" - kalderen
//    giver alarm, aldrig et stille tomt saet.
//
// Add-ons laeses fra GET /subscription/{handle}/add_on (svarer [] ved ingen),
// IKKE fra abonnementets felt subscription_add_ons, som mangler helt, naar
// der ingen er (maalt 25/10).
// -----------------------------------------------------------------------------
"use strict";

const { modulerFraHandles } = require("./frisbii-katalog");

const RESPIT_DAGE = 7; // Ann 25/10: 7 dage efter faktureringsdatoen, derefter mistes adgangen
const DAG_MS = 24 * 60 * 60 * 1000;

function plusDage(iso, dage) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + dage * DAG_MS).toISOString() : null;
}

// sub: svaret fra GET /subscription/{handle}
// subAddOns: svaret fra GET /subscription/{handle}/add_on (liste)
// nu: Date eller ISO-streng (proeverne saetter den)
// Returnerer { moduler, til, grund, ukendte, dobbelt }.
function modulsaet(sub, subAddOns, nu = new Date()) {
  const nuIso = new Date(nu).toISOString();
  if (!sub || typeof sub !== "object" || !sub.handle) {
    return { moduler: [], til: nuIso, grund: "intet abonnement", ukendte: ["abonnement:mangler"], dobbelt: false };
  }
  const liste = Array.isArray(subAddOns) ? subAddOns : (subAddOns && Array.isArray(subAddOns.content) ? subAddOns.content : null);
  if (liste === null) {
    // Kunne add-ons ikke laeses, maa vi ikke gaette "ingen" - det ville fjerne moduler.
    return { moduler: [], til: nuIso, grund: "add-ons kunne ikke laeses", ukendte: ["add-ons:ulaeselige"], dobbelt: false };
  }
  const handles = liste.map((a) => (a && a.add_on && typeof a.add_on === "object" ? a.add_on.handle : a && a.add_on)).filter(Boolean);
  const { moduler, ukendte, dobbelt } = modulerFraHandles(sub.plan, handles);

  let til = null, grund;
  if (sub.state === "expired") {
    til = nuIso; grund = "udloebet";
  } else if (sub.state === "active" || sub.state === "on_hold") {
    if (sub.is_cancelled === true) {
      til = plusDage(sub.expires || sub.next_period_start, 0); grund = "opsagt";
    } else if (sub.state === "on_hold" || (Number(sub.dunning_invoices) || 0) > 0) {
      til = plusDage(sub.current_period_start || sub.next_period_start, RESPIT_DAGE); grund = "rykker";
    } else {
      til = plusDage(sub.next_period_start, RESPIT_DAGE); grund = "aktiv";
    }
  } else {
    return { moduler: [], til: nuIso, grund: `ukendt tilstand ${sub.state}`, ukendte: [...ukendte, `tilstand:${sub.state}`], dobbelt };
  }
  if (!til) {
    return { moduler: [], til: nuIso, grund: `${grund}, men ingen dato at regne fra`, ukendte: [...ukendte, "dato:mangler"], dobbelt };
  }
  return { moduler, til, grund, ukendte, dobbelt };
}

module.exports = { modulsaet, RESPIT_DAGE };
