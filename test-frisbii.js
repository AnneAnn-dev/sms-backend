// test-frisbii.js
// -----------------------------------------------------------------------------
// Signerer og sender et Frisbii-lignende webhook til din egen endpoint.
// Tester signatur + routing + replay-beskyttelse. event_type "ping" rammer
// default-grenen, saa der sker ingen DB- eller API-sideeffekter udover selve
// idempotens-registreringen i frisbii_webhook_events.
//
// Brug (Node 18+):
//   node test-frisbii.js                                 -> gyldigt ping mod localhost:3000  (forvent 200)
//   node test-frisbii.js http://localhost:3000 bad        -> oedelagt signatur                (forvent 401)
//   node test-frisbii.js http://localhost:3000 replay      -> samme webhook sendt 2x          (forvent 200 + 200, men kun 1 log-linje "behandlet")
//   node test-frisbii.js https://din-app.railway.app      -> mod deployet                     (forvent 200)
//
// Foerend "replay" testes: koer frisbii-webhook-migration.sql i Supabase,
// saa tabellen frisbii_webhook_events findes.
// -----------------------------------------------------------------------------

require("dotenv").config({ quiet: true });
const crypto = require("crypto");

const target = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "") + "/webhook/frisbii";
const mode   = process.argv[3] || "ok";
const secret = process.env.FRISBII_WEBHOOK_SECRET;

if (!secret) {
  console.error("❌ Mangler FRISBII_WEBHOOK_SECRET i .env");
  process.exit(1);
}

function buildSignedBody({ id, timestamp, breakSignature = false }) {
  let signature = crypto.createHmac("sha256", secret).update(timestamp + id).digest("hex");
  if (breakSignature) signature = "0000" + signature.slice(4); // oedelaeg den med vilje
  return { id, timestamp, signature, event_type: "ping" };
}

async function send(body) {
  const r = await fetch(target, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, text };
}

(async () => {
  try {
    if (mode === "replay") {
      // Samme id+timestamp sendt to gange. Begge skal give 200 (Frisbii skal
      // ikke se en fejl og begynde at retry'e en allerede-leveret webhook),
      // men kun foerste levering maa give noget log-output om "behandlet" —
      // det tjekkes manuelt i serverens konsol, scriptet kan kun verificere
      // HTTP-statussen.
      const id        = "evt-test-" + Date.now();
      const timestamp = new Date().toISOString();
      const body = buildSignedBody({ id, timestamp });

      const first  = await send(body);
      const second = await send(body);

      console.log(`[REPLAY 1.] ${target} -> ${first.status} ${first.text}`);
      console.log(`[REPLAY 2.] ${target} -> ${second.status} ${second.text}`);
      console.log(
        first.status === 200 && second.status === 200
          ? "✓ begge svarede 200 — tjek serverlog: kun 1. gang skal udløse behandling"
          : "✗ IKKE som forventet (begge skal give 200)"
      );
      return;
    }

    const id        = "evt-test-" + Date.now();
    const timestamp = new Date().toISOString();
    const body = buildSignedBody({ id, timestamp, breakSignature: mode === "bad" });

    const { status, text } = await send(body);
    console.log(`[${mode.toUpperCase()}] ${target} -> ${status} ${text}`);
    console.log(status === (mode === "bad" ? 401 : 200) ? "✓ som forventet" : "✗ IKKE som forventet");
  } catch (err) {
    console.error("❌ Kunne ikke naa serveren:", err.message);
  }
})();
