// routes/tilbud/index.js — tilbudsmodulets ruter.
//
// Monteres fra server.js linje 110-113, kun når TILBUD_AKTIV er true.
// Signaturen er bundet af kaldet: require("./routes/tilbud")(app, supabase).
//
// RUTERNE HER er modulets egne. Kunder, opgaver og referater ligger i
// ./data.js og monteres nedenfor — den fil er stor nok til at staa alene, og
// denne er stor nok i forvejen.
//
// FIRE RUTER:
//   GET  /api/tilbud/status        modulets eget sundhedstjek
//   GET  /api/tilbud/kvote         hvad er der tilbage — SPØRGES FØR optagelsen
//   POST /api/tilbud/transskriber  lyd ind, tekst ud
//   POST /api/tilbud/referat       tekst ind, referat + markeringer ud
//
// LYD PERSISTERES ALDRIG. multer holder filerne i hukommelsen, de skrives
// ingen steder, og hverken lyd eller tekst logges (CLAUDE.md, Sikkerhed).
// Det samme gælder transskriptionen, der kommer ind i referat-ruten.
//
// TO RUTER, IKKE ÉN. Lyd → tekst → referat kunne have været ét kald, og det
// ville have været færre linjer. Men han skal kunne SE transskriptionen og
// rette i den, før referatet skrives — det er D14's fund fra 13/9: referatet
// retter nonsens i stilhed, men lader rigtige ord på forkert plads stå, og
// gør dem SVÆRERE at opdage, fordi resultatet læser pænt. Mellemtrinnet er
// hans eneste chance for at fange USB-plader, der skulle have været OSB.

"use strict";

const multer = require("multer");
const { sendError } = require("@appsignal/nodejs");
const { firmIdFromToken } = require("../../auth");
const asr = require("../../asr-adapter");
const tekstmodel = require("../../tekst-adapter");
const teknikB = require("../../teknik-b");
const kvote = require("../../kvote");

const RUTER = [
  "/api/tilbud/status",
  "/api/tilbud/kvote",
  "/api/tilbud/transskriber",
  "/api/tilbud/referat",
  "/api/indtaling/kvote",
  "/api/indtaling/transskriber",
];

// ─── Grænsen for ÉN transskription ind i referatet ───────────────────────────
// ⚠️ DEN BINDENDE GRÆNSE STÅR IKKE HER. `express.json()` i server.js linje 19
// er sat UDEN `limit` og bruger derfor Expressʼ standard på 100 KB. Den er
// global og kører længe før modulet monteres (linje 111), så en krop over
// 100 KB afvises med en HTML-fejlside, som en klient ikke kan læse — og uden
// at en eneste linje herunder er kørt. Fundet 3/10-26 i prøveplanens trin 4,
// hvor svaret var 413 med Expressʼ egen side i stedet for `for_meget_tekst`.
//
// Tallet herunder skal derfor ligge med god afstand UNDER de 100 KB, så vores
// egen læselige fejl altid når at fejle først. 60.000 tegn dansk fylder i
// UTF-8 omkring 70-75 KB med JSON-rammen omkring — også hvis teksten er tung
// på æ, ø og å, som fylder to bytes hver.
//
// Er 60.000 nok? Målt 3/10: 163 lydsekunder gav 2.253 tegn, altså ca. 14 tegn
// pr. sekund. 30 MB lyd ved den MÅLTE bitrate er ca. 31 minutter ≈ 26.000
// tegn. Grænsen er mere end det dobbelte af en realistisk lang diktering.
//
// ⚠️ KENDT HUL, bevidst efterladt. Lydruten regner sit værste tilfælde ud fra
// en konservativ bundgrænse på 3 KB/sek., og 30 MB bliver der til 175 minutter
// ≈ 145.000 tegn. Sker DET i virkeligheden — stærkt komprimeret lyd, meget
// langt møde — afvises transskriptionen her med `for_meget_tekst`, højlydt og
// med en besked, han kan handle på. **Først dér** er det signalet til at give
// `express.json()` en `limit`. Ikke før: grænsen på linje 19 gælder ALLE ruter,
// også Frisbii-webhooken og onboarding, og den hæves ikke for et tilfælde, vi
// aldrig har set (besluttet af Ann 3/10).
//
// Værste tilfælde i kroner (3 tegn pr. token er bevidst lavt sat for dansk, så
// token-tallet bliver for højt og ikke for lavt):
//   60.000 ÷ 3 = 20.000 tokens ind  ×  1.119 øre/mio.  =  22 øre
//   4.000 tokens ud (adapterens maksTokens)  ×  5.595 øre/mio.  =  22 øre
//   I alt ca. 45 øre — langt under kaldsloftet på 5 kr.
const MAKS_TEGN_IND = 60000;

