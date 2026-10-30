// frisbii-natlig.js
// -----------------------------------------------------------------------------
// D92 del 3b (29/10-26): ren logik for den natlige Frisbii-kontrol
// (natlig-frisbii.js). Ingen netvaerk, ingen database - proeves i CI
// (proev-frisbii-natlig.js).
//
// Hvorfor: Frisbii gensender ALDRIG et event af sig selv (maalt 29/10-26: vi
// svarer 200 foer behandlingen, Frisbii bogfoerer COMPLETED efter 1 forsoeg).
// Et event i dead-letter bliver derfor liggende, til et menneske ser det. Og
// afstemningen (D15) koerte kun, naar nogen huskede den.
//
// FOERSTE UDGAVE LAESER KUN (Ann 29/10): ingen synk, ingen aendring af
// processed_at. Rapporten siger, hvad et menneske skal goere.
// -----------------------------------------------------------------------------
"use strict";

const MIN_ALDER_MIN = 15; // yngre events kan vaere under behandling lige nu
const MAKS_LINJER = 40;   // en mail med 400 linjer bliver ikke laest

// rows:   raekker fra frisbii_webhook_events med tom processed_at
//         ({ id, event_id, event_type, error })
// events: { [event_id]: { subscription, created } | null }  (hentet hos Frisbii;
//         null = kunne ikke hentes)
// Returnerer de raekker, der skal i rapporten, aeldste foerst.
function udvaelgDeadLetter(rows, events, nu, minAlderMin = MIN_ALDER_MIN) {
  const graense = new Date(new Date(nu).getTime() - minAlderMin * 60 * 1000).toISOString();
  const ud = [];
  for (const r of rows || []) {
    const e = r.event_id ? events[r.event_id] : undefined;
    const created = e && e.created ? new Date(e.created).toISOString() : null;
    if (created && created > graense) continue; // for ung - maaske under behandling
    ud.push({
      id: r.id,
      event_type: r.event_type,
      error: r.error || "(ingen fejltekst)",
      abonnement: (e && e.subscription) || null,
      created,
      hentet: !!e,
    });
  }
  return ud.sort((a, b) => String(a.created || "").localeCompare(String(b.created || "")));
}

// afstem: { kode, tekst } fra koersel af afstem-frisbii.js (kode 0 = enige,
//         1 = uenige eller kunne ikke laese, andet = koerslen fejlede)
// Returnerer { roed, subject, text }.
function lavRapport({ miljoe, deadLetter, afstem, nu }) {
  const dl = deadLetter || [];
  const afstemRoed = !afstem || afstem.kode !== 0;
  const roed = dl.length > 0 || afstemRoed;
  const dele = [];
  if (dl.length) dele.push(`${dl.length} i dead-letter`);
  if (afstemRoed) dele.push(afstem && afstem.kode === 1 ? "afstemning uenig" : "afstemning fejlede");
  const subject = `Natlig Frisbii-kontrol (${miljoe}): ${roed ? "ROED - " + dele.join(", ") : "GROENT"}`;

  const L = [];
  L.push(`Koert ${nu} mod ${miljoe}. Kun laesning - intet er rettet.`);
  L.push("");
  L.push(`1) DEAD-LETTER (events med tom processed_at, aeldre end ${MIN_ALDER_MIN} min): ${dl.length}`);
  if (dl.length) {
    for (const d of dl.slice(0, MAKS_LINJER)) {
      L.push(`   - ${d.created || "(tid ukendt)"}  ${d.event_type}  ${d.abonnement || "(abonnement ukendt)"}  id ${d.id}`);
      L.push(`       fejl: ${d.error}${d.hentet ? "" : "  [eventet kunne ikke hentes hos Frisbii]"}`);
    }
    if (dl.length > MAKS_LINJER) L.push(`   ... og ${dl.length - MAKS_LINJER} mere. Se SQL nedenfor.`);
    L.push("");
    L.push("   Frisbii gensender IKKE af sig selv. Saadan:");
    L.push("   a. Ret aarsagen (fejlteksten siger hvad).");
    L.push("   b. Gensend eventet i Frisbii (Webhooks) - saa koerer hele behandlingen igen.");
    L.push("      Kun moduler: node gensynk-firma.js <abonnement> (toerkoersel), derefter --skriv.");
    L.push("   SQL: select * from frisbii_webhook_events where processed_at is null;");
  }
  L.push("");
  L.push(`2) AFSTEMNING (afstem-frisbii.js): ${afstemRoed ? (afstem && afstem.kode === 1 ? "UENIG" : "FEJLEDE") : "enige"}`);
  if (afstemRoed) {
    const linjer = String((afstem && afstem.tekst) || "(intet output)").split("\n")
      .filter((l) => /^(UENIG|STOP)|^\s+!|uenighed|Kunne ikke|Mangler|FEJL/i.test(l));
    for (const l of linjer.slice(0, MAKS_LINJER)) L.push("   " + l.trimEnd());
    if (!linjer.length) L.push("   " + String((afstem && afstem.tekst) || "(intet output)").trim().split("\n").slice(-5).join("\n   "));
    L.push("   Hele billedet: node afstem-frisbii.js");
  }
  L.push("");
  L.push(roed
    ? "Kommer denne mail ikke en morgen, har kontrollen ikke koert - se Railway (cron-servicen)."
    : "Alt groent. Kommer denne mail ikke en morgen, har kontrollen ikke koert - se Railway (cron-servicen).");
  return { roed, subject, text: L.join("\n") };
}

module.exports = { MIN_ALDER_MIN, MAKS_LINJER, udvaelgDeadLetter, lavRapport };
