// test-frisbii.js
// -----------------------------------------------------------------------------
// Signerer og sender et Frisbii-lignende webhook til din egen endpoint.
// Tester KUN signatur + routing — event_type "ping" rammer default-grenen,
// saa der sker ingen DB- eller API-sideeffekter.
//
// Brug (Node 18+):
//   node test-frisbii.js                                 -> gyldigt ping mod localhost:3000  (forvent 200)
//   node test-frisbii.js http://localhost:3000 bad       -> oedelagt signatur                (forvent 401)
//   node test-frisbii.js https://din-app.railway.app     -> mod deployet                     (forvent 200)
// -----------------------------------------------------------------------------

require("dotenv").config();
const crypto = require("crypto");

const target = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "") + "/webhook/frisbii";
const mode   = process.argv[3] || "ok";
const secret = process.env.FRISBII_WEBHOOK_SECRET;

if (!secret) {
  console.error("❌ Mangler FRISBII_WEBHOOK_SECRET i .env");
  process.exit(1);
}

const id        = "evt-test-" + Date.now();
const timestamp = new Date().toISOString();

// Frisbii-formlen: HMAC-SHA256(secret, timestamp + id)
let signature = crypto.createHmac("sha256", secret).update(timestamp + id).digest("hex");
if (mode === "bad") signature = "0000" + signature.slice(4); // oedelaeg den med vilje

const body = { id, timestamp, signature, event_type: "ping" };

(async () => {
  try {
    const r = await fetch(target, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    const text = await r.text();
    console.log(`[${mode.toUpperCase()}] ${target} -> ${r.status} ${text}`);
    console.log(r.status === (mode === "bad" ? 401 : 200) ? "✓ som forventet" : "✗ IKKE som forventet");
  } catch (err) {
    console.error("❌ Kunne ikke naa serveren:", err.message);
  }
})();
