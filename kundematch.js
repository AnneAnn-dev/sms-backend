// kundematch.js — knyt en opgave til sin kunde via telefonnummeret (D88 trin 1b).
//
// Beslutning (Ann 18/10-26, D88): en kunde kendes på sit telefonnummer, og en
// kunde kan have flere numre (`kunde_telefoner`). Reglen ligger i databasen
// (`find_eller_opret_kunde`, migration 20261018120000); denne fil er det ENESTE
// sted, koden kalder den. Bruges af /formular, /opret-opgave og engangsscriptet
// knyt-kunder.js — ingen anden vej må knytte kunder (betingelse 8).
//
// KASTER ALDRIG. Opgaven er allerede gemt, når knytKunde kaldes (betingelse 4):
// fejler matchningen, har opgaven blot ingen kunde, og fejlen går til AppSignal
// med maskeret nummer. En kunde må aldrig miste sin indsendelse, fordi
// kundekartoteket hikker.
//
// Kendt hul, bevidst: lykkes find_eller_opret_kunde, men fejler opdateringen
// af opgaven bagefter, står der en kunde uden opgave. Den slettes af 30-dages-
// reglen (D88), og engangsscriptet kan knytte opgaven igen — samme nummer
// finder samme kunde.
//
// Overskriver ALDRIG en kunde, opgaven allerede har (`.is("kunde_id", null)`).
// Derfor kan engangsscriptet køres igen uden at ændre noget.
//
//   const { knytKunde } = require("./kundematch");
//   await knytKunde(supabase, { firmId, leadId, telefon, navn, adresse });
//   // → { status: "slukket" | "ny" | "kendt" | "uaendret" | "fejl", kundeId?, medNummer? }
//   //   "uaendret" = opgaven havde allerede en kunde (eller findes ikke i firmaet).

"use strict";

const { sendError } = require("@appsignal/nodejs");
const { kundeNoegle, maskerTlf } = require("./phone");
const { KUNDE_MATCH_AKTIV } = require("./flags");

function rapporter(besked) {
  // Ingen telefonnumre i loggen — kun det maskerede. Supabase-fejlenes `details`
  // kan indeholde nøgleværdier (fx ved 23505), så kun `code` og `message` bruges.
  console.error("❌ kundematch: " + besked);
  try { sendError(new Error("kundematch: " + besked)); } catch (_) { /* AppSignal må aldrig vælte kaldet */ }
}

async function knytKunde(supabase, { firmId, leadId, telefon, navn, adresse } = {}, { aktiv = KUNDE_MATCH_AKTIV } = {}) {
  if (!aktiv) return { status: "slukket" };

  const noegle = kundeNoegle(telefon);
  const vist = noegle ? maskerTlf(noegle) : "intet nummer";

  if (!firmId || !leadId) {
    rapporter(`firmId eller leadId mangler (lead ${leadId || "?"}, ${vist})`);
    return { status: "fejl" };
  }

  try {
    const { data, error } = await supabase.rpc("find_eller_opret_kunde", {
      p_firm:    firmId,
      p_telefon: noegle,
      p_navn:    navn == null ? null : String(navn),
      p_adresse: adresse == null ? null : String(adresse),
    });
    if (error) throw error;
    const raekke = Array.isArray(data) ? data[0] : data;
    if (!raekke || !raekke.kunde_id) throw new Error("find_eller_opret_kunde gav intet svar");

    const { data: opdateret, error: uE } = await supabase
      .from("leads")
      .update({ kunde_id: raekke.kunde_id })
      .eq("id", leadId)
      .eq("firm_id", firmId)
      .is("kunde_id", null)
      .select("id");
    if (uE) throw uE;
    if (!opdateret || !opdateret.length) return { status: "uaendret", kundeId: raekke.kunde_id, ny: !!raekke.ny, medNummer: !!noegle };

    return { status: raekke.ny ? "ny" : "kendt", kundeId: raekke.kunde_id, ny: !!raekke.ny, medNummer: !!noegle };
  } catch (e) {
    rapporter(`lead ${leadId}, ${vist}: ${(e && e.code) || ""} ${(e && e.message) || e}`.replace(/\s+/g, " ").trim());
    return { status: "fejl" };
  }
}

module.exports = { knytKunde };
