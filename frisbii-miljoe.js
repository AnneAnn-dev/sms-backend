// frisbii-miljoe.js
// -----------------------------------------------------------------------------
// Fase 3 (29/10-26): hvilket miljoe peger profilen paa - og hoerer Supabase og
// Frisbii til det SAMME? Delt af afstem-frisbii.js og gensynk-firma.js, saa
// reglen staar et sted (CLAUDE.md: ingen ny dublet). Flyttet fra
// afstem-frisbii.js (T3) uden aendringer i reglen.
//
// En blandet profil (prod-database + staging-Frisbii eller omvendt) ville give
// uenigheder, der ikke findes - eller skrive Frisbii-staging's sandhed ind i
// prod. Derfor STOP, foer noget laeses videre.
// -----------------------------------------------------------------------------
"use strict";

const MILJOER = [
  { navn: "staging", ref: "hehrvdmtzokzbnbihcel", frisbii: "lommekontor" },
  { navn: "prod",    ref: "glymuxqtrbpeyzmflilf", frisbii: "test-2-lommekontor" },
];
const API = "https://api.frisbii.com/v1";

// GET mod Frisbii med noeglen. Returnerer { ok, status, data } - kaster aldrig
// paa et HTTP-svar, kun paa netvaerksfejl.
function lavFrisbiiGet(privatNoegle, fetchFn = fetch) {
  const auth = "Basic " + Buffer.from(privatNoegle + ":").toString("base64");
  return async function hent(sti) {
    const r = await fetchFn(API + sti, { headers: { Authorization: auth, Accept: "application/json" } });
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    return { ok: r.ok, status: r.status, data };
  };
}

// Dommen: { miljoe, handle, enig }. enig = Supabase-projektet er kendt OG
// Frisbii-kontoen er den, der hoerer til samme miljoe.
async function bestemMiljoe(supabaseUrl, hent) {
  const miljoe = MILJOER.find((m) => String(supabaseUrl || "").includes(m.ref)) || null;
  const konto = await hent("/account");
  const handle = konto.ok && konto.data ? konto.data.handle : `HTTP ${konto.status}`;
  return { miljoe, handle, enig: !!miljoe && handle === miljoe.frisbii };
}

module.exports = { MILJOER, API, lavFrisbiiGet, bestemMiljoe };