// ─── Minimumslængden (Ann 16/10-26) ──────────────────────────────────────────
// Under 10 ord laves der intet referat: et fejltryk, et "øh" eller en
// optagelse uden ord koster ellers et kald og giver et ubrugeligt referat
// (`referat_ubrugeligt`, betalt). Afvises FØR kvoten, så det koster intet.
// Et ord er en klump uden mellemrum med mindst ét bogstav eller tal. SAMME
// regel står i tilbud/graenseflade.js, som spærrer knappen i forvejen — men
// det er her, den gælder.
const MIN_ORD_REFERAT = 10;
function antalOrd(tekst) {
  return String(tekst || "").split(/\s+/).filter((o) => /[\p{L}\p{N}]/u.test(o)).length;
}
const TEGN_PR_TOKEN = 3;
const MAKS_TOKENS_UD = 4000;

// ─── Grænserne for ét kald ───────────────────────────────────────────────────
// Kaldsloftet (AI_KALD_LOFT_DKK) kan kun holdes, hvis inputtet er begrænset.
// Derfor er tallene herunder ikke vilkårlige — de er REGNESTYKKET bag loftet.
//
//   30 MB, og en konservativ bundgrænse på 3 KB/sek. (24 kbit/s) giver højst
//   10.486 lydsekunder = 175 minutter = 3,92 kr hos Scaleway.
//   Under kaldsloftet på 5 kr, med en krone i margin.
//
//   Til sammenligning: den MÅLTE bitrate 28/9 var 17 KB/sek., så 30 MB er i
//   virkeligheden ca. 31 minutters lyd til 69 øre. Bundgrænsen er sat lavt
//   med vilje — den skal overvurdere prisen, aldrig undervurdere den.
//
// ⚠️ Prisen REGNES, den antages ikke. Skiftes modellen til en dyrere, stiger
// det beregnede værste tilfælde af sig selv, og kaldet afvises — højlydt — i
// stedet for i stilhed at koste mere. Det er hele grunden til, at adapteren
// leverer prisen som en enhed og ikke som en konstant.
//
// ÉN GRÆNSE, IKKE TO (hævet 30/9). Delen og totalen er samme tal, så reglen
// kan siges i én sætning: en diktering må fylde 30 MB, uanset hvordan den er
// delt. Den tidligere grænse på 10 MB pr. del afviste en RIGTIG optagelse på
// 10,5 MB under prøven — og det var ikke en fejl i optagelsen. Med
// fortsæt-knappen brydes en diktering, NÅR HÅNDVÆRKEREN BLIVER AFBRUDT, ikke
// når den bliver lang; en ubrudt gennemgang af et langt møde er normal.
//
// Prisen ved at hæve: multer holder filerne i hukommelsen, så én forespørgsel
// kan fylde 30 MB RAM, mens den behandles. Uden betydning ved pilotens omfang,
// værd at kende den dag der er mange samtidige brugere.
const MAX_DELE = 5;
const MAX_BYTES_PR_DEL = 30 * 1024 * 1024;
const MAX_BYTES_I_ALT = 30 * 1024 * 1024;
const LAVESTE_BYTES_PR_SEK = 3000;

// ─── 20 minutter pr. referat (Ann 13/10, servervaernet 16/10-26) ─────────────
// Optageren stopper selv ved 20 minutter, men `tilbud/` er offentlig, saa
// det er ikke et vaern. Her haandhaeves det.
//
// Laengden kan IKKE ses foer betaling: iPhonen sender mp4 i smaa stykker, og
// laengden staar normalt ikke i filens hoved. Den eneste praecise laengde er
// den, transskriberingen selv melder (`lydsekunder`) — det er ogsaa den, vi
// afregnes efter. Derfor laegges den sammen del for del, og overskrides
// graensen, stoppes der: ingen flere dele sendes, og ingen tekst gaar retur.
// Det, der allerede er transskriberet, ER betalt og bogfoeres som altid.
// Prisen for det er hoejst en del over graensen, og den er under kaldsloftet.
//
// Marginen (2 min, Ann 16/10) daekker forskellen paa optagerens vaegur og
// leverandoerens maaling, saa en rigtig optagelse fra fanen ALDRIG rammes:
// fanen stopper selv ved 20 min. Kun den, der gaar uden om fanen, ser beskeden.
// Kasserede dele kommer aldrig med til serveren og taeller derfor ikke.
const MAKS_LYDSEKUNDER = 20 * 60;
const MARGIN_LYDSEKUNDER = 120;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES_PR_DEL, files: MAX_DELE },
});

