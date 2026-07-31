require("dotenv").config({ quiet: true });
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const webpush = require("web-push");
const multer = require("multer");
const { firmIdFromToken } = require("./auth");
const { sendError } = require("@appsignal/nodejs"); // AppSignal-klienten er allerede initialiseret via --require ./appsignal.cjs
const { TILBUD_AKTIV } = require("./flags");

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

// ─── Sundhedstjek: bruges af roegtesten (smoke.js) ─────────────────────
// Svarer 200 saa laenge processen lever og Express svarer. Bevidst tom for
// logik: den skal kunne fejle NAAR appen er nede, ikke naar noget andet er.
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Escaper tekst der saettes ind i HTML, saa fx et firmanavn med < > & " '
// ikke kan injicere markup paa de offentlige sider.
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Frontend-config: /config.js (miljoeets Supabase-adresse til browseren) ─
// Serverer window.APP_CONFIG (SUPABASE_URL + SUPABASE_ANON_KEY fra DENNE
// servers env-vars), saa onboarding/dashboard ALTID taler med det miljoe, de
// blev serveret fra. Erstatter de hardcodede prod-vaerdier i HTML-filerne,
// som var rodaarsagen til "udloebet link"-fejlen i staging (10/7-26).
// UDEN denne linje findes /config.js ikke -> siderne faar 404 paa configen
// og kan ikke oprette Supabase-klienten.
require("./app-config")(app);

// ─── Onboarding: Shopify webhook + Twilio opkaldshandler ────────────────────
require("./onboarding")(app, supabase);

// ─── Frisbii Billing & Pay: betalings-webhook (onboarding-trigger) ──────────
// Behøver IKKE rå body — Frisbii signerer kun timestamp+id, så global express.json() er nok.
require("./frisbii-webhook")(app, supabase);

// ─── "Send mig et login-link": redningsvej for glemt adgangskode ────────────
// Registrerer POST /onboarding/nyt-link (prefetch-sikkert login-link via egen
// Scaleway-mail, rate-limitet + anti-enumeration). UDEN denne linje findes
// routen ikke → POST giver 404, fetch kaster ikke, og knappen "lykkes" tavst
// uden at sende nogen mail.
require("./onboarding-link")(app, supabase);

// ─── Tilbudsmodul — bag feature flag ────────────────────────────────
// TILBUD_AKTIV=true kun i staging. Slukket betyder at ruterne slet ikke
// registreres: /api/tilbud/* og /tilbud/* giver 404, og appen ved ikke at
// modulet findes. Det er rollback-haandtaget — ét miljoevariabel-skift og
// en genstart, i stedet for revert + build + deploy.
//
// AFKOMMENTER de to linjer i SAMME commit som routes/tilbud oprettes.
// Indtil da ville et taendt flag pege paa en fil, der ikke findes — og
// appen ville crashe ved opstart.
if (TILBUD_AKTIV) {
  // require("./routes/tilbud")(app, supabase);
  // app.use("/tilbud", express.static("tilbud"));
}
console.log(`⚙️  Tilbudsmodul: ${TILBUD_AKTIV ? "TAENDT" : "SLUKKET"}`);

