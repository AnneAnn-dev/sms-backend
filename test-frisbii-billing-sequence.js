// test-frisbii-billing-sequence.js
// -----------------------------------------------------------------------------
// Verificerer sekvens-beskyttelsen i frisbii-webhook.js's setBillingStatus():
// en ÆLDRE/genafspillet webhook må IKKE kunne overskrive en NYERE billing_status.
//
// Sender invoice_failed -> invoice_reactivate -> (replay af) invoice_failed,
// med forskudte timestamps, og tjekker billing_status i Supabase efter hvert
// trin. Bruger IKKE invoice_settled, fordi den case i frisbii-webhook.js først
// kalder det ægte Frisbii-API (frisbiiGet) — det ville kræve en rigtig Frisbii-
// kunde og er ikke det, vi tester her.
//
// Opretter selv et minimalt testfirma (claimer et nummer fra puljen, sætter
// frisbii_subscription — det gør provision-test-firm.js IKKE, da det feltet
// kun normalt sættes af frisbii-webhook.js selv). Sender derefter rigtige,
// signerede webhooks mod din kørende server og læser billing_status tilbage
// fra Supabase efter hvert trin.
//
// Forudsætning:
//   - frisbii-webhook-migration.sql er kørt i Supabase
//   - node server.js kører i et andet vindue
//   - .env har SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FRISBII_WEBHOOK_SECRET
//
// Brug (Node 18+, fra sms-backend-mappen):
//   node test-frisbii-billing-sequence.js                       -> mod localhost:3000
//   node test-frisbii-billing-sequence.js https://din-app.up.railway.app
//   node test-frisbii-billing-sequence.js http://localhost:3000 --keep   (rydder ikke testfirmaet op)
// -----------------------------------------------------------------------------

require("dotenv").config({ quiet: true });
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const target = (process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "http://localhost:3000")
  .replace(/\/$/, "") + "/webhook/frisbii";
const KEEP = process.argv.includes("--keep");

const secret = process.env.FRISBII_WEBHOOK_SECRET;
if (!secret) {
  console.error("❌ Mangler FRISBII_WEBHOOK_SECRET i .env");
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Mangler SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i .env");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SUB_HANDLE = "test-sub-" + Date.now();
const TEST_SLUG  = "test-billing-seq-" + Date.now();

function sign(timestamp, id) {
  return crypto.createHmac("sha256", secret).update(timestamp + id).digest("hex");
}

async function sendWebhook({ event_type, subscription, timestamp }) {
  const id = "evt-seq-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const signature = sign(timestamp, id);
  const body = { id, timestamp, signature, event_type, subscription };
  const r = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, text, id };
}

async function getBillingStatus(firmId) {
  const { data, error } = await supabase
    .from("firms")
    .select("billing_status, billing_status_updated_at")
    .eq("id", firmId)
    .single();
  if (error) throw error;
  return data;
}

// Lille pause så webhook-handlerens fire-and-forget efterbehandling (som
// kører EFTER res.status(200) er sendt) har tid til at nå databasen, før vi
// læser tilbage. Handleren selv er hurtig (et par Supabase-kald), men uden
// lidt margin kan testen læse for tidligt og rapportere en falsk fejl.
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setupTestFirm() {
  console.log("0) Opretter testfirma + claimer nummer fra puljen …");

  const { data: poolRow, error: poolErr } = await supabase
    .from("phone_numbers")
    .select("id, number")
    .is("firm_id", null)
    .limit(1)
    .single();
  if (poolErr || !poolRow) {
    throw new Error(
      "Ingen ledige numre i phone_numbers-puljen. Frigør et testnummer " +
      "(jf. opskriftsbogen) eller kør buy-numbers.js --dry-run for at se status."
    );
  }

  const { data: firm, error: firmErr } = await supabase
    .from("firms")
    .insert({
      name: "Sekvenstest ApS",
      slug: TEST_SLUG,
      email: `sekvenstest-${Date.now()}@example.invalid`,
      phone_number: poolRow.number,
      frisbii_subscription: SUB_HANDLE,
      status: "active",
      billing_status: "active",
      billing_status_updated_at: new Date(0).toISOString(), // langt tilbage i tiden
      voice_gender: "female",
      greeting_text: "Testfirma til sekvens-verifikation.",
      verification_status: "verified",
    })
    .select("id")
    .single();
  if (firmErr) throw firmErr;

  await supabase.from("phone_numbers").update({ firm_id: firm.id }).eq("id", poolRow.id);

  console.log(`   ✓ Firma-id: ${firm.id}  (frisbii_subscription: ${SUB_HANDLE})`);
  return firm.id;
}