// Sandt/falsk, aldrig en fejl: status-ruten skal kunne svare, også når noget
// mangler. Beløb og nøglenavne kommer ALDRIG med i svaret.
function erKonfigureret(f) {
  try { f(); return true; } catch { return false; }
}

function værsteFaldOere(bytes) {
  return asr.prisOere(bytes / LAVESTE_BYTES_PR_SEK);
}

// Samme tanke som lydens: prisen REGNES af adapteren, så et modelskifte til
// noget dyrere får det beregnede værste tilfælde til at stige af sig selv.
// Tokens kan ikke kendes før kaldet, så de overvurderes med vilje.
function værsteFaldReferatOere(tegn) {
  return tekstmodel.prisOere(Math.ceil(tegn / TEGN_PR_TOKEN), MAKS_TOKENS_UD);
}

// Fejlkoder, der peger på den RIGTIGE mekanisme. Se den lange note ved
// transskriptionens catch: en kode, der peger forkert, koster mere tid end
// ingen kode (fundet 30/9).
const FORBEREDELSESKODER = {
  asr_konfiguration: "asr_ukonfigureret",
  referat_konfiguration: "referat_ukonfigureret",
  kvote_konfiguration: "kvote_ukonfigureret",
  kvote_laesning: "kvote_utilgaengelig",
};

