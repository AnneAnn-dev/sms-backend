require("dotenv").config({ quiet: true });
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const webpush = require("web-push");
const { firmIdFromToken } = require("./auth");
const { gyldigtSmsNummer, kundeNoegle } = require("./phone");
const { sendError } = require("@appsignal/nodejs"); // AppSignal-klienten er allerede initialiseret via --require ./appsignal.cjs
const { TILBUD_AKTIV, KUNDE_MATCH_AKTIV, FORMULAR_ENGANGS_AKTIV } = require("./flags");
const { knytKunde } = require("./kundematch");
const { hentEgenRaekke } = require("./ejerskab");
const billeder = require("./billeder");
const { brugFormular, frigivFormular, linkBrugtSide, forMangeBillederSide } = require("./formular-engangs");
const { registrerPushRuter, sendNytLeadPush } = require("./push");

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static("static"));

app.get("/manifest.json", (req, res) =>
  res.sendFile(__dirname + "/static/manifest.json")
);
app.get("/sw.js", (req, res) =>
  res.sendFile(__dirname + "/static/sw.js")
);

// Kvoten er en BREMSE (driftrunbookens Del 3b): den kan stoppe produktet for
// en kunde, uden at noget er i stykker. Derfor udstilles det HER, om den
// overhovedet er konfigureret — så et manglende loft ses ved hvert deploy i
// stedet for som en uforklarlig afvisning tre uger senere.
// null = modulet er slukket, så spørgsmålet er ikke relevant.
function kvoteKonfigureret() {
  if (!TILBUD_AKTIV) return null;
  try { require("./kvote")._hentLofter(); return true; } catch { return false; }
}

// ─── Sundhedstjek: bruges af roegtesten (smoke.js) ─────────────────────
// Svarer 200 saa laenge processen lever og Express svarer. Bevidst tom for
// logik: den skal kunne fejle NAAR appen er nede, ikke naar noget andet er.
// Udstiller ogsaa TILSTAND, saa roegtesten kan SPOERGE i stedet for at gaette.
// Det er hele svaret paa "jeg kan ikke huske at rette forventningen i smoke.js".
app.get("/health", (req, res) =>
  res.status(200).json({
    ok: true,
    tilbud: TILBUD_AKTIV,
    kundematch: KUNDE_MATCH_AKTIV,
    formularEngangs: FORMULAR_ENGANGS_AKTIV,
    kvote: kvoteKonfigureret(),
  })
);

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

// ─── Onboarding: Twilio opkaldshandler ──────────────────────────────────────
require("./onboarding")(app, supabase);

// ─── Frisbii Billing & Pay: betalings-webhook (onboarding-trigger) ──────────
// Behøver IKKE rå body — Frisbii signerer kun timestamp+id, så global express.json() er nok.
require("./frisbii-webhook")(app, supabase);

// ─── Frisbii Checkout: broen fra Simply-siden til betalingen ────────────────
// Registrerer POST /checkout/start. UDEN denne linje er modulet aldrig indlæst
// → POST giver 404, intet logges, og Simply-sidens koeb-knap "lykkes" tavst.
// Det var anden forekomst af den fejlmaade (foerste var onboarding-link
// herunder); fjernes permanent af ≠404-tjekket i roegtesten, se D23.
// Tager KUN (app) — routen roerer ikke databasen.
// Env-vars laeses ved MONTERING, ikke pr. kald: aendres FRISBII_PLAN_HANDLE
// eller SIMPLY_BASE_URL i Railway, skal appen genstarte, foer det virker.
// Mangler de, svarer routen 500 "server_misconfigured" — den kan ikke crashe
// ved boot, fordi requireConfig() foerst kaldes inde i handleren.
require("./frisbii-checkout")(app);

// ─── "Send mig et login-link": redningsvej for glemt adgangskode ────────────
// Registrerer POST /onboarding/nyt-link (prefetch-sikkert login-link via egen
// Scaleway-mail, rate-limitet + anti-enumeration). UDEN denne linje findes
// routen ikke → POST giver 404, fetch kaster ikke, og knappen "lykkes" tavst
// uden at sende nogen mail.
require("./onboarding-link")(app, supabase);

