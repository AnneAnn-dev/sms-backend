// proev-leads-skriveret.js
// -----------------------------------------------------------------------------
// S35 (21/10-26): en indlogget bruger maa kun skrive de kolonner paa leads,
// dashboardet bruger — aldrig firm_id, kunde_id, telefon, call_id, created_at.
// Maalt som en RIGTIG bruger (anon-noegle + brugerens sessionsnoegle, praecis
// som browseren), ikke med service role, som RLS ikke gaelder for.
//
//   $env:TILBUD_TEST_TOKEN = '<sessionsnoegle fra staging-dashboardet>'
//   node proev-leads-skriveret.js --bekraeft
//
// Sessionsnoeglen: F12 i staging-dashboardet -> Console (top) ->
//   copy((await db.auth.getSession()).data.session.access_token)
//
// IKKE-DESTRUKTIV: hver forbudt kolonne saettes til sin EGEN nuvaerende
// vaerdi. Foer migrationen 20261021090000 lykkes de (= hullet findes, proeven
// er roed); efter skal de afvises med 42501. Tilladte felter saettes ogsaa til
// deres nuvaerende vaerdi. opgave_handling() kaldes kun paa en opgave, der
// allerede er i gang (den rykker sidst_roert, intet andet).
//
// Naegter at koere uden for staging (ref hehrvdmtzokzbnbihcel) og hvis
// .ENV-ER-PROD findes. Staar i IKKE_I_CI i kor-proever.js.
// Forudsagt efter migrationen: 8/8. Foer: 3/8 (de fem forbudte fejler).
// -----------------------------------------------------------------------------
"use strict";

require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const STAGING_REF = "hehrvdmtzokzbnbihcel";
function stop(b) { console.error("STOP: " + b); process.exit(2); }

if (!process.argv.includes("--bekraeft")) stop("koer med --bekraeft");
if (fs.existsSync(path.join(__dirname, ".ENV-ER-PROD"))) stop(".ENV-ER-PROD findes — miljoeet peger paa PROD");
const ref = (process.env.SUPABASE_URL || "").split("//")[1]?.split(".")[0] || "";
if (ref !== STAGING_REF) stop(`.env peger paa '${ref || "ukendt"}', ikke staging`);
const token = (process.env.TILBUD_TEST_TOKEN || "").trim();
if (!token) stop("TILBUD_TEST_TOKEN mangler (se toppen af filen)");
if (!process.env.SUPABASE_ANON_KEY) stop("SUPABASE_ANON_KEY mangler i .env");

// Som browseren: anon-noeglen + brugerens token. Ingen service role.
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

let ok = 0, alle = 0;
function tjek(navn, b, d) {
  alle++;
  if (b) { ok++; console.log("OK    " + navn); }
  else console.log("FEJL  " + navn + (d !== undefined ? "  -> " + JSON.stringify(d) : ""));
}

async function main() {
  console.log(`Supabase-projekt: ${ref} (staging), som indlogget bruger\n`);
  const { data: liste, error } = await db.from("leads")
    .select("id, firm_id, kunde_id, telefon, call_id, created_at, titel, notes, startet_at")
    .order("created_at", { ascending: false }).limit(20);
  if (error) stop("kunne ikke laese egne opgaver: " + error.message + " (er noeglen udloebet?)");
  tjek("brugeren kan se sine egne opgaver", liste && liste.length > 0, liste && liste.length);
  if (!liste || !liste.length) return slut();
  const o = liste[0];

  // Forbudte kolonner: sat til sin egen vaerdi. Skal give 42501 efter S35.
  for (const kol of ["firm_id", "kunde_id", "telefon", "call_id", "created_at"]) {
    const { error: e } = await db.from("leads").update({ [kol]: o[kol] }).eq("id", o.id);
    tjek(`${kol} kan IKKE skrives fra browseren (42501)`, e && e.code === "42501", e ? e.code : "lykkedes");
  }

  // Tilladte: dashboardets egne felter, sat til deres nuvaerende vaerdi.
  const { error: eOk } = await db.from("leads").update({ titel: o.titel, notes: o.notes }).eq("id", o.id);
  tjek("dashboardets felter (titel, notes) kan stadig gemmes", !eOk, eOk && eOk.code);

  // opgave_handling() er SECURITY INVOKER og skriver startet_at/sidst_roert.
  const iGang = liste.find((l) => l.startet_at);
  if (!iGang) {
    tjek("opgave_handling(): ingen opgave i gang at proeve paa (start én og koer igen)", false);
  } else {
    const { error: eR } = await db.rpc("opgave_handling", { p_lead: iGang.id });
    tjek("opgave_handling() virker stadig (flyt til i gang)", !eR, eR && eR.code);
  }
  slut();
}
function slut() { console.log(`\n${ok}/${alle}`); process.exit(ok === alle ? 0 : 1); }
main().catch((e) => { console.error(e); process.exit(1); });
