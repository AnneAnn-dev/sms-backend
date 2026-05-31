require("dotenv").config();
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const webpush = require("web-push");
const multer = require("multer");

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const app = express();

// Raw body til Shopify webhook HMAC-validering — skal være FØR express.json()
app.use("/webhook/shopify", express.raw({ type: "application/json" }));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static("static"));

app.get("/manifest.json", (req, res) =>
  res.sendFile(__dirname + "/static/manifest.json")
);
app.get("/sw.js", (req, res) =>
  res.sendFile(__dirname + "/static/sw.js")
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Onboarding: Shopify webhook + Twilio opkaldshandler ────────────────────
require("./onboarding")(app, supabase);

// ─── 2. VIS FORMULAR ────────────────────────────────────────────────────────
app.get("/formular/:token", async (req, res) => {
  const { data: call } = await supabase
    .from("calls")
    .select("id, firms(name)")
    .eq("lead_token", req.params.token)
    .single();

  if (!call) return res.status(404).send("Link ikke gyldigt");

  const firmName = call.firms?.name || "os";

  res.send(`<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Beskriv din opgave</title>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
  <link rel="shortcut icon" href="/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Source+Sans+3:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Source Sans 3', system-ui, sans-serif; background: #F4F7FA; color: #1C2A38; padding: 24px 16px; }
    .card { background: #fff; border: 1px solid #DDE4EC; border-radius: 16px; padding: 28px 24px; max-width: 480px; margin: 0 auto; box-shadow: 0 12px 40px rgba(26,58,92,.08); }
    p { color: #4A5D6E; font-size: 15px; line-height: 1.6; margin-bottom: 24px; }
    .firm-name { font-family: 'Nunito', sans-serif; font-size: 26px; font-weight: 800; letter-spacing: -.3px; margin-bottom: 6px; color: #1A3A5C; }
    label { display: block; font-size: 12px; font-weight: 700; font-family: 'Nunito', sans-serif; text-transform: uppercase; letter-spacing: .8px; color: #4A5D6E; margin-bottom: 8px; margin-top: 18px; }
    input, textarea { width: 100%; background: #EAF2FB; border: 2px solid #DDE4EC; border-radius: 10px; padding: 13px 16px; font-size: 16px; font-family: inherit; color: #1C2A38; outline: none; transition: border-color .2s, box-shadow .2s; }
    input:focus, textarea:focus { border-color: #2C6B9E; box-shadow: 0 0 0 3px rgba(44,107,158,.18); }
    textarea { height: 100px; resize: vertical; line-height: 1.5; }
    .urgent-row { display: flex; align-items: center; gap: 10px; margin-top: 18px; padding: 12px 14px; background: #EAF2FB; border: 2px solid #DDE4EC; border-radius: 10px; }
    .urgent-row input { width: auto; accent-color: #dc2626; }
    .urgent-row label { margin: 0; text-transform: none; letter-spacing: 0; font-family: 'Source Sans 3', sans-serif; font-size: 14px; font-weight: 400; color: #1C2A38; }
    button { margin-top: 26px; width: 100%; background: #2C6B9E; color: #fff; border: none; border-radius: 10px; padding: 15px; font-size: 16px; font-weight: 800; font-family: 'Nunito', sans-serif; cursor: pointer; transition: background .2s, transform .15s; }
    button:hover { background: #3579b0; transform: translateY(-1px); }
  </style>
</head>
<body>
  <div class="card">
    <div class="firm-name">${firmName}</div>
    <p>Beskriv din opgave, så vender vi tilbage hurtigst muligt.</p>
    <form method="POST" enctype="multipart/form-data">
      <label for="navn">Dit navn</label>
      <input id="navn" name="navn" type="text" placeholder="Anders Andersen" required>

      <label>Adresse</label>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">
        <input name="vej" type="text" placeholder="Søndergade 12" required>
        <input name="by" type="text" placeholder="Aarhus" required>
      </div>

      <label for="opgave">Beskriv opgaven</label>
      <textarea id="opgave" name="opgave" placeholder="Bruseren drypper og vandhanen i køkkenet løber..." required></textarea>

      <label for="tidspunkt">Hvornår passer det dig?</label>
      <input id="tidspunkt" name="tidspunkt" type="text" placeholder="Hverdage efter kl. 16, eller weekend">

      <label for="billeder">Vedhæft billeder (valgfrit)</label>
      <input id="billeder" name="billeder" type="file" accept="image/*" multiple>

      <div class="urgent-row">
        <input id="urgent" name="urgent" type="checkbox">
        <label for="urgent">Det haster</label>
      </div>

      <button type="submit">Send opgave</button>
    </form>
  </div>
</body>
</html>`);
});

// ─── 3. MODTAG UDFYLDT FORMULAR ─────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage() });

app.post("/formular/:token", upload.array("billeder"), async (req, res) => {
  const { data: call } = await supabase
    .from("calls")
    .select("id")
    .eq("lead_token", req.params.token)
    .single();

  if (!call) return res.status(404).send("Link ikke gyldigt");

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      call_id:      call.id,
      name:         req.body.navn,
      address:      [req.body.vej, req.body.by].filter(Boolean).join(", "),
      task:         req.body.opgave,
      desired_time: req.body.tidspunkt,
      is_urgent:    req.body.urgent === "on",
    })
    .select()
    .single();

  if (error) {
    console.error("❌ Supabase fejl:", error);
    return res.status(500).send("Fejl");
  }

  for (const file of req.files || []) {
    const filePath = `${lead.id}/${Date.now()}-${file.originalname}`;
    const { error: uploadError } = await supabase.storage
      .from("lead-images")
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) { console.error("❌ Billedfejl:", uploadError); continue; }

    const { data: publicUrl } = supabase.storage
      .from("lead-images")
      .getPublicUrl(filePath);

    await supabase.from("lead_images").insert({
      lead_id:   lead.id,
      image_url: publicUrl.publicUrl,
    });
  }

  await supabase
    .from("calls")
    .update({ status: "completed" })
    .eq("id", call.id);

  console.log("✅ Lead gemt:", lead.id);

  res.send(`<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tak!</title>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
  <link rel="shortcut icon" href="/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Source+Sans+3:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Source Sans 3', system-ui, sans-serif; background: #F4F7FA; color: #1C2A38; padding: 24px 16px; text-align: center; }
    .card { background: #fff; border: 1px solid #DDE4EC; border-radius: 16px; padding: 44px 24px; max-width: 480px; margin: 40px auto; box-shadow: 0 12px 40px rgba(26,58,92,.08); }
    .check { width: 64px; height: 64px; border-radius: 50%; background: #E8F5EE; color: #2E7D52; font-size: 32px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; }
    h1 { font-family: 'Nunito', sans-serif; font-size: 23px; font-weight: 800; color: #1A3A5C; margin-bottom: 8px; }
    p { color: #4A5D6E; font-size: 15px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1>Tak for din besked!</h1>
    <p>Vi vender tilbage hurtigst muligt.</p>
  </div>
</body>
</html>`);
});