async function cleanup(firmId) {
  if (KEEP) {
    console.log(`\nℹ️  --keep angivet — testfirma ${firmId} og nummer ER IKKE ryddet op.`);
    console.log("   Ryd manuelt op via opskriftsbogen, når du er færdig med at undersøge.");
    return;
  }
  console.log("\n🧹 Rydder op …");
  await supabase.from("phone_numbers").update({ firm_id: null }).eq("firm_id", firmId);
  await supabase.from("firms").delete().eq("id", firmId);
  console.log("   ✓ Testfirma og nummer-claim ryddet op.");
}

async function step(label, expectStatus, action) {
  const { status, text } = await action();
  console.log(`\n${label}`);
  console.log(`   → HTTP ${status} ${text}`);
  if (status !== 200) {
    throw new Error(`Forventede HTTP 200, fik ${status}`);
  }
  await wait(400);
  return expectStatus;
}

(async () => {
  let firmId;
  let failed = false;

  try {
    firmId = await setupTestFirm();

    const T1 = new Date(Date.now() - 60_000).toISOString(); // 1 min "i fortiden"
    const T2 = new Date(Date.now() - 30_000).toISOString(); // 30 sek "i fortiden", nyere end T1

    // ── Trin 1: invoice_failed (T1) → forventer past_due ──────────────────
    await step("1) Sender invoice_failed (ældre timestamp T1) …", "past_due", () =>
      sendWebhook({ event_type: "invoice_failed", subscription: SUB_HANDLE, timestamp: T1 })
    );
    let row = await getBillingStatus(firmId);
    console.log(`   Status i DB: ${row.billing_status}  (forventet: past_due)`);
    if (row.billing_status !== "past_due") {
      failed = true;
      console.error("   ✗ FEJL: forventede past_due");
    } else {
      console.log("   ✓ som forventet");
    }

    // ── Trin 2: invoice_reactivate (T2, nyere) → forventer active ─────────
    // Vi bruger IKKE invoice_settled her: den case kalder FØRST det ægte
    // Frisbii-API (frisbiiGet) for at slå customer/subscription op, og det
    // kald vil fejle/kaste, fordi vores testwebhook ikke har en rigtig
    // Frisbii-kunde bag sig — setBillingStatus() ville derfor aldrig nås.
    // invoice_reactivate rammer setBillingStatus() direkte uden noget
    // eksternt API-opslag, og er derfor den rene, isolerede test af selve
    // sekvens-beskyttelsen (som er det, vi vil verificere her).
    await step("2) Sender invoice_reactivate (nyere timestamp T2) …", "active", () =>
      sendWebhook({ event_type: "invoice_reactivate", subscription: SUB_HANDLE, timestamp: T2 })
    );
    row = await getBillingStatus(firmId);
    console.log(`   Status i DB: ${row.billing_status}  (forventet: active)`);
    if (row.billing_status !== "active") {
      failed = true;
      console.error("   ✗ FEJL: forventede active");
    } else {
      console.log("   ✓ som forventet");
    }

    // ── Trin 3: NY webhook, men med den GAMLE T1-timestamp ────────────────
    // Dette simulerer en forsinket retry: Frisbii giver en retry et NYT
    // leverings-id, men den oprindelige event-timestamp (T1) er uændret.
    // claimWebhookEvent() vil derfor IKKE blokere den (nyt id = ikke set før)
    // — det er netop derfor setBillingStatus()'s egen timestamp-sammenligning
    // er nødvendig som et selvstændigt lag. (Identisk samme webhook-id leveret
    // to gange er allerede dækket af test-frisbii.js's "replay"-tilstand.)
    // Dette er selve kernetesten: en forsinket/genafspillet ÆLDRE webhook må
    // IKKE kunne skubbe en nyere, korrekt status tilbage.
    await step("3) Sender NY webhook med GAMMEL timestamp T1 (simuleret forsinket retry) …", "active", () =>
      sendWebhook({ event_type: "invoice_failed", subscription: SUB_HANDLE, timestamp: T1 })
    );
    row = await getBillingStatus(firmId);
    console.log(`   Status i DB: ${row.billing_status}  (forventet: active — UÆNDRET)`);
    if (row.billing_status !== "active") {
      failed = true;
      console.error("   ✗ FEJL: en ældre webhook overskrev en nyere status! Sekvens-beskyttelsen virker IKKE.");
    } else {
      console.log("   ✓ som forventet — den ældre webhook blev korrekt ignoreret.");
    }

    console.log("\n────────────────────────────────────────────────────────");
    console.log(failed ? "✗ EN ELLER FLERE TRIN FEJLEDE" : "✅ ALLE TRIN BESTÅET — sekvens-beskyttelsen virker");
    console.log("────────────────────────────────────────────────────────");
  } catch (err) {
    failed = true;
    console.error("\n❌ Testen kunne ikke gennemføres:", err.message);
  } finally {
    if (firmId) {
      try { await cleanup(firmId); }
      catch (err) { console.error("⚠️  Oprydning fejlede (ryd manuelt op):", err.message); }
    }
  }

  process.exit(failed ? 1 : 0);
})();