// ─── Adresser: vores eget endpoint foran Adressevaelgeren (D77) ────────────
// Registrerer GET /api/adresse/soeg, /api/adresse/status og /api/adresse/:id.
// Kundeformularen og dashboardet kalder KUN disse — adressen paa tjenesten og
// tokenen staar ét sted (adresse.js). Mangler linjen, giver felterne 404, og
// fail-open viser postnr/by-felterne: formularen virker, men uden forslag.
require("./adresse")(app);


// ─── Push-abonnementer: badge/notifikation med appen lukket (D34) ──────────
// Registrerer POST /api/push/subscribe + /api/push/unsubscribe. Selve
// afsendelsen (sendNytLeadPush) kaldes fra POST /formular/:token nedenfor.
registrerPushRuter(app, supabase);

// ─── Tilbudsmodul — bag feature flag ────────────────────────────────
// TILBUD_AKTIV=true kun i staging. Slukket betyder at ruterne slet ikke
// registreres: /api/tilbud/* og /tilbud/* giver 404, og appen ved ikke at
// modulet findes. Det er rollback-haandtaget — ét miljoevariabel-skift og
// en genstart, i stedet for revert + build + deploy.
//
// Linjerne herunder koerer foerst, naar flaget er true. Saet det ALDRIG til
// true, foer mappen routes/tilbud findes: saa crasher appen ved opstart.
// Det er den rigtige maade at fejle paa - hoejlydt, med det samme, og kun
// i staging, fordi prod staar slukket.
if (TILBUD_AKTIV) {
  require("./routes/tilbud")(app, supabase);
  app.use("/tilbud", express.static("tilbud"));
}

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

// Overskriften paa en opgave (D88 trin 2, opgave 5). Valgfri: tom = null, saa
// gamle og nye opgaver uden overskrift ser ens ud. leads.titel findes siden
// 27/7 (kunder_og_opgavelag) — der er ingen ny kolonne.
const MAX_TITEL = 120;
function renTitel(v) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, MAX_TITEL) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Firmaets navn og haandvaerkerens eget nummer til "linket er brugt"-siden.
// Fejler opslaget, vises siden uden nummer — den maa aldrig blive tom.
async function firmaTilBrugtSide(firmId) {
  try {
    const { data } = await supabase.from("firms").select("name, owner_phone").eq("id", firmId).maybeSingle();
    return { firmanavn: data?.name, telefon: data?.owner_phone };
  } catch (_) { return {}; }
}

