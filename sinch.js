// sinch.js
// Sinch provider-primitiver til LommeKontor.
// Indeholder KUN udbyder-specifik kode (signatur, SMS, callout).
// Al forretningslogik bliver i onboarding.js.
//
// Krævede miljøvariabler:
//   SINCH_APP_KEY            Voice app key (dashboard → Voice)
//   SINCH_APP_SECRET         Voice app secret, base64-streng (dashboard → Voice)
//   SINCH_SMS_SERVICE_PLAN   SMS service plan ID (dashboard → SMS)
//   SINCH_SMS_API_TOKEN      SMS API token (dashboard → SMS)
//   SINCH_SYSTEM_NUMBER      Afsendernummer til verifikationsopkald (+45...)

const crypto = require("crypto");

const APP_KEY = process.env.SINCH_APP_KEY;
const APP_SECRET = process.env.SINCH_APP_SECRET;

// EU-hosts — holder voice- og SMS-trafik inden for EU.
const VOICE_HOST = "https://calling.api.sinch.com";
const SMS_HOST = "https://eu.sms.api.sinch.com";

// ── Signering (samme skema for indgående validering og udgående kald) ─────────
// StringToSign = VERB \n Content-MD5 \n content-type \n x-timestamp:<ts> \n path
// Signature    = Base64( HMAC-SHA256( Base64Decode(APP_SECRET), StringToSign ) )
// Header        = "application <APP_KEY>:<Signature>"
function buildSignature(method, path, bodyBuf, contentType, timestamp) {
  const contentMd5 = bodyBuf && bodyBuf.length
    ? crypto.createHash("md5").update(bodyBuf).digest("base64")
    : "";
  const stringToSign = [
    method,
    contentMd5,
    contentType,
    "x-timestamp:" + timestamp,
    path,
  ].join("\n");
  const sig = crypto
    .createHmac("sha256", Buffer.from(APP_SECRET, "base64"))
    .update(stringToSign, "utf8")
    .digest("base64");
  return "application " + APP_KEY + ":" + sig;
}

// Validér en indgående voice-callback (ICE/ACE/DICE).
// Forventer at req.body er en Buffer (kræver express.raw på ruten).
function verifyVoiceSignature(req) {
  try {
    const authHeader = req.get("authorization") || "";
    const timestamp = req.get("x-timestamp") || "";
    const contentType = req.get("content-type") || "application/json";
    const path = req.originalUrl.split("?")[0];

    const expected = buildSignature("POST", path, req.body, contentType, timestamp);
    const a = Buffer.from(authHeader);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    console.error("Sinch signatur-fejl:", e);
    return false;
  }
}

// ── SMS via Sinch SMS (XMS) REST API ──────────────────────────────────────────
async function sendSms({ to, from, body }) {
  const plan = process.env.SINCH_SMS_SERVICE_PLAN;
  const token = process.env.SINCH_SMS_API_TOKEN;
  const url = `${SMS_HOST}/xms/v1/${plan}/batches`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], body }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sinch SMS ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Udgående TTS-opkald (verifikation) via signed request ────────────────────
async function makeTtsCallout({ to, from, text, locale = "da-DK" }) {
  const path = "/calling/v1/callouts";
  const bodyObj = {
    method: "ttsCallout",
    ttsCallout: {
      cli: from,
      destination: { type: "number", endpoint: to },
      locale,
      text,
    },
  };
  const bodyStr = JSON.stringify(bodyObj);
  const bodyBuf = Buffer.from(bodyStr, "utf8");
  const timestamp = new Date().toISOString();
  const contentType = "application/json";
  const auth = buildSignature("POST", path, bodyBuf, contentType, timestamp);

  const res = await fetch(VOICE_HOST + path, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": contentType,
      "x-timestamp": timestamp,
    },
    body: bodyStr,
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Sinch callout ${res.status}: ${t}`);
  }
  return res.json();
}

module.exports = { verifyVoiceSignature, sendSms, makeTtsCallout };
