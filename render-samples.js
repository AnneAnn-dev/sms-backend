// render-samples.js
// -----------------------------------------------------------------------------
// ENGANGSSKRIPT (BACKEND).  Genererer to forhaandsvisnings-samples — én mand,
// én kvinde — og uploader dem til Supabase Storage. Bruges af onboarding-sidens
// "Forhaandsvis"-knap, saa haandvaerkeren hoerer den RIGTIGE ElevenLabs-stemme
// (ikke browserens robotstemme), uden at vi renderer ved hvert klik.
//
// Koer lokalt ÉN gang:   node render-samples.js
// Kopiér de to URL'er den printer ind i frontend-snippet'en (SAMPLE_*_URL).
// Koer igen hvis I skifter stemme-ID eller sample-tekst.
// -----------------------------------------------------------------------------

require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");
const { renderTTS } = require("./tts");

// Fast demosaetning — repraesenterer stemmen uden at vaere firma-specifik.
const SAMPLE_TEXT =
  "Hej. Du har ringet til Hansens Malerfirma. Jeg kan desværre ikke tage ' +
  'telefonen. Jeg sender dig en SMS med et link, hvor du beskriver din opgave. Jeg ' +
  'vender tilbage så hurtigt som muligt. Tak for din henvendelse..";

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY // service-role: maa skrive til Storage
  );

  for (const gender of ["male", "female"]) {
    process.stdout.write(`→ Renderer ${gender}-sample... `);
    try {
      const { url } = await renderTTS(supabase, {
        text: SAMPLE_TEXT,
        voiceGender: gender,
        path: `_samples/${gender}.mp3`,
      });
      console.log("✅");
      console.log(`   ${gender.toUpperCase()}: ${url}\n`);
    } catch (e) {
      console.log("❌");
      console.error(`   ${e.message}\n`);
    }
  }

  console.log("Faerdig. Kopiér de to URL'er ind i onboarding-snippet'en.");
}

main();
