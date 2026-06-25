new Appsignal({
  // Aktiv kun når nøglen er sat. På Railway (staging + prod) er den sat;
  // lokalt er den typisk ikke, og så holder AppSignal sig stille af sig selv.


require("dotenv").config({ quiet: true });
const { Appsignal } = require("@appsignal/nodejs");

new Appsignal({
  active: !!process.env.APPSIGNAL_PUSH_API_KEY,
  name: process.env.APPSIGNAL_APP_NAME || "lommekontor",
  pushApiKey: process.env.APPSIGNAL_PUSH_API_KEY,
});

console.log(
  "✅ appsignal.cjs loadet — key sat:", !!process.env.APPSIGNAL_PUSH_API_KEY,
  "| env:", process.env.APPSIGNAL_APP_ENV || "(ikke sat)"
);

  // Miljø (staging/production) læses automatisk fra APPSIGNAL_APP_ENV,
  // som du sætter pr. Railway-miljø — så testfejl ikke blandes med kundefejl.
});
