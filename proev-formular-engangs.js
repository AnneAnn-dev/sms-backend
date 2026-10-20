// proev-formular-engangs.js
// -----------------------------------------------------------------------------
// S34 (D88 trin 2, 19/10-26): kundeformularens link virker ÉN gang — maalt mod
// STAGING-databasen, ikke antaget.
//
//   node proev-formular-engangs.js --bekraeft
//
// Laeser Supabase-noeglerne fra .env og NAEGTER at koere, hvis .env ikke peger
// paa staging (ref hehrvdmtzokzbnbihcel), eller hvis .ENV-ER-PROD findes.
// Staar derfor i IKKE_I_CI i kor-proever.js.
//
// Opretter ÉT testopkald (from_number "proev-formular-engangs") paa det
// foerste firma i staging og sletter det igen til sidst — ogsaa hvis en
// maaling fejler. Ingen opgaver, ingen SMS.
//
// Forudsagt: 9/9.
// -----------------------------------------------------------------------------
"use strict";

require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { generateToken } = require("./token");
const { brugFormular, frigivFormular } = require("./formular-engangs");

const STAGING_REF = "hehrvdmtzokzbnbihcel";

function stop(besked) { console.error("STOP: " + besked); process.exit(2); }

if (!process.argv.includes("--bekraeft")) stop("koer med --bekraeft (skriver og sletter ét testopkald i staging)");
if (fs.existsSync(path.join(__dirname, ".ENV-ER-PROD"))) stop(".ENV-ER-PROD findes — miljoeet peger paa PROD");
const ref = (process.env.SUPABASE_URL || "").split("//")[1]?.split(".")[0] || "";
if (ref !== STAGING_REF) stop(`.env peger paa '${ref || "ukendt"}', ikke staging (${STAGING_REF})`);
console.log(`Supabase-projekt: ${ref} (staging)\n`);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let ok = 0, alle = 0;
function tjek(navn, betingelse, detalje) {
  alle++;
  if (betingelse) { ok++; console.log("OK    " + navn); }
  else console.log("FEJL  " + navn + (detalje !== undefined ? "  -> " + JSON.stringify(detalje) : ""));
}

async function main() {
  const { data: firma, error: fFejl } = await supabase.from("firms").select("id").limit(1).maybeSingle();
  if (fFejl || !firma) stop("fandt intet firma i staging: " + (fFejl && fFejl.message));

  const token = generateToken();
  const { data: call, error: cFejl } = await supabase.from("calls").insert({
    from_number: "proev-formular-engangs", to_number: "", firm_id: firma.id,
    lead_token: token, raw_payload: {},
  }).select("id, formular_brugt_at").single();
  if (cFejl) stop("kunne ikke oprette testopkald: " + cFejl.code + " " + cFejl.message +
    (cFejl.code === "42703" || cFejl.code === "PGRST204" ? "  (er migrationen 20261019140000 koert paa staging?)" : ""));

  try {
    tjek("nyt opkald: linket er ikke brugt", call.formular_brugt_at === null, call);

    // 1) Fem samtidige indsendelser paa samme link: praecis én kommer igennem.
    const fem = await Promise.all(Array.from({ length: 5 }, () => brugFormular(supabase, token, { aktiv: true })));
    const status = fem.map((r) => r.status).sort();
    tjek("5 samtidige: praecis 1 ok", status.filter((s) => s === "ok").length === 1, status);
    tjek("5 samtidige: de 4 andre er 'brugt'", status.filter((s) => s === "brugt").length === 4, status);
    const vinder = fem.find((r) => r.status === "ok");

    // 2) En anden indsendelses stempel maa ikke frigive linket.
    await frigivFormular(supabase, call.id, "2000-01-01T00:00:00.000Z");
    const efterForkert = await brugFormular(supabase, token, { aktiv: true });
    tjek("frigiv med fremmed stempel: linket forbliver brugt", efterForkert.status === "brugt", efterForkert.status);

    // 3) Eget stempel giver linket tilbage (gemningen fejlede).
    await frigivFormular(supabase, call.id, vinder && vinder.stempel);
    const efterEget = await brugFormular(supabase, token, { aktiv: true });
    tjek("frigiv med eget stempel: linket kan bruges igen", efterEget.status === "ok", efterEget.status);

    const igen = await brugFormular(supabase, token, { aktiv: true });
    tjek("og derefter er det brugt igen", igen.status === "brugt", igen.status);

    // 4) Ukendt token.
    const ukendt = await brugFormular(supabase, generateToken(), { aktiv: true });
    tjek("ukendt token: 'ukendt' (giver 404)", ukendt.status === "ukendt", ukendt.status);

    // 5) Flaget slukket: brugt link kan bruges som foer (rollback-haandtaget).
    const slukket = await brugFormular(supabase, token, { aktiv: false });
    tjek("flag slukket: brugt link godtages", slukket.status === "ok", slukket.status);
    const { data: c2 } = await supabase.from("calls").select("formular_brugt_at").eq("id", call.id).single();
    tjek("flag slukket: tidspunktet for foerste brug overskrives ikke",
      c2 && c2.formular_brugt_at && efterEget.stempel &&
      new Date(c2.formular_brugt_at).getTime() === new Date(efterEget.stempel).getTime(), c2);
  } finally {
    const { error: dFejl } = await supabase.from("calls").delete().eq("id", call.id);
    console.log(dFejl ? `\nADVARSEL: testopkaldet ${call.id} blev IKKE slettet: ${dFejl.message}` : "\nTestopkaldet er slettet.");
  }

  console.log(`\n${ok}/${alle}`);
  process.exit(ok === alle ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
