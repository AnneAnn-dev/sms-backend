// test-checkout-start.js
// -----------------------------------------------------------------------------
// Tester POST /checkout/start mod din kørende server. Kalder din egen route
// (ikke Frisbii direkte), så testen også dækker jeres egen validering og
// fejlhåndtering, ikke kun selve Frisbii-kaldet.
//
// Forudsætning:
//   - node server.js kører i et andet vindue
//   - .env har FRISBII_PRIVATE_KEY, FRISBII_PLAN_HANDLE, SIMPLY_BASE_URL
//   - FRISBII_PLAN_HANDLE peger på en plan der faktisk findes i Frisbii
//     (fx "test-abonement" under udvikling)
//
// Brug (Node 18+, fra sms-backend-mappen):
//   node test-checkout-start.js                              -> gyldigt kald mod localhost:3000
//   node test-checkout-start.js http://localhost:3000 bad     -> mangler email, forvent 400
//   node test-checkout-start.js https://din-app.up.railway.app
//
// Ved success printes session-url'en — åbn den i en browser, og brug Vipps
// Test App (test-MSN 2059953) til at gennemføre en testbetaling og udløse en
// rigtig invoice_settled-webhook.
// -----------------------------------------------------------------------------

require("dotenv").config({ quiet: true });

const target = (process.argv[2] && !process.argv[2].startsWith("--") && process.argv[2] !== "bad"
  ? process.argv[2]
  : "http://localhost:3000"
).replace(/\/$/, "") + "/checkout/start";

const mode = process.argv.includes("bad") ? "bad" : "ok";

const goodBody = {
  name: "Test Testesen",
  email: `checkout-test-${Date.now()}@example.dk`,
  phone: "+4512345678",
  company: "Test VVS ApS",
};

const badBody = {
  name: "Test Testesen",
  // email udeladt med vilje -> forvent 400 "invalid_email"
  phone: "+4512345678",
};

(async () => {
  const body = mode === "bad" ? badBody : goodBody;
  console.log(`→ POST ${target}`);
  console.log("→ Body:", JSON.stringify(body, null, 2));

  try {
    const r = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    console.log(`\n[${mode.toUpperCase()}] -> HTTP ${r.status}`);
    console.log(text);

    if (mode === "bad") {
      console.log(r.status === 400 ? "\n✓ som forventet (400)" : "\n✗ IKKE som forventet (forventede 400)");
      return;
    }

    if (r.status !== 200) {
      console.log("\n✗ IKKE som forventet (forventede 200) — tjek server-konsollen for detaljer.");
      return;
    }

    const parsed = JSON.parse(text);
    if (!parsed.url) {
      console.log("\n✗ Svar uden 'url' — uventet.");
      return;
    }
    console.log("\n✓ Session oprettet. Åbn denne URL i en browser for at teste betalingen:");
    console.log("  " + parsed.url);
    console.log("\n  Brug Vipps Test App (test-MSN 2059953, DKK) og et af testnumrene");
    console.log("  fra Frisbiis dokumentation til at gennemføre betalingen.");
  } catch (err) {
    console.error("❌ Kunne ikke naa serveren:", err.message);
  }
})();
