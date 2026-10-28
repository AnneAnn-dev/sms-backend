// frisbii-afstem.js
// -----------------------------------------------------------------------------
// Fase 3, T3 (28/10-26): sammenligner Frisbii med databasen for et firma.
// Ren funktion - ingen netvaerk, ingen database. Bruges af afstem-frisbii.js
// (og senere af synk og gensynk, saa de doemmer ens).
//
// Afstemning er sandheden (D15, AA2): Frisbii bestemmer, hvad der er koebt;
// databasen skal foelge. Hver uenighed er en linje, et menneske laeser.
// -----------------------------------------------------------------------------
"use strict";

// Raekker, som synk (T5) styrer. Manuelle raekker (pilotmoduler) roeres ikke
// af synk og er derfor kun information her.
const SYNK_KILDER = ["frisbii", "auto", "migration", "pakke", "proeve"];

function aktivNu(r, nu) {
  const t = Date.parse(nu);
  return Date.parse(r.fra) <= t && (r.til == null || Date.parse(r.til) > t);
}

// Hvad SKAL billing_status vaere ifoelge Frisbii? (samme ord som webhooken skriver)
function forventetBillingStatus(sub) {
  if (!sub) return null;
  if (sub.state === "expired") return "expired";
  if (sub.is_cancelled === true) return "cancelled";
  if (sub.state === "on_hold" || (Number(sub.dunning_invoices) || 0) > 0) return "past_due";
  if (sub.state === "active") return "active";
  return null;
}

// sub: Frisbiis abonnement. saet: modulsaet(sub, addOns, nu). firma: raekken
// fra firms. raekker: firmaets raekker i firma_moduler. nu: ISO.
// Returnerer { uenig: [tekst], info: [tekst] }.
function sammenlignFirma({ sub, saet, firma, raekker, nu }) {
  const uenig = [], info = [];
  const t = Date.parse(nu);

  // 1) Moduler
  const fraFrisbii = Date.parse(saet.til) > t ? [...saet.moduler].sort() : [];
  const synkRaekker = (raekker || []).filter((r) => SYNK_KILDER.includes(r.kilde));
  const iDb = [...new Set(synkRaekker.filter((r) => aktivNu(r, nu)).map((r) => r.modul))].sort();
  const mangler = fraFrisbii.filter((m) => !iDb.includes(m));
  const gratis = iDb.filter((m) => !fraFrisbii.includes(m));
  if (mangler.length) uenig.push(`betaler for ${mangler.join(", ")}, men har det ikke i databasen`);
  if (gratis.length) uenig.push(`har ${gratis.join(", ")} i databasen uden at Frisbii siger det` +
    (saet.grund === "udloebet" ? " (abonnementet er udloebet)" : ""));
  const manuelle = (raekker || []).filter((r) => r.kilde === "manuel" && aktivNu(r, nu)).map((r) => r.modul).sort();
  if (manuelle.length) info.push(`manuelle moduler (roeres ikke af synk): ${manuelle.join(", ")}`);

  // 2) Ukendte produkter og dobbelt betaling
  if (saet.ukendte && saet.ukendte.length) uenig.push(`ukendt hos Frisbii: ${saet.ukendte.join(", ")}`);
  if (saet.dobbelt) uenig.push("Hele pakken OG enkeltmoduler - kunden betaler to gange");

  // 3) Status (D15 begge veje)
  if (sub && firma) {
    const fb = forventetBillingStatus(sub);
    if (fb && firma.billing_status !== fb) uenig.push(`billing_status er ${firma.billing_status}, Frisbii siger ${fb}`);
    const frisbiiLever = sub.state !== "expired";
    if (frisbiiLever && firma.status === "inactive") uenig.push("abonnementet lever hos Frisbii, men firmaet er inactive (betalende kunde spaerret ude?)");
    if (!frisbiiLever && firma.status !== "inactive") uenig.push(`abonnementet er udloebet, men firmaet er ${firma.status} (gratis adgang?)`);
    if (!frisbiiLever && firma.har_nummer) uenig.push("abonnementet er udloebet, men firmaet har stadig et nummer");
  }
  info.push(`Frisbii: ${saet.grund}, moduler [${saet.moduler.join(", ")}], til ${saet.til}`);
  return { uenig, info };
}

// Abonnementer, der lever hos Frisbii uden et firma i databasen (D15, D93).
function abonnementerUdenFirma(subs, firmaSubs) {
  const kendte = new Set(firmaSubs);
  return subs.filter((s) => s && !kendte.has(s.handle) && s.state !== "expired").map((s) => s.handle).sort();
}

module.exports = { sammenlignFirma, abonnementerUdenFirma, forventetBillingStatus, SYNK_KILDER };
