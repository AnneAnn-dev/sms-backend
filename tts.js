// tts.js
// -----------------------------------------------------------------------------
// ElevenLabs TTS-render for LommeKontor  (BACKEND — hoerer til server-koden).
//
// Renderer en tekst til en mp3 med den valgte stemme, uploader den til
// Supabase Storage, og returnerer den offentlige URL. URL'en gemmes paa
// firms.greeting_audio_url og afspilles ved opkald (Twilio <Play> / Sinch playFiles).
//
// Leverandoer-uafhaengigt: dette roerer hverken Twilio eller Sinch. Det
// producerer bare en lydfil. Opkalds-laget afspiller bare en URL.
//
// Paakraevede env vars:  ELEVENLABS_API_KEY
//                        ELEVENLABS_VOICE_IDM  (mandestemme)
//                        ELEVENLABS_VOICE_IDF  (kvindestemme)
// Paakraevet bucket:     "greetings"  (offentlig laesning) i Supabase Storage
// -----------------------------------------------------------------------------
 
const ELEVEN_API = "https://api.elevenlabs.io/v1/text-to-speech";
 
// Stemme-IDs hentes fra env (sat i Railway). M = mand, F = kvinde.
// Vil I bytte stemme, aendres det i Railway-variablerne — ikke i koden.
const VOICES = {
  male:   process.env.ELEVENLABS_VOICE_IDM,
  female: process.env.ELEVENLABS_VOICE_IDF,
};
 
const MODEL_ID = "eleven_multilingual_v2"; // bedste kvalitet + understoetter dansk
const BUCKET   = "greetings";
 
// -----------------------------------------------------------------------------
// renderTTS — render + upload. Returnerer { url } eller kaster ved fejl.
//   supabase     : din eksisterende Supabase service-role klient
//   text         : teksten der skal laeses op
//   voiceGender  : "male" | "female"
//   path         : sti i bucket'en, fx "<firmId>/female.mp3"
// -----------------------------------------------------------------------------
async function renderTTS(supabase, { text, voiceGender, path }) {
  const voiceId = VOICES[voiceGender] || VOICES.female;
  const apiKey  = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY mangler");
  if (!voiceId) throw new Error(`Stemme-ID mangler for "${voiceGender}" — tjek ELEVENLABS_VOICE_IDM/IDF i Railway`);
  if (!text || !text.trim()) throw new Error("Tom tekst — intet at rendere");
 
  // 1) Render mp3 hos ElevenLabs.
  //    Bemaerk: INTET language_code — multilingual v2 auto-detekterer dansk
  //    fra teksten, og parameteren ville kaste en 400 paa denne model.
  const res = await fetch(`${ELEVEN_API}/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.8 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  const audio = Buffer.from(await res.arrayBuffer());
 
  // 2) Upload til Supabase Storage (overskriv hvis filen findes i forvejen)
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
  if (upErr) throw new Error(`Supabase upload: ${upErr.message}`);
 
  // 3) Offentlig URL. Cache-buster (?v=) saa en ny version ikke serveres
  //    fra Twilios/Sinch' cache som den gamle lyd.
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: `${data.publicUrl}?v=${Date.now()}` };
}
 
// Bekvem wrapper til firmaets hilsen: gemmer paa fast sti pr. firma + stemme.
async function renderGreeting(supabase, { firmId, text, voiceGender }) {
  return renderTTS(supabase, {
    text,
    voiceGender,
    path: `${firmId}/${voiceGender}.mp3`,
  });
}
 
module.exports = { renderTTS, renderGreeting, VOICES, MODEL_ID, BUCKET };