// ─── ADRESSE-NORMALISERING ──────────────────────────────────────────────────
// DAWA's forslagstekst slutter typisk allerede på "postnr by", og kan
// indeholde tomme segmenter (", ,") fra mellemtrins-forslag. Vi normaliserer
// derfor ALTID her (ét chokepoint), uanset hvad klienten sender: split på
// komma, trim, fjern tomme dele og dubletter, og sørg for at postnr+by står
// præcis én gang — bagerst. Resultat: "Gade 12[, Supplerende Bynavn], 1234 By".
function bygAdresse(vej, postnr, by) {
  const dele = String(vej || "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d, i, arr) => arr.indexOf(d) === i); // fjern dubletter
  const postnrBy = [postnr, by].map((v) => String(v || "").trim()).filter(Boolean).join(" ");
  if (!postnrBy) return dele.join(", ");
  const rest = dele.filter((d) => d !== postnrBy);
  return [...rest, postnrBy].join(", ");
}

// ─── 2. VIS FORMULAR ────────────────────────────────────────────────────────
app.get("/formular/:token", async (req, res) => {
  const { data: call } = await supabase
    .from("calls")
    .select("id, firms(name)")
    .eq("lead_token", req.params.token)
    .single();

  if (!call) return res.status(404).send("Link ikke gyldigt");

  const firmName = escapeHtml(call.firms?.name || "os");

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
      <div style="position:relative">
        <input id="dawa-input" name="vej" type="text" placeholder="Begynd at skrive vejnavn..." autocomplete="off" required>
        <input type="hidden" name="by" id="dawa-by">
        <input type="hidden" name="postnr" id="dawa-postnr">
        <div id="dawa-suggestions" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:99;background:white;border:1px solid #ddd;border-radius:10px;margin-top:2px;max-height:220px;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,0.12)"></div>
      </div>
      <div style="color:#dc2626;font-size:13px;margin-top:4px;display:none" id="dawa-error">Vælg venligst en adresse fra listen</div>

      <label for="email">Email (valgfrit)</label>
      <input id="email" name="email" type="email" placeholder="anders@eksempel.dk">

      <label for="opgave">Beskriv opgaven</label>
      <textarea id="opgave" name="opgave" placeholder="Bruseren drypper og vandhanen i køkkenet løber..." required></textarea>

      <label for="billeder">Vedhæft billeder (valgfrit)</label>
      <input id="billeder" name="billeder" type="file" accept="image/*" multiple>

      <div class="urgent-row">
        <input id="urgent" name="urgent" type="checkbox">
        <label for="urgent">Det haster</label>
      </div>

      <button type="submit">Send opgave</button>
    </form>
  </div>
<script>
  let dawaValgt = false;
  let debounce = null;
  let aktive = -1;
  let forslag = [];

  const inp = document.getElementById('dawa-input');
  const boks = document.getElementById('dawa-suggestions');
  const fejl = document.getElementById('dawa-error');

  inp.addEventListener('input', () => {
    dawaValgt = false;
    aktive = -1;
    const q = inp.value.trim();
    if (q.length < 2) { skjul(); return; }
    clearTimeout(debounce);
    debounce = setTimeout(() => hentForslag(q), 200);
  });

  inp.addEventListener('keydown', e => {
    if (!forslag.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); aktive = Math.min(aktive+1, forslag.length-1); vis(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); aktive = Math.max(aktive-1, 0); vis(); }
    else if (e.key === 'Enter' && aktive >= 0) { e.preventDefault(); vaelg(forslag[aktive]); }
    else if (e.key === 'Escape') skjul();
  });

  document.addEventListener('click', e => {
    if (e.target !== inp && !boks.contains(e.target)) skjul();
  });

  async function hentForslag(q) {
    try {
      const r = await fetch('https://api.dataforsyningen.dk/autocomplete?q=' + encodeURIComponent(q) + '&type=adresse&per_side=8&fuzzy=');
      forslag = await r.json();
      vis();
    } catch { skjul(); }
  }

  function fremhæv(tekst, q) {
    const i = tekst.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return tekst;
    return tekst.slice(0,i) + '<strong>' + tekst.slice(i, i+q.length) + '</strong>' + tekst.slice(i+q.length);
  }

  function vis() {
    if (!forslag.length) { skjul(); return; }
    const q = inp.value.trim();
    boks.innerHTML = forslag.map((s,i) =>
      '<div data-i="'+i+'" style="padding:10px 14px;font-size:15px;cursor:pointer;border-bottom:1px solid #f0f0f0;'+(i===aktive?'background:#EAF2FB':'')+'">' + fremhæv(s.tekst, q) + '</div>'
    ).join('');
    boks.style.display = 'block';
    boks.querySelectorAll('div').forEach(el => {
      el.addEventListener('mousedown', e => { e.preventDefault(); vaelg(forslag[+el.dataset.i]); });
    });
  }

  function rens(t) {
    // DAWA's traedesten-tekst har et tomt "hul" til etage/doer: "Vej 4, , 2970 By".
    // Fjern tomme segmenter, saa feltet aldrig viser ", ,".
    return String(t || '').split(',').map(function(x){ return x.trim(); }).filter(Boolean).join(', ');
  }

  function vaelg(s) {
    // Mellemtrins-forslag: fortsaet indtastningen. MEN har forslaget allerede
    // postnr/by i sine data (adgangsadresse = selve huset), er adressen
    // gyldig NU - saa taeller valget med det samme, og listen bliver staaende
    // til evt. finpudsning (etage/doer). Kun rene vejnavne er stadig ugyldige.
    if (s.type !== 'adresse') {
      inp.value = rens(s.tekst);
      if (s.data && s.data.postnr) {
        dawaValgt = true;
        fejl.style.display = 'none';
        document.getElementById('dawa-by').value = s.data.postnrnavn || '';
        document.getElementById('dawa-postnr').value = s.data.postnr || '';
      } else {
        dawaValgt = false;
        document.getElementById('dawa-by').value = '';
        document.getElementById('dawa-postnr').value = '';
      }
      inp.focus();
      hentForslag(inp.value.trim());
      return;
    }
    inp.value = rens(s.tekst);
    dawaValgt = true;
    skjul();
    fejl.style.display = 'none';
    if (s.data) {
      document.getElementById('dawa-by').value = s.data.postnrnavn || '';
      document.getElementById('dawa-postnr').value = s.data.postnr || '';
    }
  }

  function skjul() { boks.style.display = 'none'; forslag = []; aktive = -1; }

  document.querySelector('form').addEventListener('submit', e => {
    // dawaValgt alene er ikke nok - kraev at postnr/by faktisk blev fanget,
    // saa et lead aldrig kan indsendes uden postnummer og by.
    if (!dawaValgt || !document.getElementById('dawa-postnr').value) {
      e.preventDefault();
      fejl.style.display = 'block';
      inp.focus();
    }
  });
</script>
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
      address:      bygAdresse(req.body.vej, req.body.postnr, req.body.by),
      address_mail: req.body.email || null,
      task:         req.body.opgave,
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

// ─── EFTER BETALING: KVITTERINGSSIDE (Frisbii accept URL) ───────────────────
app.get("/tilmeldt", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tak for din tilmelding</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Source+Sans+3:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Source Sans 3', system-ui, sans-serif; background: #F4F7FA; color: #1C2A38; padding: 24px 16px; text-align: center; }
    .card { background: #fff; border: 1px solid #DDE4EC; border-radius: 16px; padding: 44px 24px; max-width: 480px; margin: 40px auto; box-shadow: 0 12px 40px rgba(26,58,92,.08); }
    .check { width: 64px; height: 64px; border-radius: 50%; background: #E8F5EE; color: #2E7D52; font-size: 32px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; }
    h1 { font-family: 'Nunito', sans-serif; font-size: 23px; font-weight: 800; color: #1A3A5C; margin-bottom: 8px; }
    p { color: #4A5D6E; font-size: 15px; line-height: 1.6; }
    .mail { font-weight: 700; color: #1A3A5C; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1>Tak for din tilmelding!</h1>
    <p>Din konto er ved at blive oprettet. Vi har sendt dig en
    <span class="mail">mail med et login-link</span>, så du kan færdiggøre opsætningen —
    vælg stemme, skriv din velkomstbesked, og sæt viderestilling op.</p>
    <p style="margin-top:16px;color:#8595A4;font-size:14px">Tjek også din spam-mappe, hvis du ikke ser mailen inden for et par minutter.</p>
  </div>
</body>
</html>`);
});

// ─── EFTER AFBRUDT BETALING (Frisbii cancel URL) ────────────────────────────
app.get("/tilmelding-afbrudt", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tilmelding afbrudt</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Source+Sans+3:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Source Sans 3', system-ui, sans-serif; background: #F4F7FA; color: #1C2A38; padding: 24px 16px; text-align: center; }
    .card { background: #fff; border: 1px solid #DDE4EC; border-radius: 16px; padding: 44px 24px; max-width: 480px; margin: 40px auto; box-shadow: 0 12px 40px rgba(26,58,92,.08); }
    h1 { font-family: 'Nunito', sans-serif; font-size: 23px; font-weight: 800; color: #1A3A5C; margin-bottom: 8px; }
    p { color: #4A5D6E; font-size: 15px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Tilmeldingen blev afbrudt</h1>
    <p>Der er ikke trukket nogen betaling. Du er velkommen til at prøve igen, når det passer dig.</p>
  </div>
</body>
</html>`);
});

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
app.get("/dashboard", (req, res) =>
  res.sendFile(__dirname + "/static/dashboard.html")
);

// ─── MANUEL OPRETTELSE AF OPGAVE FRA DASHBOARD ──────────────────────────────
app.post("/opret-opgave", async (req, res) => {
  const firm_id = await firmIdFromToken(supabase, req);
  if (!firm_id) return res.status(401).json({ error: "Ikke logget ind" });

  const { name, phone, address, address_mail, task, desired_time, is_urgent, notes } = req.body;

  if (!name || !task)
    return res.status(400).json({ error: "Mangler navn eller opgave" });

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

// ─── MASKERET FORMULAR-LINK: opgave.ditdigitalekontor.dk/{slug}/{token} ───────────
// SMS'en sender det pæne, maskerede link med firma-slug. Her validerer vi
// tokenet og sender videre til den kanoniske /formular/:token (samme domæne,
// så den grimme Railway-URL ses aldrig). Slug'en er ren kosmetik i SMS'en —
// selve opslaget sker på tokenet, ikke på slug'en.
//
// VIGTIGT: denne route registreres SIDST (lige før app.listen), så den strikse
// token-regex er det eneste der overhovedet fanger to-segments-stier. Alt der
// ikke matcher et 12-tegns token (favicon, statiske filer, /formular/:token med
// gammelt UUID osv.) falder igennem via next() til normal 404-håndtering.
const MASK_TOKEN_RE = /^[a-z0-9]{12}$/;

app.get("/:slug/:token", async (req, res, next) => {
  const { token } = req.params;
  if (!MASK_TOKEN_RE.test(token)) return next(); // ikke et gyldigt token → videre i stakken

  const { data: call } = await supabase
    .from("calls")
    .select("id")
    .eq("lead_token", token)
    .single();

  if (!call) return next(); // ukendt token → 404

  return res.redirect(302, `/formular/${token}`);
});

// MIDLERTIDIG — fjern efter test (verificerer at fejl når AppSignal)
app.get("/test-appsignal", (req, res) => {
  throw new Error("AppSignal test-fejl 🚨");
});

// ─── AppSignal: robust fejlhåndterer — EFTER alle routes, FØR app.listen ─────
// Bruger sendError (egen rod-span), så route-fejl fanges uanset om Express 5
// endnu er instrumenteret. Skal ligge sidst i middleware-kæden.
app.use((err, req, res, next) => {
  sendError(err);
  next(err); // lad Express sende det normale fejl-svar
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server kører på port ${PORT}`));