// ─── ONBOARDING SIDE ────────────────────────────────────────────────────────
app.get('/onboarding', (req, res) => {
  const fs   = require('fs');
  const path = require('path');
  let html   = fs.readFileSync(path.join(__dirname, 'static/onboarding.html'), 'utf8');

  // Injicér Supabase config så klienten kan oprette session fra magic link
  const config = `<script>
    window.SUPABASE_URL      = '${process.env.SUPABASE_URL}';
    window.SUPABASE_ANON_KEY = '${process.env.SUPABASE_ANON_KEY}';
  </script>`;

  html = html.replace('</head>', config + '</head>');
  res.send(html);
});

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
app.get("/dashboard", (req, res) =>
  res.sendFile(__dirname + "/static/dashboard.html")
);

// ─── MANUEL OPRETTELSE AF OPGAVE FRA DASHBOARD ──────────────────────────────
app.post("/opret-opgave", async (req, res) => {
  const { name, phone, address, address_mail, task, desired_time, is_urgent, notes, firm_id } = req.body;

  if (!name || !task || !firm_id)
    return res.status(400).json({ error: "Mangler navn, opgave eller firma" });

  const { data: call, error: callError } = await supabase
    .from("calls")
    .insert({
      from_number: phone || "Manuel oprettelse",
      to_number:   "",
      firm_id,
      raw_payload: {},
    })
    .select()
    .single();

  if (callError) {
    console.error("❌ Call fejl:", callError);
    return res.status(500).json({ error: callError.message });
  }

  const { error: leadError } = await supabase.from("leads").insert({
    call_id:      call.id,
    name,
    address,
    task,
    desired_time: desired_time || null,
    is_urgent:    !!is_urgent,
    notes:        notes || null,
    address_mail: address_mail || null,
    seen_at:      new Date().toISOString(),
  });

  if (leadError) {
    console.error("❌ Lead fejl:", leadError);
    return res.status(500).json({ error: leadError.message });
  }

  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server kører på port ${PORT}`));
