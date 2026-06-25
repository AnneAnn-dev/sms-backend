// appsignal.cjs
// Loades FØR alt andet via start-kommandoen:  node --require ./appsignal.cjs server.js
// Grunden: AppSignals auto-instrumentering hægter sig på express/http/supabase
// idet de loades — så denne fil skal køre før dine øvrige requires, ellers
// instrumenteres de ikke. dotenv loades her øverst, så nøglen er tilgængelig
// uanset om vi kører lokalt (.env) eller på Railway (rigtige env-vars).
require("dotenv").config({ quiet: true });

const { Appsignal } = require("@appsignal/nodejs");

new Appsignal({
  // Aktiv kun når nøglen er sat. På Railway (staging + prod) er den sat;
  // lokalt er den typisk ikke, og så holder AppSignal sig stille af sig selv.
  active: !!process.env.APPSIGNAL_PUSH_API_KEY,
  name: process.env.APPSIGNAL_APP_NAME || "lommekontor",
  pushApiKey: process.env.APPSIGNAL_PUSH_API_KEY,
  // Miljø (staging/production) læses automatisk fra APPSIGNAL_APP_ENV,
  // som du sætter pr. Railway-miljø — så testfejl ikke blandes med kundefejl.
});
