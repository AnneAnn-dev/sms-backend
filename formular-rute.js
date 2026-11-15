// formular-rute.js -- POST /formular/:token: kundens udfyldte formular bliver
// til en opgave hos det firma, opkaldet gik til.
//
// Flyttet uaendret fra server.js 2/11-26 (D2, T3), saa ruten kan proeves uden
// at starte hele serveren: server.js laeser .env, opretter sin egen Supabase-
// klient og lytter ved indlaesning. Her gives klienten med udefra, ligesom i
// onboarding.js. Proeves af proev-formular-rute.js.
//
//   require("./formular-rute")(app, supabase);   // i server.js, foer /:slug/:token
"use strict";

const billeder = require("./billeder");
const { brugFormular, frigivFormular, linkBrugtSide, linkUdloebetSide, forMangeBillederSide } = require("./formular-engangs");
const { FORMULAR_ENGANGS_AKTIV, FORMULAR_UDLOEB_AKTIV } = require("./flags");
const { knytKunde } = require("./kundematch");
const { sendNytLeadPush } = require("./push");
const { bygAdresse, renTitel } = require("./opgave-felter");

module.exports = function registrerFormularRute(app, supabase) {

  // Firmaets navn og haandvaerkerens eget nummer til "linket er brugt"-siden.
  // Fejler opslaget, vises siden uden nummer — den maa aldrig blive tom.
  async function firmaTilBrugtSide(firmId) {
    try {
      const { data } = await supabase.from("firms").select("name, owner_phone").eq("id", firmId).maybeSingle();
      return { firmanavn: data?.name, telefon: data?.owner_phone };
    } catch (_) { return {}; }
  }

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
    const brug = await brugFormular(supabase, req.params.token,
      { aktiv: FORMULAR_ENGANGS_AKTIV, udloeb: FORMULAR_UDLOEB_AKTIV });
    if (brug.status === "ukendt") return res.status(404).send("Link ikke gyldigt");
    if (brug.status === "fejl") return res.status(500).send("Fejl");
    if (brug.status === "brugt") {
      return res.status(410).send(linkBrugtSide(await firmaTilBrugtSide(brug.call.firm_id)));
    }
    if (brug.status === "udloebet") {   // D97 — linket er IKKE taget i brug
      return res.status(410).send(linkUdloebetSide(await firmaTilBrugtSide(brug.call.firm_id)));
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
};
