// frisbii-synk.js
// -----------------------------------------------------------------------------
// Fase 3, T5 (29/10-26): synkFirma - laeg et abonnements sandhed fra Frisbii
// ind i firma_moduler. Bindeleddet mellem kataloget (T1), modulsaet (T2),
// afstemningen (T3) og databasefunktionen (T4).
//
// Webhooken (T6) er KUN et vaekkesignal: den kalder synkFirma med abonnementets
// handle, og synkFirma henter selv sandheden fra Frisbiis API. Indholdet af et
// webhook bruges aldrig (signaturen daekker kun timestamp+id).
//
// SKRIVER KUN MED skriv: true. Ellers vises bare, hvad der ville ske.
// SKRIVER ALDRIG, naar Frisbii har et produkt, kataloget ikke kender (byggeplanen,
// betingelse 3) - medmindre et menneske udtrykkeligt beder om det med
// ignorerUkendte: true (kun gensynk-firma.js --ignorer-ukendte, aldrig webhooken).
//
// Kaster ved fejl i Frisbii eller databasen, saa kalderen kan dead-lettere og
// proeve igen. Returnerer ellers et resultat, kalderen logger:
//   { status, firma, abonnement, saet, foer, efter, uenig, funktion }
//   status: "skrevet" | "toerkoersel" | "ukendt" | "intet firma"
// -----------------------------------------------------------------------------
"use strict";

const { modulsaet } = require("./frisbii-modulsaet");
const { sammenlignFirma } = require("./frisbii-afstem");

async function synkFirma({ supabase, hent, abonnement, nu = new Date().toISOString(), skriv = false, ignorerUkendte = false }) {
  if (!abonnement) throw new Error("synkFirma: abonnement mangler");

  // 1) Firmaet. Kendes paa frisbii_subscription (unik).
  const { data: firma, error: fErr } = await supabase
    .from("firms").select("id, status, billing_status, phone_number")
    .eq("frisbii_subscription", abonnement).maybeSingle();
  if (fErr) throw new Error(`synkFirma: firms: ${fErr.message}`);
  if (!firma) return { status: "intet firma", abonnement };

  // 2) Frisbii: abonnementet og dets add-ons. Begge SKAL kunne laeses.
  const s = await hent(`/subscription/${encodeURIComponent(abonnement)}`);
  if (!s.ok) throw new Error(`synkFirma: GET /subscription/${abonnement} -> ${s.status}`);
  const a = await hent(`/subscription/${encodeURIComponent(abonnement)}/add_on`);
  if (!a.ok) throw new Error(`synkFirma: GET /subscription/${abonnement}/add_on -> ${a.status}`);
  const saet = modulsaet(s.data, a.data, nu);

  // 3) Databasen foer.
  const { data: foer, error: rErr } = await supabase
    .from("firma_moduler").select("modul, fra, til, kilde").eq("firm_id", firma.id);
  if (rErr) throw new Error(`synkFirma: firma_moduler: ${rErr.message}`);
  const firmaInfo = { status: firma.status, billing_status: firma.billing_status, har_nummer: firma.phone_number != null };
  const { uenig } = sammenlignFirma({ sub: s.data, saet, firma: firmaInfo, raekker: foer, nu });
  const grund = { firma: firma.id, abonnement, saet, foer, uenig };

  if (saet.ukendte.length && !ignorerUkendte) return { status: "ukendt", ...grund };
  if (!skriv) return { status: "toerkoersel", ...grund };

  // 4) Skriv: fuldt replace i en transaktion (T4).
  const { data: funktion, error: wErr } = await supabase.rpc("synk_frisbii_moduler", {
    p_firm: firma.id, p_moduler: saet.moduler, p_til: saet.til,
  });
  if (wErr) throw new Error(`synkFirma: synk_frisbii_moduler: ${wErr.message}`);

  const { data: efter, error: eErr } = await supabase
    .from("firma_moduler").select("modul, fra, til, kilde").eq("firm_id", firma.id);
  if (eErr) throw new Error(`synkFirma: firma_moduler efter: ${eErr.message}`);
  return { status: "skrevet", ...grund, efter, funktion };
}

module.exports = { synkFirma };
