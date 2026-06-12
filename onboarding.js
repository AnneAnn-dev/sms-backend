// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING — Frisbii-baseret oprettelse + Sinch opkalds-/SMS-håndtering
// Tilføj denne fil til dit projekt og require den i server.js:
//   require('./onboarding')(app, supabase);
//
// Telefoni kører på Sinch via ./sinch.js (signatur, SMS, TTS-callout).
// Krævede env: SINCH_APP_KEY, SINCH_APP_SECRET, SINCH_SMS_SERVICE_PLAN,
//              SINCH_SMS_API_TOKEN, SINCH_SYSTEM_NUMBER
//
// BEMÆRK: Shopify-webhooken nedenfor er formentlig forældet (onboarding kører
// nu via frisbii-webhook.js). Slet den når du har bekræftet at intet bruger den.
// ─────────────────────────────────────────────────────────────────────────────

const express    = require("express");
const crypto     = require("crypto");
const sinch      = require("./sinch");
const { sendWelcomeMail } = require("./mail");
const { renderGreeting }  = require("./tts");
const { firmIdFromToken } = require("./auth");

module.exports = function registerOnboarding(app, supabase) {

  // ─── HJÆLPER: Velkomstmail ligger nu i ./mail.js (delt med frisbii-webhook.js) ──

  // ─── HJÆLPER: Send SMS via Sinch ────────────────────────────────────────
  // Uændret signatur, så /send-sms og /opkald kalder den som før.
  async function sendSms({ to, from, body }) {
    return sinch.sendSms({ to, from, body });
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

  // ─── 2. SINCH OPKALDSHANDLER (ICE) ───────────────────────────────────────
  // Sinch sender en Incoming Call Event (ICE) som POST hertil når en kunde
  // ringer til et af jeres numre. Vi svarer med et SVAML-objekt (JSON).
  // Sæt callback-URL'en i Sinch-dashboardet (Voice app → Callbacks):
  //   https://dinapp.railway.app/opkald
  // Den SKAL matche stien præcis, da den indgår i signaturen.
  //
  // express.raw kræves, fordi signaturvalideringen beregnes over rå body.
  // Læg denne rute FØR en evt. global express.json (som med Shopify-webhooken).
  app.post("/opkald", express.raw({ type: "*/*" }), async (req, res) => {
    // 1) Validér Sinch-signaturen før vi stoler på noget.
    if (!sinch.verifyVoiceSignature(req)) {
      console.warn("⚠️  Ugyldig Sinch-signatur på /opkald");
      return res.status(401).send("invalid signature");
    }

    const evt = JSON.parse(req.body.toString("utf8"));

    // Sinch sender ice/ace/dice til samme URL. Vi håndterer kun ice (indgående).
    // ace/dice/notify kvitteres bare med 200.
    if (evt.event !== "ice") {
      return res.status(200).send();
    }

    // I ICE er "to" et objekt {type, endpoint}; "from" er typisk en streng,
    // men kan også være et objekt. Vi håndterer begge. (⚠️ bekræft i test.)
    const toNumber   = evt.to && evt.to.endpoint;
    const fromNumber = typeof evt.from === "string"
      ? evt.from
      : (evt.from && evt.from.endpoint);

    console.log("📞 Opkald modtaget:", fromNumber, "→", toNumber);

    // Find firma baseret på Sinch-nummeret
    const { data: firm } = await supabase
      .from("firms")
      .select("id, name, voice_gender, greeting_text, greeting_audio_url, verification_status, status, billing_status, phone_number")
      .eq("phone_number", toNumber)
      .single();

    if (!firm) {
      console.warn("⚠️  Intet firma fundet for nummer:", toNumber);
      return res.json({ action: { name: "hangup" } });
    }

    // Gem opkaldet
    const { data: call, error } = await supabase
      .from("calls")
      .insert({
        from_number: fromNumber,
        to_number:   toNumber,
        firm_id:     firm.id,
        raw_payload: evt,
      })
      .select()
      .single();

    if (error) {
      console.error("❌ Supabase fejl:", error);
      return res.json({ action: { name: "hangup" } });
    }

    // Verifikationsopkald — from og to er samme nummer
    // Sæt firma til "active" og bekræft viderestilling
    if (fromNumber === toNumber || fromNumber === firm.phone_number) {
      await supabase
        .from("firms")
        .update({ verification_status: "verified", status: "active" })
        .eq("id", firm.id);

      console.log("✅ Viderestilling verificeret for firma:", firm.id);

      return res.json({
        instructions: [
          { name: "answer" },
          {
            name: "say",
            locale: "da-DK",
            text: "Det virker! Din viderestilling er nu sat korrekt op. Du er klar til at modtage opgaver fra dine kunder.",
          },
        ],
        action: { name: "hangup" },
      });
    }

    // ─── GATE: kun betalende firmaer modtager leads ───────────────────────
    // Bemærk: vi gater KUN på billing_status, ikke på status. Hvis et opkald
    // overhovedet når frem til Sinch-nummeret, virker viderestillingen — så
    // selv et firma der stadig står som "onboarding" skal kunne fange leads.
    // Verifikationsopkaldet ovenfor er allerede håndteret og rammes ikke her.
    if (firm.billing_status && firm.billing_status !== "active") {
      console.log(`⏸️  Opkald til suspenderet firma (billing: ${firm.billing_status}):`, firm.id);
      return res.json({
        instructions: [
          { name: "answer" },
          { name: "say", locale: "da-DK", text: "Dette nummer er ikke aktivt i øjeblikket." },
        ],
        action: { name: "hangup" },
      });
    }

    // Normalt opkald fra kunde — send SMS og afspil besked
    sendSms({
      to:   fromNumber,
      from: toNumber,
      body: `Hej! Du har ringet til ${firm.name}. Udfyld din opgave her, så vender vi tilbage hurtigst muligt:\n${process.env.BASE_URL}/formular/${call.lead_token}`,
    }).catch(err => console.error("❌ SMS fejl:", err));

    // Afspil hilsen. Foretræk den renderede ElevenLabs-lydfil; falder tilbage
    // til live-TTS hvis der ingen fil er (fx firma der ikke har gemt stemmevalg
    // endnu, eller en render der fejlede), så et opkald aldrig knækker.
    // <Play> → playFiles, <Say> → say.
    //
    // ⚠️ VOICEMAIL: action er "hangup" indtil storage-spørgsmålet til Sinch er
    //    afklaret (Scaleway vs. AWS S3 EU). Derefter skifter "hangup" til
    //    connectConf med recording mod bucket'en, så kunden kan indtale besked.
    if (firm.greeting_audio_url) {
      // ⚠️ bekræft i test om playFiles' "ids" accepterer en offentlig URL
      //    direkte, eller om filen skal pre-registreres hos Sinch.
      return res.json({
        instructions: [
          { name: "answer" },
          { name: "playFiles", ids: [firm.greeting_audio_url] },
        ],
        action: { name: "hangup" },
      });
    }

    // Fallback: indbygget dansk TTS (da-DK = Naja, da-DK/male = Mads, eller Sofie).
    const voiceText = firm.greeting_text;
    return res.json({
      instructions: [
        { name: "answer" },
        { name: "say", locale: "da-DK", text: voiceText },
      ],
      action: { name: "hangup" },
    });
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
      // Hvis viderestilling er sat op, viderestilles opkaldet til Sinch-nummeret
      // og /opkald registrerer det og sætter firma til "active".
      // Sinch har TTS-teksten inline i selve callouten — ingen separat URL.
      await sinch.makeTtsCallout({
        to:     callTo,
        from:   process.env.SINCH_SYSTEM_NUMBER,
        locale: "da-DK",
        text:   "Dette er en automatisk test af din viderestilling. Det virker! Du kan nu modtage opgaver fra dine kunder.",
      });

      await supabase
        .from("firms")
        .update({ verification_status: "pending" })
        .eq("id", firm_id);

      res.json({ ok: true, message: "Testopkald afsendt" });

    } catch (err) {
      console.error("❌ Verifikationsopkald fejlede:", err.message);
      console.error("❌ Ring til:", callTo, "Fra:", process.env.SINCH_SYSTEM_NUMBER);
      res.status(500).json({ error: "Opkald fejlede", detail: err.message });
    }
  });

  // (TwiML-ruten /opkald-verificer-twiml er fjernet — Sinch ttsCallout har
  //  beskeden inline, så der er ingen URL Sinch skal hente under opkaldet.)


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