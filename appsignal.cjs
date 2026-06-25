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