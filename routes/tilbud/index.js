// routes/tilbud/index.js — tilbudsmodulets monteringspunkt.
//
// HVORFOR DEN ER TOM: server.js linje 110-113 kalder denne fil, når
// TILBUD_AKTIV er true. Findes filen ikke, crasher appen ved opstart — med
// vilje, og kun i staging, fordi prod står slukket. Denne udgave gør derfor
// præcis én ting: den lader flaget blive tændt, uden at der endnu findes en
// rute, der kan tage skade. Selve transskriptions-endpointet er opgave 4.
//
// SIGNATUREN ER BUNDET af kaldet i server.js:
//   require("./routes/tilbud")(app, supabase)
// Ændres den her, crasher opstarten — også det er den rigtige måde at fejle på.
//
// HVORFOR DER ER ÉN RUTE OG IKKE NUL: /health svarer allerede, om FLAGET er
// tændt (server.js linje 38). Den kan ikke svare, om routeren faktisk blev
// monteret — og en monteret rute, der alligevel giver 404, er den fejlmåde,
// der har ramt to gange før (onboarding-linket og checkout-knappen, se D23).
// Derfor udstiller modulet sin egen tilstand, så røgtesten kan SPØRGE i
// stedet for at gætte. Samme begrundelse som /health's egen kommentar.

"use strict";

// Ruterne samles her, så status-svaret ikke kan komme til at lyve om, hvad
// der findes. Tilføjes en rute nedenfor uden at stå på listen, er listen
// forkert — og det er listen, røgtesten tror på.
const RUTER = ["/api/tilbud/status"];

module.exports = function (app, supabase) {
  // supabase tages imod, fordi server.js sender den, og fordi opgave 3 og 4
  // får brug for den (ai_forbrug, kvoten). Den bruges bevidst ikke endnu.
  void supabase;

  // ─── Modulets eget sundhedstjek ──────────────────────────────────────────
  // Bevidst tom for logik, som /health: den skal kunne fejle NÅR modulet ikke
  // er monteret, ikke når noget andet er i vejen. Ingen database, ingen
  // leverandør, ingen nøgler — så et grønt svar her betyder én ting og kun
  // én: koden i denne fil kører.
  app.get("/api/tilbud/status", (req, res) =>
    res.status(200).json({
      ok: true,
      modul: "tilbud",
      ruter: RUTER,
      // Hvad der ENDNU IKKE findes. Står her, så en fremtidig læser kan se
      // forskel på "ikke bygget" og "gik i stykker".
      mangler: ["POST /api/tilbud/transskriber", "kvote"],
    })
  );
};
