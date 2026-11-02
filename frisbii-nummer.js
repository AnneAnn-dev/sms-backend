// frisbii-nummer.js
// -----------------------------------------------------------------------------
// Fase 3, T7b (30/10-26): nummeret efter en synk - og det, der skal siges
// bagefter. Delt af webhooken (efter hvert event, bag FASE3_SYNK) og
// gensynk-firma.js --skriv (naar et menneske retter i haanden, fx efter at
// puljen er fyldt op igen). Ingen dublet af reglerne: selve beslutningen
// (tildel / frigiv / behold) staar i telefon-nummer.js (nummerEfterSynk).
//
// Her bor ogsaa puljealarmerne, saa den gamle oprettelsesvej (flag slukket) og
// den nye bruger samme tekster:
//   alarmSpoegelser  - puljeraekker, Twilio ikke kender
//   alarmLavPulje    - faa verificerede ledige numre tilbage
//   alarmVenter      - et firma har koebt Telefonpasser, men puljen er tom
//
// Alle alarmer er best effort: en fejlet mail maa aldrig vaelte behandlingen.
// Klienter og mailfunktioner sendes ind som argumenter (kan proeves i CI).
// -----------------------------------------------------------------------------
"use strict";

const { nummerEfterSynk } = require("./telefon-nummer");

const kort = (id) => String(id || "").slice(0, 8);
const sikker = (p, log) => Promise.resolve(p).catch((e) => log.error("⚠️  Kunne ikke sende alarm:", e && e.message));

async function alarmSpoegelser({ alarm, log = console }, spoegelser) {
  if (!spoegelser || !spoegelser.length) return false;
  log.error("👻 Spoegelsesnumre i puljen (findes ikke hos Twilio):", spoegelser.join(", "));
  await sikker(alarm({
    subject: `Spoegelsesnumre i nummerpuljen (${spoegelser.length})`,
    text:
      `Disse numre staar som ledige i phone_numbers, men findes ikke i Twilio-kontoen:\n` +
      `${spoegelser.join("\n")}\n\n` +
      `De er sprunget over ved tildelingen, saa ingen kunde har faaet et doedt nummer.\n` +
      `Ryd op: bekraeft med "node afstem-numre.js" og slet derefter raekkerne (RUNBOOK-numre afsnit 5).`,
  }), log);
  return true;
}

// ledige = verificerede ledige numre EFTER tildelingen.
async function alarmLavPulje({ alarm, log = console }, ledige) {
  const LOW_POOL = Number(process.env.LOW_POOL_THRESHOLD) || 3;
  if (!(ledige <= LOW_POOL)) return false;
  log.warn(`⚠️  Nummerpulje lav: ${ledige} ledige tilbage`);
  await sikker(alarm({
    subject: `Nummerpulje lav: ${ledige} ledige tilbage`,
    text:
      `Der er kun ${ledige} ledige numre tilbage i phone_numbers.\n\n` +
      `Laeg flere numre i puljen, foer den loeber helt toer og en kunde maa vente paa sit nummer.`,
  }), log);
  return true;
}

async function alarmVenter({ alarm, log = console }, { firmId, abonnement, firmanavn }) {
  log.error(`❌ Ingen ledige numre: firma ${kort(firmId)} (${abonnement}) har koebt Telefonpasser og venter paa et nummer`);
  await sikker(alarm({
    subject: `Nummerpuljen er TOM - ${firmanavn || kort(firmId)} venter paa et nummer`,
    text:
      `Firma: ${firmanavn || "(ukendt navn)"} (${kort(firmId)})\nFrisbii-abonnement: ${abonnement}\n\n` +
      `Kunden har koebt Telefonpasser, men puljen er tom. Firmaet ER oprettet, uden nummer, og\n` +
      `kunden har faaet besked om, at nummeret er paa vej (vi lover ingen dage).\n\n` +
      `Saadan:\n` +
      `1. Laeg ledige numre i phone_numbers (RUNBOOK-numre).\n` +
      `2. Koer:  node gensynk-firma.js ${abonnement} --skriv\n` +
      `   Det tildeler nummeret og sender kunden "Dit nummer er klar".\n` +
      `3. Er der gaaet mere end et doegn: send kunden en rabatkode (Ann 30/10).`,
  }), log);
}

// Efter en synk, der HAR skrevet (synkResultat.status === "skrevet").
// deps: { supabase, twilioClient, alarm, sendNummerKlar, loginUrl, log }
//   sendNummerKlar: async ({ to, firmName, phoneNumber, loginUrl }) => ...
// Returnerer nummerresultatet fra nummerEfterSynk (+ mailSendt).
async function nummerOgBesked(deps, synkResultat, nu = new Date().toISOString()) {
  const { supabase, twilioClient, sendNummerKlar, loginUrl, log = console } = deps;
  const firmId = synkResultat.firma;
  const n = await nummerEfterSynk({ supabase, twilioClient, firmId, saet: synkResultat.saet, nu });

  await alarmSpoegelser(deps, n.spoegelser);
  if (n.status === "tom" || n.status === "tildelt") {
    const { data: firma } = await supabase.from("firms").select("name, email").eq("id", firmId).maybeSingle();
    if (n.status === "tom") {
      await alarmVenter(deps, { firmId, abonnement: synkResultat.abonnement, firmanavn: firma && firma.name });
    } else {
      await alarmLavPulje(deps, n.ledigeVerificeret);
      if (firma && firma.email && sendNummerKlar) {
        try {
          const svar = await sendNummerKlar({ to: firma.email, firmName: firma.name, phoneNumber: n.nummer, loginUrl });
          n.mailSendt = !(svar && svar.blocked);
        } catch (e) {
          log.error("❌ 'Dit nummer er klar'-mail fejlede (nummeret ER tildelt):", e && e.message);
          n.mailSendt = false;
        }
      }
    }
  }
  if (n.status === "frigivet") {
    log.log(`🔻 Telefon fravalgt: firma ${kort(firmId)} - nummeret frigivet${n.karantaeneTil ? " i karantaene til " + n.karantaeneTil : " straks"}`);
  }
  return n;
}

module.exports = { alarmSpoegelser, alarmLavPulje, alarmVenter, nummerOgBesked };
