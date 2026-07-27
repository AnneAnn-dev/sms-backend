// regenerate-voice-samples.js
// -----------------------------------------------------------------------------
// Genindspiller stemmeproeverne (kodeopgave 17): _samples/female.mp3 og
// _samples/male.mp3 i "greetings"-bucketen — de klip, stemmekortene afspiller
// i onboardingen (s-3) og paa dashboardets profilside.
//
// HVORFOR: klippene var genereret med en anden stemme end serverens — kortet
// lovede en stemme, telefonsvareren leverede en anden. Dette script genbruger
// SERVERENS EGEN renderTTS (./tts), saa stemme-ID, model og indstillinger er
// identiske pr. konstruktion — ikke pr. afskrift.
//
// KOERSEL (fra repo-roden, hvor .env og tts.js bor):
//   node regenerate-voice-samples.js              <- toervend: viser kun maalet
//   node regenerate-voice-samples.js --bekraeft   <- genererer + overskriver
//
// Koer i BEGGE miljoeer (staging foerst, saa prod) — hvilket miljoe der rammes
// styres af jeres .env-ritual som altid. Scriptet printer maalet, foer det roerer
// noget, og goer INTET uden --bekraeft.
//
// REKKEFOELGE: koer scriptet i begge miljoeer FOER frontenden med ?v=3
// deployes — saa serverer v=3-URL'erne aldrig de gamle klip fra cache.
//
// Manuskriptet nedenfor maa Anne gerne justere — det er kundevendt lyd.
// -----------------------------------------------------------------------------
require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");
const { renderTTS } = require("./tts");

const SAMPLE_TEKST =
  "Hej. Tak fordi du har ringet. Jeg kan ikke tage telefonen lige nu. Du modtager en SMS, hvor du kan beskrive din opgave.";

(async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("FEJL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mangler i miljoeet.");
    process.exit(1);
  }

  console.log("Maal-miljoe:", url);

  if (!process.argv.includes("--bekraeft")) {
    console.log(
      "Toervend — ingen filer skrevet.\n" +
      "Koer igen med --bekraeft for at overskrive _samples/female.mp3 og " +
      "_samples/male.mp3 i miljoeet ovenfor."
    );
    process.exit(0);
  }

  const supabase = createClient(url, key);

  for (const gender of ["female", "male"]) {
    const { url: publicUrl } = await renderTTS(supabase, {
      text: SAMPLE_TEKST,
      voiceGender: gender,
      path: `_samples/${gender}.mp3`,   // upsert: true i renderTTS overskriver
    });
    console.log(`OK ${gender}: ${publicUrl}`);
  }

  console.log(
    "\nFaerdigt. Naeste skridt:\n" +
    "  1) Koer scriptet i det andet miljoe, hvis det ikke er sket.\n" +
    "  2) Deploy frontenden med ?v=3 (allerede bumpet i leverancen 20/7).\n" +
    "  3) Roegtest: kort-Lyt og besked-Lyt skal nu vaere SAMME stemme for begge koen."
  );
})().catch((e) => {
  console.error("FEJL:", e.message);
  process.exit(1);
});
