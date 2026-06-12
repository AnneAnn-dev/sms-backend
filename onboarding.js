// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING — Shopify webhook + Twilio opkaldshandler
// Tilføj denne fil til dit projekt og require den i server.js:
//   require('./onboarding')(app, supabase);
//
// MIGRATION TIL SINCH: Når du er klar, skal du kun ændre:
//   1. /opkald — skift TwiML (XML) til Sinch JSON-format
//   2. sendSms — skift twilioClient.messages.create til Sinch SMS API
//   3. /onboarding/verificer — skift Twilio REST til Sinch Calling API
//   4. Miljøvariabler: TWILIO_* → SINCH_*
// ─────────────────────────────────────────────────────────────────────────────

const express    = require("express");
const crypto     = require("crypto");
const twilio     = require("twilio");
const { sendWelcomeMail } = require("./mail");
const { renderGreeting }  = require("./tts");
const { firmIdFromToken } = require("./auth");

module.exports = function registerOnboarding(app, supabase) {

  const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  // ─── HJÆLPER: Velkomstmail ligger nu i ./mail.js (delt med frisbii-webhook.js) ──

  // ─── HJÆLPER: Send SMS via Twilio ───────────────────────────────────────
  // MIGRATION: Erstat denne funktion med Sinch SMS API når du er klar
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

      // Find ledigt Twilio-nummer i puljen
      const { data: phoneRow, error: phoneErr } = await supabase
        .from("phone_numbers")
        .select("id, number")
        .is("firm_id", null)
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
        await sendWelcomeMail({
          to:          email,
          firmName:    company,
          loginUrl,
          phoneNumber: phoneRow.number,
        });
        console.log("✉️  Velkomstmail sendt til:", email);
      } catch (mailErr) {
        console.error("❌ Mail fejlede:", mailErr);
        // Firma er oprettet — mail kan sendes igen manuelt fra admin panel
      }

      console.log("✅ Firma oprettet:", firm.id, "—", company, "→", phoneRow.number);
      res.status(200).send("OK");
    }
  );

  // ─── 2. TWILIO OPKALDSHANDLER ────────────────────────────────────────────
  // Twilio kalder denne URL når en kunde ringer til et af jeres numre.
  // Sæt webhook URL i Twilio Console for hvert nummer:
  //   https://dinapp.railway.app/opkald  (HTTP POST)
  //
  // MIGRATION TIL SINCH: Skift TwiML-svaret til Sinch JSON-format:
  //   return res.json({ action: "Say", text: firm.greeting_text, locale: "da-DK", voice: "..." });
  app.post("/opkald", async (req, res) => {
    const fromNumber = req.body.From; // kundens nummer
    const toNumber   = req.body.To;   // håndværkerens Twilio-nummer

    console.log("📞 Opkald modtaget:", fromNumber, "→", toNumber);

    // Find firma baseret på Twilio-nummeret
    const { data: firm } = await supabase
      .from("firms")
      .select("id, name, voice_gender, greeting_text, greeting_audio_url, verification_status, status, billing_status")
      .eq("phone_number", toNumber)
      .single();

    if (!firm) {
      console.warn("⚠️  Intet firma fundet for nummer:", toNumber);
      return res.type("text/xml").send(`
        <Response><Hangup/></Response>
      `);
    }

    // Gem opkaldet
    const { data: call, error } = await supabase
      .from("calls")
      .insert({
        from_number: fromNumber,
        to_number:   toNumber,
        firm_id:     firm.id,
        raw_payload: req.body,
      })
      .select()
      .single();

    if (error) {
      console.error("❌ Supabase fejl:", error);
      return res.type("text/xml").send(`<Response><Hangup/></Response>`);
    }

    // Verifikationsopkald — from og to er samme nummer
    // Sæt firma til "active" og bekræft viderestilling
    if (fromNumber === toNumber || req.body.From === firm.phone_number) {
      await supabase
        .from("firms")
        .update({ verification_status: "verified", status: "active" })
        .eq("id", firm.id);

      console.log("✅ Viderestilling verificeret for firma:", firm.id);

      return res.type("text/xml").send(`
        <Response>
          <Say language="da-DK">
            Det virker! Din viderestilling er nu sat korrekt op.
            Du er klar til at modtage opgaver fra dine kunder.
          </Say>
        </Response>
      `);
    }

    // ─── GATE: kun betalende firmaer modtager leads ───────────────────────
    // Bemærk: vi gater KUN på billing_status, ikke på status. Hvis et opkald
    // overhovedet når frem til Twilio-nummeret, virker viderestillingen — så
    // selv et firma der stadig står som "onboarding" skal kunne fange leads.
    // Verifikationsopkaldet ovenfor er allerede håndteret og rammes ikke her.
    if (firm.billing_status && firm.billing_status !== "active") {
      console.log(`⏸️  Opkald til suspenderet firma (billing: ${firm.billing_status}):`, firm.id);
      return res.type("text/xml").send(`
        <Response>
          <Say language="da-DK" voice="Polly.Naja">
            Dette nummer er ikke aktivt i øjeblikket.
          </Say>
          <Hangup/>
        </Response>
      `);
    }

    // Normalt opkald fra kunde — send SMS og afspil besked
    sendSms({
      to:   fromNumber,
      from: toNumber,
      body: `Hej! Du har ringet til ${firm.name}. Udfyld din opgave her, så vender vi tilbage hurtigst muligt:\n${process.env.BASE_URL}/formular/${call.lead_token}`,
    }).catch(err => console.error("❌ SMS fejl:", err));

    // Afspil hilsen. Foretræk den renderede ElevenLabs-lydfil; falder tilbage
    // til live Polly-TTS hvis der ingen fil er (fx firma der ikke har gemt
    // stemmevalg endnu, eller en render der fejlede), så et opkald aldrig knækker.
    // MIGRATION TIL SINCH: <Play> → playFiles:[{url}], <Say> → say (uændret logik).
    if (firm.greeting_audio_url) {
      const audioUrl = firm.greeting_audio_url.replace(/&/g, "&amp;"); // XML-sikker
      return res.type("text/xml").send(`
        <Response>
          <Play>${audioUrl}</Play>
        </Response>
      `);
    }

    // Fallback: Polly.Naja = dansk kvindestemme, Polly.Mads = dansk mandestemme
    const voice = firm.voice_gender === "male" ? "Polly.Mads" : "Polly.Naja";

    return res.type("text/xml").send(`
      <Response>
        <Say language="da-DK" voice="${voice}">
          ${firm.greeting_text}
        </Say>
      </Response>
    `);
  });

  // ─── 3. VERIFIKATIONSOPKALD — system ringer til håndværker ──────────────
  // Kaldes fra onboarding-dashboardet når håndværkeren klikker "Test nu"
  // MIGRATION TIL SINCH: Skift twilioClient.calls.create til Sinch Calling API
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
      // Ring til håndværkerens PRIVATE mobilnummer
      // Hvis viderestilling er sat op, viderestilles opkaldet til Twilio-nummeret
      // og /opkald registrerer det og sætter firma til "active"
      await twilioClient.calls.create({
        to:   callTo,
        from: process.env.TWILIO_SYSTEM_NUMBER,
        url:  `${process.env.BASE_URL}/opkald-verificer-twiml`,
      });

      await supabase
        .from("firms")
        .update({ verification_status: "pending" })
        .eq("id", firm_id);

      res.json({ ok: true, message: "Testopkald afsendt" });

    } catch (err) {
      console.error("❌ Verifikationsopkald fejlede:", err.message);
      console.error("❌ Twilio fejl detaljer:", JSON.stringify(err));
      console.error("❌ Ring til:", callTo, "Fra:", firm.phone_number);
      res.status(500).json({ error: "Opkald fejlede", detail: err.message });
    }
  });

  // TwiML til verifikationsopkaldet (Twilio henter denne URL under opkaldet)
  app.get("/opkald-verificer-twiml", (req, res) => {
    res.type("text/xml").send(`
      <Response>
        <Say language="da-DK" voice="Polly.Naja">
          Dette er en automatisk test af din viderestilling.
          Det virker! Du kan nu modtage opgaver fra dine kunder.
        </Say>
      </Response>
    `);
  });


  // ─── API: Hent firmadata for indlogget bruger ────────────────────────────
  app.get('/api/mig', async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Ikke logget ind' });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Ugyldig session' });

    const { data: firmUser } = await supabase
      .from('firm_users')
      .select('firm_id')
      .eq('user_id', user.id)
      .single();

    if (!firmUser) return res.status(404).json({ error: 'Ingen firma fundet' });

    const { data: firm } = await supabase
      .from('firms')
      .select('id, name, phone_number, owner_phone, voice_gender, greeting_text, status, verification_status')
      .eq('id', firmUser.firm_id)
      .single();

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
        console.log("🔊 Hilsen renderet for firma:", firm_id);
      } catch (e) {
        console.error("❌ TTS-render fejlede (falder tilbage til live-TTS):", e.message);
      }
    }

    res.json({ ok: true });
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

  // ─── SEND SMS til en kundes lead (fra dashboardet) ──────────────────────────
  // Sikkerhed: udled firma fra token; bekraeft at lead'et tilhoerer firmaet; og
  // send KUN til nummeret paa det lead (aldrig et frit "to" fra body'en). Sender
  // fra firmaets eget Twilio-nummer.
  // MIGRATION TIL SINCH: erstat sendSms-implementeringen — denne rute er uaendret.
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