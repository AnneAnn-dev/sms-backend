// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING — Frisbii-baseret oprettelse + Twilio opkalds-/SMS-håndtering
// Tilføj denne fil til dit projekt og require den i server.js:
//   require('./onboarding')(app, supabase);
//
// Telefoni kører på Twilio (twilioClient.messages / .calls + TwiML).
// Krævede env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SYSTEM_NUMBER
//
// BEMÆRK: Shopify-webhooken nedenfor er formentlig forældet (onboarding kører
// nu via frisbii-webhook.js). Slet den når du har bekræftet at intet bruger den.
// ─────────────────────────────────────────────────────────────────────────────

const express    = require("express");
const crypto     = require("crypto");
const twilio     = require("twilio");
const { sendWelcomeMail } = require("./mail");
const { renderGreeting }  = require("./tts");
const { firmIdFromToken } = require("./auth");
const { generateToken }   = require("./token");
const { normalizePhone }  = require("./phone");

module.exports = function registerOnboarding(app, supabase) {

  const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  // ─── Maskeret formular-domæne ───────────────────────────────────────────
  // Bygges fra appens eget BASE_URL (Railway custom domain, fx
  // https://opgave.ditdigitalekontor.dk) — IKKE hårdkodet, så et domæneskift
  // kun kræver at BASE_URL ændres ét sted. Trailing slash strippes defensivt,
  // så `${FORM_BASE}/${slug}/${token}` aldrig bliver til et dobbelt-slash-link.
  const FORM_BASE = (process.env.BASE_URL || "").replace(/\/$/, "");

  // ── Kunde-SMS-skabelonen (ét sted, saa demo og aegte ALTID er identiske) ──
  // HOLDES UNDER 160 GSM-TEGN inkl. link (laert 11/7-26: efter rebrandingen
  // blev domaenet 8 tegn laengere, alle kunde-SMS'er gled over 160 og blev
  // delt i 2 segmenter — MIDT i linket, saa modtagerens telefon kun gjorde
  // foerste halvdel klikbar -> "Cannot GET"). Budget: fast tekst+link-basen
  // koster ~114 tegn -> firmanavn + slug maa TILSAMMEN fylde maks. 46 tegn.
  // AEndres ordlyden: koer tegn-regnskabet igen (gsmSegments nedenfor vogter).
  function kundeSmsBody(firmName, url) {
    return `Du har ringet til ${firmName}. Beskriv din opgave her, så kontakter vi dig:\n${url}`;
  }

  // GSM 03.38-segmentvagt: taeller som telefonnettet goer (basis=1, udvidelse=2,
  // alt udenfor alfabetet tvinger UCS-2 hvor graensen er 70/67!). Logger hoejt
  // hvis en SMS ikke laengere er ett segment — saa opdages regression i loggen,
  // ikke hos kunden.
  const GSM_BASIS = new Set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà");
  const GSM_UDVIDELSE = new Set("^{}\\[~]|€");
  function gsmSegments(body) {
    let n = 0;
    for (const c of body) {
      if (GSM_BASIS.has(c)) n += 1;
      else if (GSM_UDVIDELSE.has(c)) n += 2;
      else return { segments: Math.ceil(body.length / 67), ucs2: true };
    }
    return { segments: n <= 160 ? 1 : Math.ceil(n / 153), ucs2: false, tegn: n };
  }
  function advarHvisFlereSegmenter(body, kontekst) {
    const r = gsmSegments(body);
    if (r.segments > 1 || r.ucs2) {
      console.warn(`⚠️  SMS (${kontekst}) fylder ${r.segments} segmenter${r.ucs2 ? " (UCS-2! ikke-GSM-tegn i teksten)" : ` (${r.tegn} GSM-tegn)`} — link risikerer at knaekke ved deling.`);
    }
    return body;
  }

  // ─── HJÆLPER: Velkomstmail ligger nu i ./mail.js (delt med frisbii-webhook.js) ──

  // ─── HJÆLPER: Send SMS via Twilio ───────────────────────────────────────
  // Uændret signatur, så /send-sms og /opkald kalder den som før.
  async function sendSms({ to, from, body }) {
    return twilioClient.messages.create({ to, from, body });
  }

  // ─── 1. SHOPIFY WEBHOOK — ny håndværker har købt abonnement ─────────────
  // Sæt denne URL i Shopify: Settings → Notifications → Webhooks
  // Event: "Order payment" — Format: JSON
  // URL: https://dinapp.railway.app/webhook/shopify
  app.post("/webhook/shopify", async (req, res) => {

      // Valider Shopify HMAC signatur
      const hmac   = req.headers["x-shopify-hmac-sha256"];
      const digest = crypto
        .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
        .update(req.body) // req.body er Buffer fra express.raw
        .digest("base64");

      const valid = hmac && digest === hmac;

      if (!valid) {
        console.warn("⚠️  Ugyldig Shopify webhook signatur");
        return res.status(401).send("Unauthorized");
      }

      const payload = JSON.parse(req.body.toString());
      console.log("🛒 Shopify webhook modtaget:", payload.id);

      // Træk relevante data ud
      const email          = payload.email?.toLowerCase().trim();
      const firstName      = payload.billing_address?.first_name || payload.customer?.first_name || "";
      const lastName       = payload.billing_address?.last_name  || payload.customer?.last_name  || "";
      const company        = payload.billing_address?.company    || `${firstName} ${lastName}`.trim();
      const shopifyOrderId = String(payload.id);

      if (!email) {
        console.error("❌ Ingen email i Shopify payload");
        return res.status(400).send("Mangler email");
      }

      // Undgå dubletter — tjek om ordren allerede er behandlet
      const { data: existing } = await supabase
        .from("firms")
        .select("id")
        .eq("shopify_order_id", shopifyOrderId)
        .maybeSingle();

      if (existing) {
        console.log("ℹ️  Ordre allerede behandlet:", shopifyOrderId);
        return res.status(200).send("OK");
      }

      // Find ledigt Twilio-nummer i puljen — spring numre i KARANTAENE over
      // (reserveret til evt. vundet-tilbage kunder, jf. frisbii-webhook.js)
      const { data: phoneRow, error: phoneErr } = await supabase
        .from("phone_numbers")
        .select("id, number")
        .is("firm_id", null)
        .or(`quarantined_until.is.null,quarantined_until.lt.${new Date().toISOString()}`)
        .limit(1)
        .single();

      if (phoneErr || !phoneRow) {
        console.error("❌ Ingen ledige numre i puljen!");
        // TODO: Send intern alarm (Slack, mail osv.) når puljen er ved at løbe tør
        return res.status(500).send("Ingen ledige numre");
      }

      // Opret firma i Supabase
      const { data: firm, error: firmErr } = await supabase
        .from("firms")
        .insert({
          name:                company,
          email,
          phone_number:        phoneRow.number,
          shopify_order_id:    shopifyOrderId,
          status:              "onboarding", // → "active" efter verifikation
          voice_gender:        "female",     // standard — kan ændres i dashboard
          greeting_text:       `Hej, du har ringet til ${company}. Jeg har ikke mulighed for at tage telefonen lige nu, men jeg sender dig en SMS, så du kan beskrive din opgave. Jeg vender tilbage hurtigst muligt.`,
          verification_status: "pending",
        })
        .select()
        .single();

      if (firmErr) {
        console.error("❌ Firma-oprettelse fejlede:", firmErr);
        return res.status(500).send("Fejl ved oprettelse af firma");
      }

      // Knyt nummeret til firmaet
      await supabase
        .from("phone_numbers")
        .update({ firm_id: firm.id })
        .eq("id", phoneRow.id);

      // Opret Supabase Auth-bruger
      const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { firm_id: firm.id, firm_name: company },
      });

      if (authErr) {
        console.error("❌ Auth-bruger fejlede:", authErr);
        // Firma er oprettet — log fejlen men fortsæt, retry manuelt om nødvendigt
      }

      // Gem bruger-firma kobling
      if (authUser?.user) {
        await supabase.from("firm_users").insert({
          firm_id: firm.id,
          user_id: authUser.user.id,
          role:    "owner",
        });
      }

      // Generer magic link til login
      const { data: linkData } = await supabase.auth.admin.generateLink({
        type:  "magiclink",
        email,
        options: { redirectTo: `${process.env.BASE_URL}/onboarding` },
      });

      const loginUrl = linkData?.properties?.action_link ||
                       `${process.env.BASE_URL}/dashboard`;

      // Send velkomstmail
      try {
        const mailResult = await sendWelcomeMail({
          to:          email,
          firmName:    company,
          loginUrl,
          phoneNumber: phoneRow.number,
        });
        if (mailResult?.blocked) {
          console.log("📧 Velkomstmail BLOKERET af staging-gaten (ikke sendt):", email);
        } else {
          console.log("✉️  Velkomstmail sendt til:", email);
        }
      } catch (mailErr) {
        console.error("❌ Mail fejlede:", mailErr);
        // Firma er oprettet — mail kan sendes igen manuelt fra admin panel
      }

      console.log("✅ Firma oprettet:", firm.id, "—", company, "→", phoneRow.number);
      res.status(200).send("OK");
    }
  );

  // ─── 2. TWILIO OPKALDSHANDLER ────────────────────────────────────────────
  // Twilio kalder denne URL (POST, form-encoded) når en kunde ringer til et af
  // jeres numre. Vi svarer med TwiML (XML). Sæt webhook-URL'en i Twilio Console
  // for hvert nummer (Phone Numbers → Configure → A call comes in):
  //   https://dinapp.railway.app/opkald
  // Ingen express.raw her — Twilio sender form-encoded, og global
  // express.urlencoded i server.js giver os req.body.From / .To direkte.
  app.post("/opkald", async (req, res) => {
    const toNumber   = req.body.To;    // firmaets Twilio-nummer
    const fromNumber = req.body.From;  // kundens nummer

    console.log("📞 Opkald modtaget:", fromNumber, "→", toNumber);

    const twiml = new twilio.twiml.VoiceResponse();

    // Find firma baseret på Twilio-nummeret
    const { data: firm } = await supabase
      .from("firms")
      .select("id, name, slug, voice_gender, greeting_text, greeting_audio_url, verification_status, status, billing_status, phone_number, owner_phone")
      .eq("phone_number", toNumber)
      .single();

    if (!firm) {
      console.warn("⚠️  Intet firma fundet for nummer:", toNumber);
      twiml.hangup();
      return res.type("text/xml").send(twiml.toString());
    }

    // Normalisér From én gang — bruges af både verifikation og hvidliste.
    const fromNorm = normalizePhone(fromNumber);

    // Verifikationsopkald: systemet ringer til håndværkerens owner_phone, som ved
    // ubesvaret viderestilles til Twilio-nummeret. Twilio ser da et indgående kald
    // med From = owner_phone (og To = firmaets Twilio-nummer). Vi matcher derfor på
    // owner_phone — med systemnummeret som sikkerhedsnet, hvis et teleselskab i
    // stedet præsenterer det oprindelige afsendernummer. Kører kun så længe firmaet
    // ikke allerede er verificeret, så håndværkerens senere opkald falder normalt.
    const ownerNorm  = normalizePhone(firm.owner_phone);
    const systemNorm = normalizePhone(process.env.TWILIO_SYSTEM_NUMBER);
    const erVerifikation =
      firm.verification_status !== "verified" &&
      fromNorm && (fromNorm === ownerNorm || fromNorm === systemNorm);

    // (Ingen call-række oprettes her — det sker først for ægte kundeopkald nedenfor.)
    if (erVerifikation) {
      await supabase
        .from("firms")
        .update({ verification_status: "verified", status: "active" })
        .eq("id", firm.id);

      console.log("✅ Viderestilling verificeret for firma:", firm.id);

      // Send håndværkeren en demo-SMS med et ÆGTE, virkende formular-link, så de
      // ser præcis hvad deres kunder modtager (og kan trykke på linket selv).
      // Best-effort: må aldrig blokere verifikationen, derfor try/catch + .catch.
      try {
        const demoToken = generateToken();
        await supabase.from("calls").insert({
          from_number: fromNumber,
          to_number:   toNumber,
          firm_id:     firm.id,
          lead_token:  demoToken,
          status:      "demo",   // markér som demo, så det ikke forveksles med ægte opkald
          raw_payload: req.body,
        });
        const demoUrl = `${FORM_BASE}/${firm.slug}/${demoToken}`;
        // Demo sendes som TO beskeder (11/7-26): en samlet besked oversteg 160
        // GSM-tegn og blev delt MIDT i linket. Nu: (1) kort forklaring,
        // (2) en NOEJAGTIG kopi af kunde-SMS'en (samme skabelon!) med intakt
        // link — haandvaerkeren ser praecis det, kunden ser.
        const demoModtager = firm.owner_phone || fromNumber;
        sendSms({
          to:   demoModtager,
          from: toNumber,
          body: `Sådan ser den SMS ud, dine kunder får, når de ringer, og du ikke svarer:`,
        }).catch(err => console.error("❌ Demo-SMS (forklaring) fejl:", err));
        sendSms({
          to:   demoModtager,
          from: toNumber,
          body: advarHvisFlereSegmenter(kundeSmsBody(firm.name, demoUrl), "demo"),
        }).catch(err => console.error("❌ Demo-SMS (kopi) fejl:", err));
        console.log("📨 Demo-SMS sendt til håndværker:", firm.owner_phone || fromNumber);
      } catch (e) {
        console.error("⚠️  Kunne ikke sende demo-SMS (verifikation fortsætter):", e.message);
      }

      twiml.say({ voice: "Polly.Naja", language: "da-DK" },
        "Det virker! Din viderestilling er nu sat korrekt op. Du er klar til at modtage opgaver fra dine kunder.");
      twiml.hangup();
      return res.type("text/xml").send(twiml.toString());
    }

    // ─── HVIDLISTE: numre der ikke skal have opgaveformular ───────────────
    // Håndværkeren kan registrere numre (familie, leverandører, sælgere, eget
    // andet nummer) der IKKE skal modtage SMS med opgaveformular. De får en kort
    // beroligende besked og lægges på — ingen call-række, intet lead, ingen SMS.
    if (fromNorm) {
      const { data: hit } = await supabase
        .from("firm_whitelist")
        .select("id")
        .eq("firm_id", firm.id)
        .eq("number", fromNorm)
        .maybeSingle();

      if (hit) {
        console.log("⚪ Hvidlistet nummer — springer opgaveformular over:", fromNorm, "→", firm.id);
        const voice = firm.voice_gender === "male" ? "Polly.Mads" : "Polly.Naja";
        twiml.say({ voice, language: "da-DK" },
          "Hej, jeg kan desværre ikke tage telefonen lige nu. Ring gerne igen senere.");
        twiml.hangup();
        return res.type("text/xml").send(twiml.toString());
      }
    }

    // ─── GATE: kun betalende firmaer modtager leads ───────────────────────
    // Gater KUN på billing_status, ikke på status — så selv et firma der stadig
    // står som "onboarding" kan fange leads, så længe abonnementet er aktivt.
    if (firm.billing_status && firm.billing_status !== "active") {
      console.log(`⏸️  Opkald til suspenderet firma (billing: ${firm.billing_status}):`, firm.id);
      twiml.say({ voice: "Polly.Naja", language: "da-DK" },
        "Dette nummer er ikke aktivt i øjeblikket.");
      twiml.hangup();
      return res.type("text/xml").send(twiml.toString());
    }

    // Ægte kundeopkald — opret nu call-rækken (med kort lead_token) og send SMS.
    const { data: call, error } = await supabase
      .from("calls")
      .insert({
        from_number: fromNumber,
        to_number:   toNumber,
        firm_id:     firm.id,
        lead_token:  generateToken(),   // app'en sætter token (punkt 7)
        raw_payload: req.body,
      })
      .select()
      .single();

    if (error) {
      console.error("❌ Supabase fejl:", error);
      twiml.hangup();
      return res.type("text/xml").send(twiml.toString());
    }

    // Normalt opkald fra kunde — send SMS med formular-link.
    // Format: ${BASE_URL}/{firma-slug}/{lead_token}  (maskeret opgave-subdomæne)
    const formUrl = `${FORM_BASE}/${firm.slug}/${call.lead_token}`;
    console.log("SMS link:", formUrl);

    sendSms({
      to:   fromNumber,
      from: toNumber,
      body: advarHvisFlereSegmenter(kundeSmsBody(firm.name, formUrl), "kunde"),
    }).catch(err => console.error("❌ SMS fejl:", err));
    
    // Afspil hilsen: foretræk den renderede ElevenLabs-lydfil; falder tilbage
    // til Polly (da-DK) hvis der ingen fil er, så et opkald aldrig knækker.
    if (firm.greeting_audio_url) {
      twiml.play(firm.greeting_audio_url);
    } else {
      const voice = firm.voice_gender === "male" ? "Polly.Mads" : "Polly.Naja";
      twiml.say({ voice, language: "da-DK" }, firm.greeting_text);
    }

    // FASE 2 (telefonsvarer): her kan twiml.record({...}) indsættes, så kunden
    // kan indtale en besked. Holdes ude indtil optagelses-storage (EU) er afklaret.
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  });

  // ─── 3. VERIFIKATIONSOPKALD — system ringer til håndværker ──────────────
  // Kaldes fra onboarding-dashboardet når håndværkeren klikker "Test nu"
  app.post("/onboarding/verificer", async (req, res) => {
    const firm_id = await firmIdFromToken(supabase, req);
    if (!firm_id) return res.status(401).json({ error: "Ikke logget ind" });

    const { owner_phone: bodyPhone } = req.body;

    const { data: firm } = await supabase
      .from("firms")
      .select("id, name, phone_number, owner_phone")
      .eq("id", firm_id)
      .single();

    if (!firm) return res.status(404).json({ error: "Firma ikke fundet" });

    // Brug owner_phone fra body hvis ikke gemt i DB endnu
    const callTo = firm.owner_phone || bodyPhone;
    if (!callTo) {
      return res.status(400).json({ error: "Mangler håndværkerens mobilnummer" });
    }

    try {
      // Ring til håndværkerens PRIVATE mobilnummer med en TTS-besked.
      // Hvis viderestilling er sat op, viderestilles opkaldet til Twilio-nummeret
      // og /opkald registrerer det og sætter firma til "active".
      // TTS-beskeden ligger inline i TwiML — ingen separat URL nødvendig.
      // Beskeden her høres KUN hvis håndværkeren TAGER telefonen — og i så fald
      // blev opkaldet ikke viderestillet, så verifikationen lykkedes ikke. Derfor
      // må den ikke sige "det virker"; den skal guide dem til at prøve igen uden
      // at svare. (Svarer de ikke, viderestilles opkaldet, og /opkald spiller den
      // rigtige "det virker"-besked og markerer firmaet verificeret.)
      await twilioClient.calls.create({
        to:    callTo,
        from:  process.env.TWILIO_SYSTEM_NUMBER,
        twiml: `<Response><Say voice="Polly.Naja" language="da-DK">Hej. Det her er en automatisk test fra Lomme Kontor. Du har taget telefonen, men for at teste din viderestilling skal du lade være med at svare. Læg på nu, gå tilbage til appen, og tryk Ring til mig igen. Lad så telefonen ringe uden at svare.</Say></Response>`,
      });

      await supabase
        .from("firms")
        .update({ verification_status: "pending" })
        .eq("id", firm_id);

      res.json({ ok: true, message: "Testopkald afsendt" });

    } catch (err) {
      console.error("❌ Verifikationsopkald fejlede:", err.message);
      console.error("❌ Ring til:", callTo, "Fra:", process.env.TWILIO_SYSTEM_NUMBER);
      res.status(500).json({ error: "Opkald fejlede", detail: err.message });
    }
  });

  // (Verifikationsopkaldet bruger inline TwiML i calls.create — ingen separat
  //  TwiML-URL nødvendig.)


  // ─── API: Hent firmadata for indlogget bruger ────────────────────────────
  app.get('/api/mig', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Ikke logget ind' });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Ugyldig session' });

    // Hent ALLE brugerens firma-koblinger — IKKE .single(), for den vælter, hvis
    // brugeren er koblet til mere end ét firma (sker fx ved gentagne testkørsler
    // på samme e-mail, eller hvis en rigtig kunde en dag får to firmaer).
    const { data: links } = await supabase
      .from('firm_users')
      .select('firm_id')
      .eq('user_id', user.id);

    if (!links || !links.length) return res.status(404).json({ error: 'Ingen firma fundet' });

    const firmIds = links.map((l) => l.firm_id);

    const { data: firms } = await supabase
      .from('firms')
      .select('id, name, phone_number, owner_phone, voice_gender, greeting_text, status, verification_status')
      .in('id', firmIds);

    // Vælg ét firma robust: foretræk det, der er under onboarding (det brugeren
    // er i gang med at sætte op); ellers tag det første. Vælter aldrig på flere.
    const firm = (firms || []).find((f) => f.status === 'onboarding') || (firms || [])[0] || null;

    if (!firm) return res.status(404).json({ error: 'Ingen firma fundet' });

    res.json({ firm });
  });

  // ─── API: Gem håndværkerens eget mobilnummer ────────────────────────────
  app.post('/api/firma/opdater-telefon', async (req, res) => {
    const firm_id = await firmIdFromToken(supabase, req);
    if (!firm_id) return res.status(401).json({ error: 'Ikke logget ind' });

    const { owner_phone } = req.body;
    if (!owner_phone) return res.status(400).json({ error: 'Mangler data' });

    const { error } = await supabase
      .from('firms')
      .update({ owner_phone })
      .eq('id', firm_id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // ─── API: Opdater stemme og besked ───────────────────────────────────────
  app.post('/api/firma/opdater', async (req, res) => {
    const firm_id = await firmIdFromToken(supabase, req);
    if (!firm_id) return res.status(401).json({ error: 'Ikke logget ind' });

    const { voice_gender, greeting_text } = req.body;

    const { error } = await supabase
      .from('firms')
      .update({ voice_gender, greeting_text })
      .eq('id', firm_id);

    if (error) return res.status(500).json({ error: error.message });

    // Render hilsenen til en ElevenLabs-lydfil og gem URL'en på firmaet.
    // Synkront, men i try/catch: fejler renderingen (fx ElevenLabs nede),
    // gemmer vi bare ingen URL — så falder /opkald tilbage til live-TTS, og
    // onboarding fortsætter uhindret. Hver gem re-renderer, så ny tekst/stemme
    // altid afspejles i lydfilen.
    let greeting_audio_url = null;
    if (voice_gender && greeting_text) {
      try {
        const { url } = await renderGreeting(supabase, {
          firmId:      firm_id,
          text:        greeting_text,
          voiceGender: voice_gender,
        });
        await supabase
          .from('firms')
          .update({ greeting_audio_url: url })
          .eq('id', firm_id);
        greeting_audio_url = url;
        console.log("🔊 Hilsen renderet for firma:", firm_id);
      } catch (e) {
        console.error("❌ TTS-render fejlede (falder tilbage til live-TTS):", e.message);
      }
    }

    res.json({ ok: true, greeting_audio_url });
  });

  // ─── API: Hent verifikationsstatus ───────────────────────────────────────
  app.get('/api/firma/status', async (req, res) => {
    const firm_id = await firmIdFromToken(supabase, req);
    if (!firm_id) return res.status(401).json({ error: 'Ikke logget ind' });

    const { data: firm } = await supabase
      .from('firms')
      .select('verification_status, status')
      .eq('id', firm_id)
      .single();

    res.json(firm);
  });

  // ─── HVIDLISTE: numre der ikke skal have opgaveformular ─────────────────────
  // Op til 20 numre pr. firma. Numre gemmes normaliseret (+45…) så matching i
  // /opkald altid er æbler-mod-æbler. Alle ruter auth'es via token → firm_id.
  const WHITELIST_MAX = 20;

  // Hent firmaets hvidliste
  app.get('/api/firma/hvidliste', async (req, res) => {
    const firm_id = await firmIdFromToken(supabase, req);
    if (!firm_id) return res.status(401).json({ error: 'Ikke logget ind' });

    const { data, error } = await supabase
      .from('firm_whitelist')
      .select('id, number, label, created_at')
      .eq('firm_id', firm_id)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ numbers: data || [], max: WHITELIST_MAX });
  });

  // Tilføj et nummer til hvidlisten
  app.post('/api/firma/hvidliste', async (req, res) => {
    const firm_id = await firmIdFromToken(supabase, req);
    if (!firm_id) return res.status(401).json({ error: 'Ikke logget ind' });

    const number = normalizePhone(req.body.number);
    if (!number) return res.status(400).json({ error: 'Ugyldigt telefonnummer' });
    const label = (req.body.label || '').toString().trim().slice(0, 60) || null;

    // Håndhæv 20-grænsen
    const { count } = await supabase
      .from('firm_whitelist')
      .select('*', { count: 'exact', head: true })
      .eq('firm_id', firm_id);
    if (typeof count === 'number' && count >= WHITELIST_MAX) {
      return res.status(409).json({ error: `Du kan højst have ${WHITELIST_MAX} numre på listen` });
    }

    const { data, error } = await supabase
      .from('firm_whitelist')
      .insert({ firm_id, number, label })
      .select('id, number, label, created_at')
      .single();

    // 23505 = unik-konflikt → nummeret er allerede på listen
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'Nummeret er allerede på listen' });
    }
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, number: data });
  });

  // Slet et nummer fra hvidlisten (kun firmaets egne rækker)
  app.delete('/api/firma/hvidliste/:id', async (req, res) => {
    const firm_id = await firmIdFromToken(supabase, req);
    if (!firm_id) return res.status(401).json({ error: 'Ikke logget ind' });

    const { error } = await supabase
      .from('firm_whitelist')
      .delete()
      .eq('id', req.params.id)
      .eq('firm_id', firm_id);   // bånd til firmaet → kan ikke slette andres rækker

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });
  // Sikkerhed: udled firma fra token; bekraeft at lead'et tilhoerer firmaet; og
  // send KUN til nummeret paa det lead (aldrig et frit "to" fra body'en). Sender
  // fra firmaets eget Twilio-nummer.
  // PROVIDER: sender via sendSms-hjælperen (Twilio). Ruten er provider-agnostisk.
  app.post("/send-sms", async (req, res) => {
    const firm_id = await firmIdFromToken(supabase, req);
    if (!firm_id) return res.status(401).json({ error: "Ikke logget ind" });

    const { body: smsText, lead_id } = req.body;
    if (!smsText || !smsText.trim()) return res.status(400).json({ error: "Tom besked" });
    if (!lead_id) return res.status(400).json({ error: "Mangler lead_id" });

    // Find lead'et og det opkald det hoerer til
    const { data: lead } = await supabase
      .from("leads")
      .select("id, call_id")
      .eq("id", lead_id)
      .single();
    if (!lead) return res.status(404).json({ error: "Lead findes ikke" });

    // Bekraeft ejerskab: opkaldet skal tilhoere DETTE firma
    const { data: call } = await supabase
      .from("calls")
      .select("firm_id, from_number")
      .eq("id", lead.call_id)
      .single();
    if (!call || call.firm_id !== firm_id) {
      return res.status(403).json({ error: "Lead tilhoerer ikke dit firma" });
    }

    // Modtager = kundens nummer paa lead'et (ikke et frit nummer fra body'en)
    const to = call.from_number;
    if (!to || to === "Manuel oprettelse") {
      return res.status(400).json({ error: "Dette lead har intet gyldigt telefonnummer" });
    }

    // Afsender = firmaets eget Twilio-nummer
    const { data: firm } = await supabase
      .from("firms")
      .select("phone_number")
      .eq("id", firm_id)
      .single();
    if (!firm?.phone_number) {
      return res.status(500).json({ error: "Firmaet har intet afsendernummer" });
    }

    try {
      await sendSms({ to, from: firm.phone_number, body: smsText });
      console.log("✉️  SMS sendt til lead", lead_id, "for firma", firm_id);
      res.json({ ok: true });
    } catch (err) {
      console.error("❌ SMS fejl:", err.message);
      res.status(500).json({ error: "Kunne ikke sende SMS" });
    }
  });

};