// ─── 2. VIS FORMULAR ────────────────────────────────────────────────────────
app.get("/formular/:token", async (req, res) => {
  const { data: call, error: callFejl } = await supabase
    .from("calls")
    .select("id, formular_brugt_at, firms(name, owner_phone)")
    .eq("lead_token", req.params.token)
    .maybeSingle();

  // En databasefejl er IKKE et ugyldigt link. Foer 19/10 blev begge til 404,
  // saa en manglende kolonne (koden deployet foer migrationen) ville have
  // ligget som "Link ikke gyldigt" hos hver eneste kunde uden en lyd.
  if (callFejl) {
    console.error("❌ formular: opkaldet kunne ikke laeses:", callFejl.code, callFejl.message);
    sendError(new Error(`formular GET: ${callFejl.code} ${callFejl.message}`));
    return res.status(500).send("Fejl");
  }
  if (!call) return res.status(404).send("Link ikke gyldigt");

  // S34: linket virker én gang. 410 = "var her, er der ikke mere".
  if (FORMULAR_ENGANGS_AKTIV && call.formular_brugt_at) {
    return res.status(410).send(linkBrugtSide({
      firmanavn: call.firms?.name, telefon: call.firms?.owner_phone,
    }));
  }

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
      <!-- Reservevej (4/10-26): vises kun, naar adressetjenesten ikke svarer.
           DAWA lukkede 1/10-26 (svarer 410), og formularen kunne derefter
           slet ikke sendes. Se scriptet nedenfor. -->
      <div id="manuel-adresse" style="display:none;grid-template-columns:1fr 2fr;gap:8px;margin-top:8px">
        <input id="manuel-postnr" type="text" inputmode="numeric" maxlength="4" placeholder="Postnr." autocomplete="postal-code">
        <input id="manuel-by" type="text" placeholder="By" autocomplete="address-level2">
      </div>
      <div style="color:#dc2626;font-size:13px;margin-top:4px;display:none" id="dawa-error">Vælg venligst en adresse fra listen</div>

      <label for="email">Email (valgfrit)</label>
      <input id="email" name="email" type="email" placeholder="anders@eksempel.dk">

      <!-- Annes ordlyd (D88 trin 2, tekst 1, godkendt af Ann 23/10-26). -->
      <label for="titel">Overskrift (valgfrit)</label>
      <input id="titel" name="titel" type="text" maxlength="${MAX_TITEL}" placeholder="Fx: Utæt tag">

      <label for="opgave">Beskriv opgaven</label>
      <textarea id="opgave" name="opgave" placeholder="Bruseren drypper og vandhanen i køkkenet løber..." required></textarea>

      <!-- Annes ordlyd (tekst 5, 23/10-26). Tallene kommer fra billeder.js. -->
      <label for="billeder">Du kan højst sende ${billeder.MAX_BILLEDER_PR_INDSENDELSE} billeder og hvert billede må højst fylde ${Math.round(billeder.MAX_BYTES_PR_BILLEDE / 1048576)} MB.</label>
      <input id="billeder" name="billeder" type="file" accept="image/*" multiple>
      <div id="billed-fejl" style="color:#dc2626;font-size:13px;margin-top:4px;display:none"></div>

      <div class="urgent-row">
        <input id="urgent" name="urgent" type="checkbox">
        <label for="urgent">Det haster</label>
      </div>

      <button type="submit">Send opgave</button>
    </form>
  </div>
<script>
  // ── Adressefeltet (D77, 8/10-26) ────────────────────────────────────
  // Forslag hentes fra VORES eget endpoint (/api/adresse, adresse.js), som
  // taler med Klimadatastyrelsens Adressevaelger. Adressen paa tjenesten og
  // tokenen staar dermed kun ét sted — paa serveren.
  // Fail-open (4/10-26, efter DAWA-lukningen): svarer endpointet ikke, vises
  // felter til postnr og by, og formularen godtager kundens egen adresse.
  // Formularen maa aldrig afhaenge af, at en fremmed tjeneste er oppe.
  let dawaValgt = false;
  let tjenesteNede = false;
  // Valgt vej (D77, 9/10-26): soegningen fortsaetter inden for vejen — og
  // inden for postnr, hvis forslaget havde et. Glemmes, saa snart feltet
  // ikke laengere begynder med vejnavnet.
  let valgtVej = '', valgtPostnr = '';
  let debounce = null;
  let aktive = -1;
  let forslag = [];

  const inp = document.getElementById('dawa-input');
  const boks = document.getElementById('dawa-suggestions');
  const fejl = document.getElementById('dawa-error');

  function slaaManueltTil() {
    if (tjenesteNede) return;
    tjenesteNede = true;
    skjul();
    document.getElementById('manuel-adresse').style.display = 'grid';
    inp.placeholder = 'Vej og husnummer';
    fejl.textContent = 'Skriv postnummer (4 cifre) og by';
    fejl.style.display = 'none';
  }

  // Proev tjenesten med det samme, saa kunden ser felterne fra start.
  (async function () {
    try {
      const r = await fetch('/api/adresse/status');
      if (!r.ok) slaaManueltTil();
    } catch (_) { slaaManueltTil(); }
  })();

  inp.addEventListener('input', () => {
    dawaValgt = false;
    aktive = -1;
    if (valgtVej && inp.value.indexOf(valgtVej) !== 0) { valgtVej = ''; valgtPostnr = ''; }
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
    if (tjenesteNede) return;
    try {
      const r = await fetch('/api/adresse/soeg?q=' + encodeURIComponent(q) + (valgtPostnr ? '&postnr=' + valgtPostnr : ''));
      if (!r.ok) { slaaManueltTil(); return; }
      const data = await r.json();
      if (!data || !Array.isArray(data.forslag)) { slaaManueltTil(); return; }
      // Et svar paa en AELDRE soegning maa ikke overskrive en nyere.
      if (inp.value.trim() !== q) return;
      forslag = data.forslag;
      vis();
    } catch (_) { slaaManueltTil(); }
  }

  function fremhæv(tekst, q) {
    const i = tekst.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return tekst;
    return tekst.slice(0,i) + '<strong>' + tekst.slice(i, i+q.length) + '</strong>' + tekst.slice(i+q.length);
  }

  function esc(t) {
    return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function vis() {
    if (!forslag.length) { skjul(); return; }
    const q = inp.value.trim();
    boks.innerHTML = forslag.map((s,i) =>
      '<div data-i="'+i+'" style="padding:10px 14px;font-size:15px;cursor:pointer;border-bottom:1px solid #f0f0f0;'+(i===aktive?'background:#EAF2FB':'')+'">' + fremhæv(esc(s.tekst), esc(q)) + '</div>'
    ).join('');
    boks.style.display = 'block';
    boks.querySelectorAll('div').forEach(el => {
      el.addEventListener('mousedown', e => { e.preventDefault(); vaelg(forslag[+el.dataset.i]); });
    });
  }

  // Et forslag er et husnummer. Postnr og by hentes ved opslag paa id'et,
  // saa de kommer fra registret og ikke fra en tekst, vi selv skiller ad.
  async function vaelg(s) {
    if (s.type === 'vej') {
      // En vej er ikke en adresse: saet vejnavnet i feltet og vis husnumrene.
      valgtVej = s.vej; valgtPostnr = s.postnr || '';
      inp.value = s.vej + ' ';
      dawaValgt = false;
      document.getElementById('dawa-by').value = '';
      document.getElementById('dawa-postnr').value = '';
      skjul();
      inp.focus();
      hentForslag(s.vej);
      return;
    }
    inp.value = s.tekst;
    skjul();
    fejl.style.display = 'none';
    try {
      const r = await fetch('/api/adresse/' + encodeURIComponent(s.id));
      // Har kunden rettet i feltet, mens opslaget kørte, gælder valget ikke.
      if (inp.value !== s.tekst) return;
      let d = r.ok ? await r.json() : null;
      // 404: tjenesten er oppe, men kunne ikke slå netop dette husnummer op
      // (set 8/10-26). Forslagets tekst kommer fra samme register og slutter
      // med "postnr by" — brug den frem for reservevejen.
      if (r.status === 404) d = fraTekst(s.tekst);
      if (!d || !d.postnr) { slaaManueltTil(); return; }
      document.getElementById('dawa-by').value = d.by || '';
      document.getElementById('dawa-postnr').value = d.postnr || '';
      dawaValgt = true;
    } catch (_) { slaaManueltTil(); }
  }

  // "Vej 1, [Suppl. by,] 2630 Taastrup" -> { postnr, by }, ellers null.
  // (Ingen backslash i regex'en: scriptet staar i en template-streng.)
  function fraTekst(t) {
    const m = /,[ ]*([0-9]{4})[ ]+([^,]+)$/.exec(String(t || ''));
    return m ? { postnr: m[1], by: m[2].trim() } : null;
  }

  function skjul() { boks.style.display = 'none'; forslag = []; aktive = -1; }

  // ── Billeder (D88 trin 2, 19/10-26) ──────────────────────────────────
  // Samme graenser som serveren (billeder.js). Tjekket her er kun en hjaelp:
  // serveren afviser alligevel. Men afviser SERVEREN, maa kunden gaa tilbage —
  // fanges det her, mister han intet.
  (function () {
    const MAX_ANTAL = ${billeder.MAX_BILLEDER_PR_INDSENDELSE};
    const MAX_BYTES = ${billeder.MAX_BYTES_PR_BILLEDE};
    const felt = document.getElementById('billeder');
    const besked = document.getElementById('billed-fejl');
    if (!felt || !besked) return;
    felt.addEventListener('change', () => {
      const filer = Array.from(felt.files || []);
      let tekst = '';
      // Annes ordlyd (tekst 6, 23/10-26): én tekst for begge tilfaelde.
      if (filer.length > MAX_ANTAL || filer.some(f => f.size > MAX_BYTES)) {
        tekst = 'Du kan vedhæfte højst ' + MAX_ANTAL + ' billeder og et billede må højst fylde ' + Math.round(MAX_BYTES / 1048576) + ' MB.';
      }
      besked.textContent = tekst;
      besked.style.display = tekst ? 'block' : 'none';
      if (tekst) felt.value = '';
    });
  })();

  document.querySelector('form').addEventListener('submit', e => {
    // Reservevejen: tjenesten svarer ikke, og intet er valgt fra en liste.
    // Kraev et rigtigt postnummer og en by, og send dem i de samme skjulte
    // felter som et listevalg — serverens bygAdresse() ser ingen forskel.
    if (tjenesteNede && !dawaValgt) {
      const p = document.getElementById('manuel-postnr').value.trim();
      const b = document.getElementById('manuel-by').value.trim();
      if (!/^[0-9]{4}$/.test(p) || !b) {
        e.preventDefault();
        fejl.style.display = 'block';
        document.getElementById(/^[0-9]{4}$/.test(p) ? 'manuel-by' : 'manuel-postnr').focus();
        return;
      }
      document.getElementById('dawa-postnr').value = p;
      document.getElementById('dawa-by').value = b;
      return;
    }
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
// Graenser og lagring bor i billeder.js (D88 trin 2, 19/10-26). For store
// eller for mange billeder afvises FOER linket tages i brug, saa kunden kan
// gaa tilbage og sende igen. Filer, der ikke er billeder, springes over.
const formularUpload = billeder.medUpload("billeder", (req, res, kode) =>
  res.status(413).send(forMangeBillederSide(kode, {
    maxAntal: billeder.MAX_BILLEDER_PR_INDSENDELSE,
    maxMb: Math.round(billeder.MAX_BYTES_PR_BILLEDE / 1048576),
  }))
);

app.post("/formular/:token", formularUpload, async (req, res) => {
  // S34 (19/10-26): tag linket i brug med én betinget opdatering, FOER noget
  // gemmes. firm_id kommer med herfra, saa leadet kan baere sin egen
  // ejerskabsnoegle (D21). Se formular-engangs.js.
  const brug = await brugFormular(supabase, req.params.token, { aktiv: FORMULAR_ENGANGS_AKTIV });
  if (brug.status === "ukendt") return res.status(404).send("Link ikke gyldigt");
  if (brug.status === "fejl") return res.status(500).send("Fejl");
  if (brug.status === "brugt") {
    return res.status(410).send(linkBrugtSide(await firmaTilBrugtSide(brug.call.firm_id)));
  }
  const call = brug.call;

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      call_id:      call.id,
      firm_id:      call.firm_id,   // D21: multi-tenant-noeglen, udledt af opkaldet
      name:         req.body.navn,
      // '' og aldrig null: leads.address er NOT NULL (23502, 19/10-26).
      address:      bygAdresse(req.body.vej, req.body.postnr, req.body.by) || "",
      address_mail: req.body.email || null,
      task:         req.body.opgave,
      titel:        renTitel(req.body.titel),
      is_urgent:    req.body.urgent === "on",
    })
    .select()
    .single();

  if (error) {
    // Kun koden: Postgres' `details` kan indeholde hele raekken med navn og
    // adresse ("Failing row contains ..."), og den maa ikke i loggen.
    console.error("❌ Supabase fejl (lead fra formular):", error.code, error.message);
    // Giv linket tilbage, saa kunden kan proeve igen.
    await frigivFormular(supabase, call.id, brug.stempel);
    return res.status(500).send("Fejl");
  }

  const billedResultat = await billeder.gemBilleder(supabase, lead.id, req.files);
  const ikkeGemt = (req.afvisteFiler || 0) + billedResultat.oversteg + billedResultat.fejlede;

  await supabase
    .from("calls")
    .update({ status: "completed" })
    .eq("id", call.id);

  console.log("✅ Lead gemt:", lead.id);

  // D88 trin 1b: knyt opgaven til en kunde via opkaldets nummer. EFTER at
  // opgaven er gemt — knytKunde kaster aldrig, og fejler den, har opgaven
  // blot ingen kunde (fejlen gaar til AppSignal). Slukket flag = intet sker.
  await knytKunde(supabase, {
    firmId:  call.firm_id,
    leadId:  lead.id,
    telefon: call.from_number,
    navn:    lead.name,
    adresse: lead.address,
  });

  // Fire-and-forget: en fejlet push må aldrig forsinke eller vælte kundens
  // kvittering. Manuel oprettelse (/opret-opgave) sender IKKE push — den
  // sætter seen_at med det samme og er derfor aldrig "ny". Se push.js.
  sendNytLeadPush(supabase, call.firm_id).catch((err) =>
    console.error("❌ push ved nyt lead:", err.message)
  );

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
    <p>Vi vender tilbage hurtigst muligt.</p>${ikkeGemt ? `
    <!-- Tekst 2 (Ann og Anne 23/10-26): "kun billeder" bliver staaende. -->
    <p style="margin-top:12px">${ikkeGemt === 1 ? "Én fil" : ikkeGemt + " filer"} kom ikke med. Kun billeder kan vedhæftes, højst ${billeder.MAX_BILLEDER_PR_OPGAVE} pr. opgave.</p>` : ""}
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

  const { name, phone, address, address_mail, task, desired_time, is_urgent, notes, kunde_id, titel } = req.body;

  if (!name || !task)
    return res.status(400).json({ error: "Mangler navn eller opgave" });

  // D88 trin 2: kunde_id kommer, naar Ny opgave aabnes fra en kundes side.
  // Ejerskabet tjekkes FOER noget skrives — ogsaa foer den syntetiske
  // calls-raekke — saa et fremmed id aldrig efterlader noget. Findes ikke og
  // ikke dit svarer det samme (404), saa man ikke kan taelle sig frem.
  let kundeId = null;
  if (kunde_id != null && String(kunde_id).trim()) {
    if (!UUID_RE.test(String(kunde_id))) return res.status(404).json({ error: "Kunden findes ikke" });
    try {
      await hentEgenRaekke(supabase, "kunder", String(kunde_id), firm_id, "id");
      kundeId = String(kunde_id);
    } catch (e) {
      if (e && e.kode === "ejerskab_ikke_fundet") return res.status(404).json({ error: "Kunden findes ikke" });
      console.error("❌ opret-opgave: kunde kunne ikke laeses:", e && e.kode, e && e.message);
      return res.status(500).json({ error: "Kunden kunne ikke slås op" });
    }
  }

  // Indtastet telefonnummer (10/10-26, telefonfeltet). Valideres FOER noget
  // skrives, saa en afvisning ikke efterlader en calls-raekke uden opgave.
  // Nummeret gemmes paa leads.telefon, som dashboardet og /send-sms foretraekker
  // frem for calls.from_number — og som viser "Indtastet – ikke verificeret".
  // Den syntetiske calls-raekke herunder bliver indtil videre: den goer opgaven
  // synlig, saa laenge dashboardet laeser gennem call_id (fundets punkt 2).
  let telefon = null;
  if (phone != null && String(phone).trim()) {
    telefon = gyldigtSmsNummer(phone);
    if (!telefon)
      return res.status(400).json({ error: "Telefonnummeret skal være et dansk nummer med 8 cifre" });
  }

  // Med en kunde: et indtastet nummer skal ind i kundens numre (kunde_telefoner
  // er eneste kilde, D88 betingelse 2). Hoerer nummeret til en ANDEN kunde,
  // afvises opgaven, foer noget skrives — ellers ville samme nummer pege paa
  // to kunder. Samme kunde = intet at goere.
  const noegle = kundeId && telefon ? kundeNoegle(telefon) : null;
  let nytNummer = false;
  if (noegle) {
    const { data: ejer, error: tFejl } = await supabase
      .from("kunde_telefoner").select("kunde_id")
      .eq("firm_id", firm_id).eq("telefon", noegle).maybeSingle();
    if (tFejl) {
      console.error("❌ opret-opgave: kunde_telefoner:", tFejl.code, tFejl.message);
      return res.status(500).json({ error: "Telefonnummeret kunne ikke tjekkes" });
    }
    if (ejer && ejer.kunde_id !== kundeId)
      return res.status(409).json({ error: "Telefonnummeret hører til en anden kunde" });
    nytNummer = !ejer;
  }

  const { data: call, error: callError } = await supabase
    .from("calls")
    .insert({
      from_number: telefon || "Manuel oprettelse",
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

  const { data: nyLead, error: leadError } = await supabase.from("leads").insert({
    call_id:      call.id,
    firm_id,                        // D21: kendt fra sessionen, samme som paa calls-raekken
    name,
    telefon,                        // indtastet, normaliseret — eller null
    address:      address || "",    // NOT NULL i databasen (23502, 19/10-26)
    task,
    titel:        renTitel(titel),
    kunde_id:     kundeId,          // null = matchningen herunder knytter
    desired_time: desired_time || null,
    is_urgent:    !!is_urgent,
    notes:        notes || null,
    address_mail: address_mail || null,
    seen_at:      new Date().toISOString(),
  }).select("id").single();

  if (leadError) {
    console.error("❌ Lead fejl:", leadError.code, leadError.message);   // aldrig details (persondata)
    return res.status(500).json({ error: leadError.message });
  }

  if (kundeId) {
    // Valgt kunde: ingen matchning. Et nyt nummer laegges paa kunden. Fejler
    // det (fx 23505, fordi en anden naaede foerst), har opgaven stadig sin
    // kunde — fejlen logges uden nummeret.
    if (nytNummer) {
      const { error: nFejl } = await supabase.from("kunde_telefoner")
        .insert({ firm_id, kunde_id: kundeId, telefon: noegle });
      if (nFejl) console.error("❌ opret-opgave: nummer ikke lagt paa kunden:", nFejl.code, nFejl.message);
    }
  } else {
    // D88 trin 1b: samme regel som /formular. Uden indtastet nummer bliver det
    // en ny kunde uden nummer (dubletter accepteres indtil "laeg sammen").
    await knytKunde(supabase, { firmId: firm_id, leadId: nyLead.id, telefon, navn: name, adresse: address });
  }

  // id'et skal med tilbage: dashboardet laegger billederne paa bagefter.
  res.json({ ok: true, id: nyLead.id });
});

// ─── BILLEDER PAA EN OPGAVE FRA DASHBOARDET (D88 trin 2, opgave 9) ─────────
// Haandvaerkerens egne billeder: samme graenser, sti og tabel som kundens
// formular (billeder.js). Firmaet udledes af tokenet, og opgaven skal vaere
// firmaets — FOER filerne overhovedet modtages, saa en fremmed ikke kan fylde
// serverens hukommelse. Fremmed og ukendt id svarer begge 404.
async function kraevEgenOpgave(req, res, next) {
  const firmId = await firmIdFromToken(supabase, req);
  if (!firmId) return res.status(401).json({ error: "Ikke logget ind" });
  if (!UUID_RE.test(String(req.params.id || ""))) return res.status(404).json({ error: "Opgaven findes ikke" });
  try {
    await hentEgenRaekke(supabase, "leads", req.params.id, firmId, "id");
  } catch (e) {
    if (e && e.kode === "ejerskab_ikke_fundet") return res.status(404).json({ error: "Opgaven findes ikke" });
    console.error("❌ opgave-billeder: opgaven kunne ikke laeses:", e && e.kode, e && e.message);
    return res.status(500).json({ error: "Opgaven kunne ikke slås op" });
  }
  next();
}

const opgaveUpload = billeder.medUpload("billeder", (req, res, kode) =>
  res.status(413).json({
    error: kode,
    besked: kode === "for_mange"
      ? `Du kan lægge højst ${billeder.MAX_BILLEDER_PR_INDSENDELSE} billeder på ad gangen.`
      : kode === "for_stor"
        ? `Et billede er for stort. Hvert billede må højst fylde ${Math.round(billeder.MAX_BYTES_PR_BILLEDE / 1048576)} MB.`
        : "Billederne kunne ikke modtages.",
  })
);

app.post("/opgave/:id/billeder", kraevEgenOpgave, opgaveUpload, async (req, res) => {
  const r = await billeder.gemBilleder(supabase, req.params.id, req.files);
  res.json({
    ok: true,
    gemt: r.gemt,
    ikke_billeder: req.afvisteFiler || 0,
    over_loftet: r.oversteg,
    fejlede: r.fejlede,
    max_pr_opgave: billeder.MAX_BILLEDER_PR_OPGAVE,
  });
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

// ─── Venlig rod-rute (Ø5 trin 3) ────────────────────────────────────────────
// opgave.ditdigitalekontor.dk uden sti er backendens domaene, ikke et sted et
// menneske skal lande. Uden denne rute ser man Express' raa "Cannot GET /".
// 302 og ikke 301: en permanent redirect caches i browseren for evigt, og saa
// kan rodruten aldrig faa et rigtigt indhold senere uden at gamle besoegende
// sidder fast. SIMPLY_BASE_URL genbruges (samme var som checkout bruger), med
// fallback saa ruten ikke sender folk til "undefined", hvis varen mangler.
app.get("/", (req, res) => {
  const maal = (process.env.SIMPLY_BASE_URL || "https://ditdigitalekontor.dk").replace(/\/+$/, "");
  res.redirect(302, maal);
});

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

// S23 LUKKET 1/10-26: /test-appsignal er fjernet.
// Ruten var et offentligt endpoint, der kastede en fejl paa kommando — enhver,
// der gaettede stien, kunne fylde loggen og AppSignal-kvoten uden at vaere
// logget ind. Den blev staaende, fordi den var den ENESTE maade at bevise, at
// fejl naaede frem til AppSignal.
//
// Den betingelse er opfyldt: rapporterFejl() i onboarding.js (S26) sender
// rigtige fejl fra rigtige fejlveje, bevist 1/10 med en Twilio-afvisning, der
// kom frem som haendelse #46 i staging. Et testendpoint, der beviser noget,
// produktionskoden allerede beviser, er kun en aaben doer.

// ─── AppSignal: robust fejlhåndterer — EFTER alle routes, FØR app.listen ─────
// Bruger sendError (egen rod-span), så route-fejl fanges uanset om Express 5
// endnu er instrumenteret. Skal ligge sidst i middleware-kæden.
app.use((err, req, res, next) => {
  sendError(err);
  next(err); // lad Express sende det normale fejl-svar
});

const PORT = process.env.PORT || 3000;

// ─── OPSTART ────────────────────────────────────────────────────────────────
// ÉN blok, der besvarer de spoergsmaal man faktisk stiller loggen efter et
// deploy: koerer den nye kode, og hvilket miljoe taler den med? Supabase-ref
// staar med, fordi de to projekter ser ens ud i dashboardet - det har kostet
// tid foer (10/7-26).
const supabaseRef = (process.env.SUPABASE_URL || "").split("//")[1]?.split(".")[0] || "ukendt";

const server = app.listen(PORT, () => {
  console.log(
    "\n  Dit Digitale Kontor" +
    `\n  Port:              ${PORT}` +
    `\n  Supabase-projekt:  ${supabaseRef}` +
    `\n  Tilbudsmodul:      ${TILBUD_AKTIV ? "TAENDT" : "SLUKKET"}\n`
  );
});

// ─── PAEN NEDLUKNING ────────────────────────────────────────────────────────
// Railway sender SIGTERM ved hvert deploy. Uden denne blok bliver processen
// bare skudt: npm melder "command failed / signal SIGTERM", og deploy-loggen
// fyldes med roede linjer, der ikke betyder noget. Vaerre - et opkald midt i
// et deploy bliver afbrudt paa halvvejen.
//
// Nu: stop med at tage imod nye forbindelser, lad igangvaerende gore sig
// faerdige, afslut med kode 0 (= "det gik godt", saa npm tier).
let lukkerNed = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (lukkerNed) return;   // Railway kan sende signalet flere gange
    lukkerNed = true;
    console.log(`Lukker ned (${signal}) - afventer igangvaerende foresporgsler...`);

    server.close(() => {
      console.log("Lukket paent.");
      process.exit(0);
    });

    // Sikkerhedsnet: en haengende forbindelse maa ikke blokere deployet.
    setTimeout(() => {
      console.warn("Tvunget luk efter 10 sek.");
      process.exit(0);
    }, 10000).unref();
  });
}
