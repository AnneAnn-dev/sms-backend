require("dotenv").config();
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static('static'));
app.get('/manifest.json', (req, res) => {
  res.sendFile(__dirname + '/static/manifest.json');
});
app.get('/sw.js', (req, res) => {
  res.sendFile(__dirname + '/static/sw.js');
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ─── 1. TWILIO WEBHOOK — kunde ringer ───────────────────────────────────────


app.post("/opkald", async (req, res) => {
  console.log("📞 Opkald modtaget:", req.body.From);
  console.log("BASE_URL:", process.env.BASE_URL);
  // Find firma baseret på det nummer der blev ringet til
  const { data: firm } = await supabase
    .from("firms")
    .select("id, name")
    .eq("phone_number", req.body.To)
    .single();
console.log("Firm opslag:", req.body.To, "→", firm);
  const { data: call, error } = await supabase
    .from("calls")
    .insert({
      from_number: req.body.From,
      to_number: req.body.To,
      firm_id: firm?.id,
      raw_payload: req.body,
    })
    .select()
    .single();

  if (error) {
    console.error("❌ Supabase fejl:", error);
    return res.status(500).send("Fejl");
  }

  await twilioClient.messages.create({
    body: `Hej! Du har ringet til ${firm?.name || 'os'}. Udfyld din opgave her, så vender vi tilbage hurtigst muligt:\n${process.env.BASE_URL}/formular/${call.lead_token}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: req.body.From,
  });

  res.type("text/xml").send(`
    <Response>
      <Say language="da-DK">
        Hej, du har ringet til ${firm?.name || 'os'}.
        Jeg har desværre ikke mulighed for at tage telefonen lige nu,
        men jeg sender dig en SMS hvor du kan beskrive din opgave.
        Jeg vender tilbage hurtigst muligt.
      </Say>
    </Response>
  `);
});

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
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; padding: 24px 16px; }
    .card { background: white; border-radius: 12px; padding: 24px; max-width: 480px; margin: 0 auto; }
    h1 { font-size: 20px; margin-bottom: 8px; }
    p { color: #666; font-size: 14px; margin-bottom: 24px; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; margin-top: 16px; }
    input, textarea { width: 100%; border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; font-size: 16px; font-family: inherit; }
    textarea { height: 100px; resize: vertical; }
    .urgent-row { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
    .urgent-row input { width: auto; }
    .urgent-row label { margin: 0; }
    button { margin-top: 24px; width: 100%; background: #2563eb; color: white; border: none; border-radius: 8px; padding: 14px; font-size: 16px; font-weight: 500; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Beskriv din opgave</h1>
    <p>${firmName} vender tilbage hurtigst muligt.</p>
    <form method="POST" enctype="multipart/form-data">
      <label for="navn">Dit navn</label>
      <input id="navn" name="navn" type="text" placeholder="Anders Andersen" required>

      <label for="adresse">Adresse</label>
      <input id="adresse" name="adresse" type="text" placeholder="Søndergade 12, 8000 Aarhus" required>

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
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

app.post("/formular/:token", upload.array("billeder"), async (req, res) => {
  const { data: call } = await supabase
    .from("calls")
    .select("id")
    .eq("lead_token", req.params.token)
    .single();

  if (!call) return res.status(404).send("Link ikke gyldigt");

  // Gem lead
  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      call_id: call.id,
      name: req.body.navn,
      address: req.body.adresse,
      task: req.body.opgave,
      desired_time: req.body.tidspunkt,
      is_urgent: req.body.urgent === "on",
    })
    .select()
    .single();

  if (error) {
    console.error("❌ Supabase fejl:", error);
    return res.status(500).send("Fejl");
  }

  // Upload billeder hvis der er nogle
  for (const file of req.files || []) {
    const filePath = `${lead.id}/${Date.now()}-${file.originalname}`;

    const { error: uploadError } = await supabase.storage
      .from("lead-images")
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error("❌ Billedfejl:", uploadError);
      continue;
    }

    const { data: staticUrl } = supabase.storage
      .from("lead-images")
      .getstaticUrl(filePath);

    await supabase.from("lead_images").insert({
      lead_id: lead.id,
      image_url: staticUrl.staticUrl,
    });
  }

  // Opdater status på opkaldet
  await supabase
    .from("calls")
    .update({ status: "completed" })
    .eq("id", call.id);

  console.log("✅ Lead gemt:", lead.id);

  // Tak-side
  res.send(`<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tak!</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f5f5f5; padding: 24px 16px; text-align: center; }
    .card { background: white; border-radius: 12px; padding: 40px 24px; max-width: 480px; margin: 40px auto; }
    .check { font-size: 48px; margin-bottom: 16px; color: #16a34a; }
    h1 { font-size: 22px; margin-bottom: 8px; }
    p { color: #666; }
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

// dashboard
app.get("/dashboard", (req, res) => {
  res.sendFile(__dirname + "/static/dashboard.html");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server kører på port ${PORT}`));