module.exports = function (app, supabase) {
  // ─── MÅLING: LOGIN I FANEN (16/10-26, Ann bad om den) ──────────────────────
  // Målt 16/10: to "Lav referat" nåede først serveren 3 og 10 minutter efter
  // trykket, uden deploy imens. Mistanken er getSession() i fanen (en lås, den
  // deler med dashboardet). Fanen giver nu op efter 10 s og bruger det gemte
  // login — og sender med, hvor længe login tog (X-Login-Ms) og om omvejen
  // blev brugt (X-Login-Omvej: tidsgraense | fejl).
  //
  // Her skrives én linje, når det er værd at se: login over 2 s, eller
  // omvejen brugt. Kun metode, sti og tal — ingen token, ingen tekst, intet
  // firma. Søg i Railways log efter "login-maaling".
  //
  // FJERNES, når årsagen er afgjort. Det er en måling, ikke et værn.
  app.use("/api/tilbud", (req, res, next) => {
    try {
      const ms = parseInt(req.get("x-login-ms"), 10);
      const omvej = req.get("x-login-omvej");
      if (omvej || (Number.isFinite(ms) && ms > 2000)) {
        console.warn(`⚠️ login-maaling: ${req.method} ${req.baseUrl}${req.path} login ${Number.isFinite(ms) ? ms : "?"} ms` +
          (omvej ? ` · omvej (${String(omvej).slice(0, 20)})` : ""));
      }
    } catch (_) { /* en måling må aldrig vælte et kald */ }
    next();
  });

  // Datafunktionerne: kunder, opgaver, referater. Returnerer sine egne stier,
  // saa status-ruten kan vise dem uden at der er to lister at holde ens.
  const RUTER_I_ALT = RUTER.concat(require("./data")(app, supabase));

  // ─── Status ────────────────────────────────────────────────────────────────
  // Bevidst tom for logik, som /health: den skal kunne fejle NÅR modulet ikke
  // er monteret, ikke når noget andet er i vejen.
  app.get("/api/tilbud/status", (req, res) =>
    res.status(200).json({
      ok: true,
      modul: "tilbud",
      ruter: RUTER_I_ALT,
      mangler: ["fotovejen", "PWA-siden", "optageren flyttet ind"],
      // Samme tanke som kvote-feltet i /health: udstil TILSTANDEN, så den kan
      // spørges i stedet for gættes. Uden dette felt ligner en manglende
      // ASR-variabel et problem med kvoten (fundet 30/9).
      // ⚠️ LÆS DETTE FELT PRÆCIST (D71, 3/10-26). true betyder, at variablen
      // FINDES og har gyldig form — ikke at nøglen virker. En slettet eller
      // forkert nøgle står her som true og fejler først ved et rigtigt kald,
      // med 401 eller 403. Det er med vilje: status skal kunne svare uden at
      // bruge penge. Men den er IKKE et sundhedstjek, og må ikke læses som et.
      konfigureret: {
        asr: erKonfigureret(() => asr.prisenhed()),
        referat: erKonfigureret(() => tekstmodel.prisenhed()),
        kvote: erKonfigureret(() => kvote._hentLofter()),
      },
    })
  );

  // ─── Kvotestatus — spørges FØR han trykker optag ───────────────────────────
  // Besluttet 29/9: han skal have besked, INDEN han har talt i to et halvt
  // minut. En databaseforespørgsel er gratis; en tabt optagelse er ikke.
  //
  // INDTAL NY OPGAVE (Ann 16/10-26): samme kvote, men ruten findes to steder.
  // /api/tilbud/kvote er spærret med modulet `referat` (server.js), mens
  // /api/indtaling/kvote ikke kræver noget modul — "+ Ny opgave" har
  // mikrofonen for alle firmaer. Begge kræver login, og begge findes kun,
  // når TILBUD_AKTIV er tændt, fordi denne fil kun monteres da.
  const kvoteRute = async (req, res) => {
    const firmId = await firmIdFromToken(supabase, req);
    if (!firmId) return res.status(401).json({ error: "Ikke logget ind" });
    try {
      res.json(await kvote.status({ firmId }, supabase));
    } catch (e) {
      // Fail-closed: kan kvoten ikke læses, siges der ikke "alt er fint".
      sendError(e);
      res.status(503).json({
        error: "kvote_utilgaengelig",
        besked: "Vi kan ikke se dit forbrug lige nu. Prøv igen om lidt.",
      });
    }
  };
  app.get("/api/tilbud/kvote", kvoteRute);
  app.get("/api/indtaling/kvote", kvoteRute);

  // ─── Transskription ────────────────────────────────────────────────────────
  // ÉT kald med ALLE dele. Kvoten tælles på den samlede lydtid, ikke pr. del —
  // ellers kan en flerdelt diktering køre halvvejs og stoppe midt i.
  //
  // Delene transskriberes hver for sig og sættes sammen i den rækkefølge,
  // klienten sendte dem. Adapteren kender kun ÉN fil, med vilje
  // (docs/asr-adapter.md); sammensætningen hører til her.
  //
  // TO INDGANGE, ÉN RUTE (Indtal ny opgave, Ann 16/10-26). Referat-fanen og
  // "+ Ny opgave" transskriberer med samme værn: kvoten før kaldet, kaldsloftet,
  // 20 minutter + 2, ingen halv tekst. De adskiller sig kun i
  //   - FORMÅLET, der bogføres i ai_forbrug, så forbruget kan skilles ad
  //     (`opgave_transskription`, Ann 16/10 — kræver migrationen
  //     20261017070000_ai_forbrug_opgave_transskription.sql FØR denne kode)
  //   - de to beskeder, der nævner "referat"
  //   - modulspærren, som server.js sætter på /api/tilbud/transskriber og
  //     IKKE på /api/indtaling/transskriber (Ann 16/10: intet modul).
  //
  // ⚠️ RÆKKEFØLGEN MIGRATION → KODE ER IKKE PYNT. Mangler formålet i
  // CHECK-reglen ai_forbrug_formaal_gyldig, afviser databasen rækken, og
  // kvote.bogfoer() logger fejlen og lader svaret gå igennem (den må aldrig
  // vælte et betalt svar). Så transskriberes der gratis, og loftet virker ikke.
  const TRANSSKRIBERING = {
    tilbud: {
      formaal: "transskription",
      forMangeDele: `En diktering kan bestå af højst ${MAX_DELE} dele. Gem det, du har, og start et nyt referat.`,
      forLang: "Optagelsen er for lang til at blive lavet til tekst. Et referat kan højst være 20 minutter.",
    },
    opgave: {
      formaal: "opgave_transskription",
      forMangeDele: `En indtaling kan bestå af højst ${MAX_DELE} dele.`,
      forLang: "Optagelsen er for lang til at blive lavet til tekst. En indtaling kan højst være 20 minutter.",
    },
  };

  const transskriberRute = (indgang) => (req, res) => {
    upload.array("dele", MAX_DELE)(req, res, async (multerFejl) => {
      if (multerFejl) {
        const forStor = multerFejl.code === "LIMIT_FILE_SIZE";
        return res.status(413).json({
          error: forStor ? "del_for_stor" : "upload_afvist",
          // To koder, to beskeder: den ene handler om laengde, den anden om
          // antal dele. Kan de ikke skelnes i en log, kan symptomet ikke
          // slaas op i driftrunbookens Del 3b.
          besked: forStor
            ? "Optagelsen er for lang til at behandles i ét stykke. Stop og start forfra, eller kontakt os."
            : indgang.forMangeDele,
        });
      }

      const firmId = await firmIdFromToken(supabase, req);
      if (!firmId) return res.status(401).json({ error: "Ikke logget ind" });

      const dele = req.files || [];
      if (!dele.length) {
        return res.status(400).json({ error: "ingen_lyd", besked: "Der var ingen optagelse med." });
      }

      const bytesIAlt = dele.reduce((n, f) => n + f.size, 0);
      if (bytesIAlt > MAX_BYTES_I_ALT) {
        return res.status(413).json({
          error: "for_meget_lyd",
          besked: "Optagelsen er for lang til at behandles i ét stykke. Del den op.",
        });
      }

      // ── Kvoten, FØR der ringes ──────────────────────────────────────────
      let dom;
      try {
        // værsteFaldOere() spørger ASR-adapteren om prisenheden, så den kan
        // kaste en asr_konfiguration-fejl. Den ligger inde i samme try som
        // kvoten, fordi begge skal fejle lukket — men de må IKKE meldes ens.
        dom = await kvote.tjek({ firmId, maxPrisOere: værsteFaldOere(bytesIAlt) }, supabase);
      } catch (e) {
        // Fail-closed: vi gætter ikke på, at der er plads. Men fejlkoden skal
        // være ærlig.
        //
        // ⚠️ FUNDET 30/9: alle tre fejl blev meldt som "kvote_utilgaengelig".
        // Staging manglede TILBUD_ASR_* — altså en ASR-fejl — og svaret pegede
        // på kvoten. GET /api/tilbud/kvote svarede samtidig 200, fordi den
        // ikke rører adapteren, og så lignede det et lune i POST'en.
        // En fejlkode, der peger på den forkerte mekanisme, koster mere tid
        // end ingen fejlkode.
        const kode = FORBEREDELSESKODER[e.kode] || "kvote_utilgaengelig";
        console.error(`❌ kaldet kunne ikke forberedes [${kode}]:`, e.kode, e.message);
        sendError(e);
        return res.status(503).json({
          error: kode,
          // Brugeren får det samme at vide uanset hvad — han kan ikke gøre
          // noget ved nogen af delene, og hvilken variabel der mangler på
          // serveren, rager ham ikke.
          besked: "Vi kan ikke behandle optagelsen lige nu. Den er gemt her på telefonen — prøv igen om lidt.",
        });
      }

      if (!dom.tilladt) {
        // ⚠️ BREMSEN SKAL LARME. En kvoteafvisning er ikke en fejl i koden, men
        // den er en hændelse, du skal vide om FØR kunden ringer. Den koster en
        // linje i AppSignals fejlliste — det er prisen for at opdage, at en
        // kunde har været spærret i tre uger, uden at nogen så det.
        // Se driftrunbookens Del 3b, "Bremserne".
        const h = new Error(`Kvoteafvisning: ${dom.aarsag}`);
        h.name = "Kvoteafvisning";
        console.warn("⚠️ KVOTE afviste", { firmId, aarsag: dom.aarsag,
          forbrugtOere: dom.forbrugtOere, loftOere: dom.loftOere });
        sendError(h);
        return res.status(402).json({ error: dom.aarsag, besked: dom.besked,
          naesteNulstilling: dom.naesteNulstilling });
      }

      // ── Kaldene ─────────────────────────────────────────────────────────
      const svar = [];
      const tekster = [];          // holdes adskilt fra svar[], saa teksten aldrig
                                   // kan komme med i en log-linje ved et uheld
      let forbrugtFoer = dom.forbrugtOere;
      let prisIAlt = 0;

      for (let i = 0; i < dele.length; i++) {
        const fil = dele[i];
        let del;
        try {
          del = await asr.transskriber({
            lyd: fil.buffer,
            filnavn: fil.originalname || `del-${i + 1}.m4a`,
            sprog: "da",
          });
        } catch (e) {
          // Delen fejlede. Det, der ALLEREDE er betalt, er bogført nedenfor i
          // løkken — vi lader ikke et forbrug forsvinde, fordi en senere del
          // knækkede.
          //
          // Og vi returnerer IKKE en halv transskription. Et referat med et
          // manglende stykke, som ingen kan se mangler, er præcis den fejl,
          // hele D66-arbejdet handler om. Hellere en tydelig fejl og en
          // optagelse, der stadig ligger på telefonen.
          console.error(`❌ transskription fejlede paa del ${i + 1}/${dele.length}:`, e.kode, e.message);
          sendError(e);
          return res.status(502).json({
            error: "transskription_fejlede",
            del: i + 1, afDele: dele.length,
            besked: `Del ${i + 1} af ${dele.length} kunne ikke behandles. Din optagelse er gemt her på telefonen — prøv igen.`,
          });
        }

        const prisOere = asr.prisOere(del.lydsekunder);
        prisIAlt += prisOere;

        // Bogføres PR. KALD, fordi det er pr. kald, leverandøren afregner.
        await kvote.bogfoer({
          firmId, formaal: indgang.formaal,
          leverandoer: del.leverandoer, model: del.model,
          enhed: "lydsekund", maengde: del.lydsekunder, prisOere,
        }, supabase);

        // Varslet siges til ÉN gang — netop når grænsen krydses.
        if (kvote.krydsedeVarsel(forbrugtFoer, prisOere, dom.loftOere)) {
          const v = new Error(`Kvotevarsel: firmaet har passeret ${kvote.VARSEL_ANDEL * 100} % af sit maanedsloft`);
          v.name = "Kvotevarsel";
          console.warn("⚠️ KVOTE 80 %", { firmId, loftOere: dom.loftOere });
          sendError(v);
        }
        forbrugtFoer += prisOere;

        tekster.push(del.tekst);
        // Kun tal. Aldrig teksten — den er persondata.
        svar.push({ nr: i + 1, tegn: del.tekst.length, lydsekunder: del.lydsekunder });

        const lydIAlt = svar.reduce((n, d) => n + (d.lydsekunder || 0), 0);
        if (lydIAlt > MAKS_LYDSEKUNDER + MARGIN_LYDSEKUNDER) {
          const g = new Error(`Optagelsen over 20 min: ${Math.round(lydIAlt)} s efter del ${i + 1}/${dele.length}`);
          g.name = "Lydgraense";
          console.warn("⚠️ LYDGRAENSE", { firmId, formaal: indgang.formaal, lydsekunder: Math.round(lydIAlt), del: i + 1, afDele: dele.length });
          sendError(g);
          return res.status(413).json({
            error: "optagelse_for_lang",
            lydsekunder: Math.round(lydIAlt),
            besked: indgang.forLang,
          });
        }
      }

      // Delene sættes sammen i den rækkefølge, klienten sendte dem. Der er
      // bevidst ingen omsortering her: rækkefølgen er optagerens ansvar, og to
      // steder, der begge tror, de bestemmer den, er én for mange.
      const lydsekunderIAlt = svar.reduce((n, d) => n + (d.lydsekunder || 0), 0);

      res.json({
        ok: true,
        // Teksten gaar RETUR til hans egen browser og gemmes ikke her. Den
        // hoerer til i referater.transskript, naar han gemmer referatet -
        // ikke i denne rute, som ikke ved hvilken opgave det drejer sig om.
        tekst: tekster.join("\n\n"),
        dele: svar,
        lydsekunderIAlt,
        prisOere: Math.round(prisIAlt * 100) / 100,
        // Saa fanen kan sige det til ham med det samme, uden et kald mere.
        restOere: Math.max(0, dom.loftOere - forbrugtFoer),
      });
    });
  };
  app.post("/api/tilbud/transskriber", transskriberRute(TRANSSKRIBERING.tilbud));
  app.post("/api/indtaling/transskriber", transskriberRute(TRANSSKRIBERING.opgave));

  // ─── Referatet ─────────────────────────────────────────────────────────────
  // Tekst ind, referat ud — plus teknik B's markeringer, så han kan se HVAD
  // han skal kontrollere i stedet for at læse det hele igen.
  //
  // Transskriptionen kommer fra hans egen browser, muligvis rettet af ham
  // undervejs. Den gemmes ikke her, logges ikke, og sendes ikke videre nogen
  // steder end til modellen. Ruten ved ikke, hvilken opgave det drejer sig om;
  // det afgøres først, når han trykker gem.
  // Ingen parser her: `express.json()` i server.js linje 19 har allerede læst
  // kroppen, når vi når hertil. En parser mere ville være død kode, der ligner
  // en grænse — og det er værre end ingen grænse, fordi den næste ville tro,
  // tallet i den gjaldt.
  app.post("/api/tilbud/referat", async (req, res) => {
    const firmId = await firmIdFromToken(supabase, req);
    if (!firmId) return res.status(401).json({ error: "Ikke logget ind" });

    // Typekontrol, ikke en antagelse. Samme lærestreg som validatoren, der
    // væltede på `punkter` som streng: det, der kommer udefra, har ikke den
    // type, man håber.
    const tekst = typeof req.body?.transskription === "string" ? req.body.transskription : "";
    if (!tekst.trim()) {
      return res.status(400).json({
        error: "ingen_tekst",
        besked: "Der var ingen transskription med.",
      });
    }
    if (tekst.length > MAKS_TEGN_IND) {
      return res.status(413).json({
        error: "for_meget_tekst",
        besked: "Transskriptionen er for lang til ét referat. Del den op i to møder.",
      });
    }
    if (antalOrd(tekst) < MIN_ORD_REFERAT) {
      return res.status(400).json({
        error: "for_lidt_tekst",
        besked: "Teksten er for kort til et referat. Du kan gemme den, som den er.",
      });
    }

    // ── Kvoten, FØR der ringes ────────────────────────────────────────────
    let dom;
    try {
      dom = await kvote.tjek({ firmId, maxPrisOere: værsteFaldReferatOere(tekst.length) }, supabase);
    } catch (e) {
      const kode = FORBEREDELSESKODER[e.kode] || "kvote_utilgaengelig";
      console.error(`❌ referatet kunne ikke forberedes [${kode}]:`, e.kode, e.message);
      sendError(e);
      return res.status(503).json({
        error: kode,
        besked: "Vi kan ikke skrive referatet lige nu. Din tekst står stadig på skærmen — prøv igen om lidt.",
      });
    }

    if (!dom.tilladt) {
      // Bremsen skal larme — se noten ved transskriptionen.
      const h = new Error(`Kvoteafvisning (referat): ${dom.aarsag}`);
      h.name = "Kvoteafvisning";
      console.warn("⚠️ KVOTE afviste referat", { firmId, aarsag: dom.aarsag,
        forbrugtOere: dom.forbrugtOere, loftOere: dom.loftOere });
      sendError(h);
      return res.status(402).json({ error: dom.aarsag, besked: dom.besked,
        naesteNulstilling: dom.naesteNulstilling });
    }

    // ── Kaldet ────────────────────────────────────────────────────────────
    let r;
    try {
      r = await tekstmodel.referer({ tekst });
    } catch (e) {
      // ⚠️ ET FEJLET KALD KAN VÆRE BETALT — og så skal det bogføres.
      // Svarede leverandøren, er der brugt tokens, også når svaret var
      // ubrugeligt. Adapteren hænger prisen på fejlen netop i de tilfælde,
      // hvor den er kendt. Bærer fejlen ingen pris, blev der ikke svaret, og
      // så er der intet at bogføre — vi gætter aldrig i hovedbogen.
      //
      // Uden dette holder loftet ikke: en model, der begynder at fejle
      // formvalideringen, ville brænde kvoten usynligt. Fundet 3/10-26 i
      // prøveplanens trin 4, hvor 59.000 gange "a" gav 502 og kostede penge,
      // ingen kunne se.
      if (typeof e.prisOere === "number" && e.prisOere > 0) {
        try {
          await kvote.bogfoer({
            firmId, formaal: "referat",
            leverandoer: e.leverandoer, model: e.model,
            enhed: "token", maengde: (e.tokensInd || 0) + (e.tokensUd || 0),
            prisOere: e.prisOere,
          }, supabase);
        } catch (bogfoeringsfejl) {
          // Bogføringen må ikke overskygge den oprindelige fejl: han skal have
          // at vide, at referatet mislykkedes — ikke at databasen gjorde.
          console.error("❌ betalt men fejlet kald kunne ikke bogfoeres:", bogfoeringsfejl.message);
          sendError(bogfoeringsfejl);
        }
      }
      //
      // En formfejl er IKKE det samme som et nede-kald: formfejl betyder, at
      // modellen svarede noget, der ikke kan bruges, og det er en modelfejl,
      // vi skal se. De skilles ad, så AppSignal kan tælle dem hver for sig.
      const formfejl = e.kode === "referat_form";
      console.error(`❌ referatet fejlede [${e.kode}]:`, e.message);
      sendError(e);
      return res.status(502).json({
        error: formfejl ? "referat_ubrugeligt" : "referat_fejlede",
        besked: formfejl
          ? "Referatet kom tilbage i en form, vi ikke kunne bruge. Prøv igen — teksten står stadig på skærmen."
          : "Vi kunne ikke skrive referatet lige nu. Din tekst står stadig på skærmen — prøv igen.",
      });
    }

    // ── Bogføringen ───────────────────────────────────────────────────────
    // Tokens ind og ud afregnes til to forskellige takster, men hovedbogen
    // fører ÉN række pr. kald, fordi det er pr. kald, leverandøren afregner.
    // Prisen er adapterens egen beregning af de to takster — ikke en omregning
    // her, hvor den kunne komme til at sige noget andet end regningen.
    await kvote.bogfoer({
      firmId, formaal: "referat",
      leverandoer: r.leverandoer, model: r.model,
      enhed: "token", maengde: r.tokensInd + r.tokensUd, prisOere: r.prisOere,
    }, supabase);

    if (kvote.krydsedeVarsel(dom.forbrugtOere, r.prisOere, dom.loftOere)) {
      const v = new Error(`Kvotevarsel: firmaet har passeret ${kvote.VARSEL_ANDEL * 100} % af sit maanedsloft`);
      v.name = "Kvotevarsel";
      console.warn("⚠️ KVOTE 80 %", { firmId, loftOere: dom.loftOere });
      sendError(v);
    }

    // ── Værnet ────────────────────────────────────────────────────────────
    // Teknik B markerer tal, navne og forkortelser, der står i referatet, men
    // IKKE i transskriptionen. To ting på én gang:
    //   1. Han ser, hvad han skal kontrollere — ikke hele referatet, kun det,
    //      der kan være opfundet eller flyttet.
    //   2. Vi ser, om modellen er begyndt at rette i ordene igen. Stiger
    //      tætheden uden at prompten er ændret, er det prompten, der ikke
    //      længere følges (RESULTAT-06).
    //
    // Værnet må ALDRIG kunne vælte referatet. Et referat, der er skrevet og
    // betalt, skal ud til ham, også hvis markeringen fejler.
    let vaern = { markeringer: [], antalMarkeringer: null, taethed: null, ventil: false };
    try {
      vaern = teknikB.marker(tekst, r);
      if (vaern.ventil) {
        const t = new Error(`Teknik B: ventilen udloest ved ${vaern.taethed} % taethed`);
        t.name = "TeknikBVentil";
        console.warn("⚠️ TEKNIK B ventil", { firmId, taethed: vaern.taethed,
          antal: vaern.antalMarkeringer, promptVersion: r.promptVersion });
        sendError(t);
      }
    } catch (e) {
      console.error("❌ teknik B kunne ikke koere:", e.message);
      sendError(e);
    }

    res.json({
      ok: true,
      // Referatet gaar RETUR til hans egen browser. Det gemmes foerst, naar
      // han trykker gem — og det er en anden rute, som ved hvilken opgave.
      overskrift: r.overskrift,
      punkter: r.punkter,
      fritekst: r.fritekst,
      // Kun markeringerne, ikke hele teksten en gang til.
      markeringer: vaern.markeringer,
      taethed: vaern.taethed,
      // Ventilen (15/10-26, skive 2): over 10 % markeringer sendes INGEN
      // enkeltsteder — og uden dette felt kunne fanen ikke skelne "intet at
      // tjekke" fra "tjek det hele". Begge ville være en tom liste.
      ventil: !!vaern.ventil,
      besked: vaern.besked || null,
      prisOere: Math.round(r.prisOere * 100) / 100,
      restOere: Math.max(0, dom.loftOere - dom.forbrugtOere - r.prisOere),
      model: r.model,
      promptVersion: r.promptVersion,
      // Ophavet samlet ét sted (15/10-26, skive 2), saa klienten kan give det
      // videre til gemningen UDEN at naevne feltnavnene. S17-hooken afviser
      // ordet for modellens instruktion i alt under tilbud/ — ogsaa i et
      // feltnavn — og det er rigtigt, at den gør det.
      ophav: { model: r.model, version: r.promptVersion },
    });
  });
};
