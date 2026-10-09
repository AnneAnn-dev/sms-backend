// routes/tilbud/data.js — kunder, opgaver og referater.
//
// Monteres fra routes/tilbud/index.js, altsaa kun naar TILBUD_AKTIV er true.
//
//   GET    /api/tilbud/kunder            listen
//   POST   /api/tilbud/kunder            opret
//   PATCH  /api/tilbud/kunder/:id        ret
//
//   GET    /api/tilbud/opgaver           listen, med kundens navn
//   POST   /api/tilbud/opgaver           opret - UDEN opkald, se nedenfor
//   GET    /api/tilbud/opgaver/:id       én, med dens referater
//   PATCH  /api/tilbud/opgaver/:id       ret
//
//   POST   /api/tilbud/referater         gem et referat paa en opgave
//   GET    /api/tilbud/referater/:id     hent ét
//   PATCH  /api/tilbud/referater/:id     ret indhold/titel/status
//
// ─── EN OPGAVE OPRETTES UDEN OPKALD (besluttet 9/10-2026) ───────────────────
//
// `/opret-opgave` i server.js opretter en syntetisk `calls`-raekke med
// from_number: "Manuel oprettelse" for hver manuelt oprettet opgave. Det var
// den ENESTE maade at goere opgaven synlig, dengang alle RLS-politikker paa
// leads gik gennem call_id. Den sti blev lukket 7/10 med `leads_select_firma`.
//
// Vi gentager ikke omvejen, og grunden er ikke at holde `calls` ren - den er
// denne: `leads.call_id` kan kun holde ÉN vaerdi. Saa laenge opgavens identitet
// haenger paa ét opkald, er der ingen plads, naar kunden ringer igen om den
// samme opgave. Med `firm_id` som baerende noegle bliver `call_id` valgfri og
// historisk ("opgaven startede her"), og et opkald kan senere pege paa opgaven
// i stedet for omvendt.
//
// ⚠️ Konsekvens, der skal haandteres: dashboardets liste
// (static/dashboard.html, ~linje 1472) henter med `calls!inner` og ser derfor
// IKKE en opgave uden opkald. Den skal skifte til `.eq("firm_id", ...)` med et
// almindeligt join, FOER modulet oprettes opgaver i drift - ellers faar
// haandvaerkeren to lister med hver sin definition af sine egne opgaver.
//
// ─── PERSONDATA ─────────────────────────────────────────────────────────────
// Transskriptioner og referatindhold logges ALDRIG. Kun id'er og tal.

"use strict";

const { sendError } = require("@appsignal/nodejs");
const { firmIdFromToken } = require("../../auth");
const { medFirma, hentEgenRaekke, opdaterEgenRaekke } = require("../../ejerskab");

const RUTER = [
  "/api/tilbud/kunder",
  "/api/tilbud/opgaver",
  "/api/tilbud/referater",
];

// ─── Hvilke felter maa komme udefra ──────────────────────────────────────────
// Eksplicitte lister, aldrig `{...req.body}`. En spread tager det med, klienten
// sender - ogsaa `firm_id`, `id` og `created_at`. `medFirma` afviser et
// medsendt firm_id, men den kan kun afvise det, den faar at se; en spread
// ville sende alt det ANDET med uset.
const KUNDE_FELTER = [
  "navn", "telefon", "email", "noter", "adresse",
  "vejnavn", "husnr", "etage", "doer", "postnr", "by", "dawa_id",
  "cvr", "er_erhverv",
];
const OPGAVE_FELTER = [
  "name", "address", "task", "desired_time", "is_urgent",
  "notes", "address_mail", "kunde_id", "titel",
  "vejnavn", "husnr", "etage", "doer", "postnr", "by", "dawa_id",
];
const REFERAT_FELTER = [
  "titel", "moede_dato", "transskript", "ai_udkast", "indhold",
  "felter", "varighed_sek", "ai_model", "ai_prompt_version",
];
const REFERAT_RET_FELTER = ["titel", "indhold", "status", "felter"];

// Returnerer baade de kendte felter OG navnene paa dem, der blev sorteret fra.
// At sortere fra i stilhed er ikke sikkert - det er tavst.
function pluk(krop, tilladte) {
  const felter = {}, ukendte = [];
  for (const n of Object.keys(krop || {})) {
    if (tilladte.includes(n)) felter[n] = krop[n];
    else ukendte.push(n);
  }
  return { felter, ukendte };
}

// ⚠️ ET UKENDT FELT ER EN FEJL, IKKE NOGET MAN IGNORERER (fundet 10/10-2026).
//
// Hvidlisten beskytter mod, at klienten kan skrive i `firm_id` eller `id`. Men
// den, der SORTERER FRA uden at sige det, laver en ny fejlklasse:
//
//   {"indhol": "hans rettede version"}   -> 200 OK, intet gemt.
//
// En stavefejl i et feltnavn bliver til en rettelse, der forsvinder. Der er
// ingen fejl at laese, og han opdager det foerst, naar han aabner referatet
// igen. Det er samme form som D68 og D69: skrevet, kvitteret, og vaek.
//
// Det samme gaelder et felt, der findes men ikke maa rettes - `transskript`:
// sendt sammen med `indhold` ville indholdet blive gemt og kildeteksten tavst
// ignoreret, og kalderen ville tro, begge dele gik igennem.
//
// Returnerer true, naar der er svaret.
function afvisUkendte(res, ukendte, undtagen) {
  const u = ukendte.filter((n) => !(undtagen || []).includes(n));
  if (!u.length) return false;
  res.status(400).json({
    error: "ukendte_felter", felter: u,
    besked: `Felterne ${u.join(", ")} kendes ikke her. Et felt, der er stavet forkert, ` +
            `ville ellers blive sorteret fra i stilhed — og rettelsen ville være væk.`,
  });
  return true;
}

function tekst(v) {
  return typeof v === "string" ? v.trim() : "";
}

// ─── Fejl, der peger paa den rigtige mekanisme ───────────────────────────────
// Samme lektie som 30/9: en fejlkode, der peger forkert, koster mere tid end
// ingen fejlkode. Databasens egne koder oversaettes her, saa en dublet ikke
// ligner en nedbrudt server.
function svarPaaFejl(res, e, hvad) {
  // 23505 = unique_violation. Den eneste, vi venter os, er kunder.telefon pr.
  // firma (primeren, punkt 6) - den findes netop for at lukke dublet-spoegelset.
  if (e && e.code === "23505") {
    return res.status(409).json({
      error: "findes_allerede",
      besked: "Der findes allerede en kunde med det telefonnummer.",
    });
  }
  if (e && e.kode === "ejerskab_ikke_fundet") {
    // Findes ikke, eller er ikke dit. De to maa ikke kunne skelnes udefra -
    // ellers kan man taelle sig frem til, hvilke id'er andre firmaer har.
    return res.status(404).json({ error: "ikke_fundet", besked: "Den findes ikke." });
  }
  console.error(`❌ ${hvad}:`, e && (e.kode || e.code), e && e.message);
  sendError(e);
  return res.status(500).json({
    error: "serverfejl",
    besked: "Noget gik galt her hos os. Prøv igen om lidt.",
  });
}

module.exports = function (app, supabase) {
  // Henter firma-id eller svarer 401. Returnerer null, naar der er svaret.
  async function firma(req, res) {
    const firmId = await firmIdFromToken(supabase, req);
    if (!firmId) { res.status(401).json({ error: "Ikke logget ind" }); return null; }
    return firmId;
  }

  /* ─────────────────────────────────  KUNDER  ───────────────────────────── */

  app.get("/api/tilbud/kunder", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      const { data, error } = await supabase
        .from("kunder")
        .select("id, navn, telefon, email, adresse, postnr, by, er_erhverv, cvr, created_at")
        .eq("firm_id", firmId)
        .is("arkiveret_at", null)
        .order("navn");
      if (error) throw error;
      res.json({ ok: true, kunder: data || [] });
    } catch (e) { svarPaaFejl(res, e, "kunder kunne ikke hentes"); }
  });

  app.post("/api/tilbud/kunder", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;

    const { felter, ukendte } = pluk(req.body, KUNDE_FELTER);
    if (afvisUkendte(res, ukendte)) return;
    if (!tekst(felter.navn)) {
      return res.status(400).json({
        error: "navn_mangler",
        besked: "En kunde skal have et navn.",
      });
    }

    try {
      const { data, error } = await supabase
        .from("kunder")
        .insert(medFirma(firmId, felter))     // firm_id kan ikke glemmes her
        .select("id, navn, telefon")
        .single();
      if (error) throw error;
      res.status(201).json({ ok: true, kunde: data });
    } catch (e) { svarPaaFejl(res, e, "kunde kunne ikke oprettes"); }
  });

  app.patch("/api/tilbud/kunder/:id", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;

    const { felter: aendringer, ukendte } = pluk(req.body, KUNDE_FELTER);
    if (afvisUkendte(res, ukendte)) return;
    if (!Object.keys(aendringer).length) {
      return res.status(400).json({ error: "intet_at_rette", besked: "Der var ikke noget at rette." });
    }
    if ("navn" in aendringer && !tekst(aendringer.navn)) {
      return res.status(400).json({ error: "navn_mangler", besked: "En kunde skal have et navn." });
    }

    try {
      const kunde = await opdaterEgenRaekke(supabase, "kunder", req.params.id, firmId, aendringer);
      res.json({ ok: true, kunde });
    } catch (e) { svarPaaFejl(res, e, "kunde kunne ikke rettes"); }
  });

  /* ────────────────────────────────  OPGAVER  ───────────────────────────── */

  app.get("/api/tilbud/opgaver", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      // Et ALMINDELIGT join mod kunder - ikke `!inner`. En opgave uden kunde
      // skal med i listen; det er netop dem, der lige er oprettet.
      const { data, error } = await supabase
        .from("leads")
        .select("id, name, address, task, status, is_urgent, titel, created_at, kunde_id, kunder(navn)")
        .eq("firm_id", firmId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      res.json({ ok: true, opgaver: data || [] });
    } catch (e) { svarPaaFejl(res, e, "opgaver kunne ikke hentes"); }
  });

  app.post("/api/tilbud/opgaver", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;

    const { felter, ukendte } = pluk(req.body, OPGAVE_FELTER);
    if (afvisUkendte(res, ukendte)) return;
    // name, address og task er NOT NULL i skemaet. Afvis her med en besked, han
    // kan handle paa, i stedet for at lade databasen svare med sin egen.
    const mangler = ["name", "address", "task"].filter((f) => !tekst(felter[f]));
    if (mangler.length) {
      return res.status(400).json({
        error: "felter_mangler", mangler,
        besked: "En opgave skal have navn, adresse og en beskrivelse af arbejdet.",
      });
    }

    // Hoerer opgaven til en kunde, skal kunden vaere FIRMAETS. Uden dette kunne
    // et id fra en forespoergsel haenge opgaven paa et fremmed firmas kunde.
    if (felter.kunde_id) {
      try {
        await hentEgenRaekke(supabase, "kunder", felter.kunde_id, firmId, "id");
      } catch (e) { return svarPaaFejl(res, e, "ukendt kunde ved oprettelse"); }
    }

    try {
      const { data, error } = await supabase
        .from("leads")
        .insert(medFirma(firmId, {
          ...felter,
          status: "open",
          // Manuelt oprettede opgaver er aldrig "nye": han staar jo selv og
          // opretter den. Samme valg som /opret-opgave i server.js, saa badgen
          // og "Ny"-maerket betyder det samme i begge lister.
          seen_at: new Date().toISOString(),
          // call_id saettes IKKE. Se noten oeverst i filen.
        }))
        .select("id, name, address, task, status, created_at")
        .single();
      if (error) throw error;
      res.status(201).json({ ok: true, opgave: data });
    } catch (e) { svarPaaFejl(res, e, "opgave kunne ikke oprettes"); }
  });

  app.get("/api/tilbud/opgaver/:id", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      const opgave = await hentEgenRaekke(
        supabase, "leads", req.params.id, firmId,
        "id, name, address, task, status, is_urgent, titel, notes, desired_time, created_at, kunde_id, kunder(navn, telefon)"
      );

      // Referaterne i oversigtsform. INDHOLDET kommer ikke med i en liste -
      // det hentes pr. referat, saa en opgaveside ikke traekker al tekst med.
      const { data: referater, error } = await supabase
        .from("referater")
        .select("id, titel, moede_dato, status, kilde, varighed_sek, created_at")
        .eq("firm_id", firmId)
        .eq("lead_id", opgave.id)
        .order("moede_dato", { ascending: false });
      if (error) throw error;

      res.json({ ok: true, opgave, referater: referater || [] });
    } catch (e) { svarPaaFejl(res, e, "opgave kunne ikke hentes"); }
  });

  app.patch("/api/tilbud/opgaver/:id", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;

    const { felter: aendringer, ukendte } = pluk(req.body, OPGAVE_FELTER);
    if (afvisUkendte(res, ukendte)) return;
    if (!Object.keys(aendringer).length) {
      return res.status(400).json({ error: "intet_at_rette", besked: "Der var ikke noget at rette." });
    }
    for (const f of ["name", "address", "task"]) {
      if (f in aendringer && !tekst(aendringer[f])) {
        return res.status(400).json({
          error: "felt_tomt", felt: f,
          besked: "Navn, adresse og beskrivelse må ikke tømmes.",
        });
      }
    }
    // `status` er med vilje IKKE i OPGAVE_FELTER. Leads' statusvaerdier deles
    // med opkaldsflowet og dashboardet, og jeg kender ikke det fulde saet.
    // At lade modulet saette dem ville vaere at gaette paa en anden del af
    // produktet. Naar saettet er skrevet ned, kan feltet aabnes.

    if (aendringer.kunde_id) {
      try {
        await hentEgenRaekke(supabase, "kunder", aendringer.kunde_id, firmId, "id");
      } catch (e) { return svarPaaFejl(res, e, "ukendt kunde ved rettelse"); }
    }

    try {
      const opgave = await opdaterEgenRaekke(supabase, "leads", req.params.id, firmId, aendringer);
      res.json({ ok: true, opgave });
    } catch (e) { svarPaaFejl(res, e, "opgave kunne ikke rettes"); }
  });

  /* ───────────────────────────────  REFERATER  ──────────────────────────── */

  // Teknik B maales HER, server-side, paa (transskript, ai_udkast).
  //
  // Hvorfor ikke tage tallene fra klienten: de ville kunne vaere forael­dede
  // eller forkerte, og et tal, man gemmer i tredive referater for at kunne
  // stole paa det bagefter (D36 regel c), maa ikke kunne komme udefra.
  //
  // Hvorfor paa ai_udkast og ikke paa indhold: tallet er et maal for MODELLEN.
  // Retter haandvaerkeren selv et navn ind, er det hverken modellens
  // fortjeneste eller fejl.
  //
  // Feltopdelingen (overskrift/punkter/fritekst) findes ikke paa dette
  // tidspunkt - udkastet er gemt som tekst. Markeringernes `felt`-maerke gaar
  // dermed tabt, og det er fint: det bruges kun til visning, og visningen sker
  // i /api/tilbud/referat, hvor opdelingen stadig findes. Her gemmes kun tal.
  function maalTeknikB(transskript, udkast, titel) {
    if (!transskript || !udkast) return {};
    try {
      const teknikB = require("../../teknik-b");
      const v = teknikB.marker(transskript, {
        overskrift: titel || "",
        punkter: [],
        fritekst: udkast,
      });
      return {
        teknik_b_markeringer: v.antalMarkeringer,
        teknik_b_ord: v.ord != null ? v.ord : String(udkast).split(/\s+/).filter(Boolean).length,
      };
    } catch (e) {
      // Vaernet maa aldrig kunne forhindre, at et referat bliver gemt. Et
      // referat, han har skrevet og rettet, er vigtigere end et maaletal.
      console.error("❌ teknik B kunne ikke maales ved gemning:", e.message);
      sendError(e);
      return {};
    }
  }

  app.post("/api/tilbud/referater", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;

    const lead_id = tekst(req.body && req.body.lead_id);
    if (!lead_id) {
      return res.status(400).json({
        error: "opgave_mangler",
        besked: "Et referat skal høre til en opgave.",
      });
    }

    // lead_id staar i kroppen, men ikke i feltlisten - den haandteres for sig.
    const { felter, ukendte } = pluk(req.body, REFERAT_FELTER);
    if (afvisUkendte(res, ukendte, ["lead_id"])) return;
    if (!tekst(felter.ai_udkast) && !tekst(felter.indhold)) {
      return res.status(400).json({
        error: "tomt_referat",
        besked: "Der var hverken et udkast eller et referat at gemme.",
      });
    }

    try {
      // Opgaven skal vaere firmaets. Uden dette kunne et lead_id fra en
      // forespoergsel haenge et referat paa et fremmed firmas opgave - og
      // tokenet ville vaere aegte hele vejen.
      await hentEgenRaekke(supabase, "leads", lead_id, firmId, "id");

      const { data, error } = await supabase
        .from("referater")
        .insert(medFirma(firmId, {
          ...felter,
          lead_id,
          // kilde og status har defaults ('optagelse', 'kladde'). Kommer
          // referatet ad en anden vej, saetter den rute kilden selv.
          ...maalTeknikB(felter.transskript, felter.ai_udkast, felter.titel),
        }))
        .select("id, titel, moede_dato, status, teknik_b_markeringer, teknik_b_ord")
        .single();
      if (error) throw error;

      // Kun id'er og tal i loggen. Aldrig teksten.
      console.log(`✅ referat gemt: ${data.id} paa opgave ${lead_id}`);
      res.status(201).json({ ok: true, referat: data });
    } catch (e) { svarPaaFejl(res, e, "referat kunne ikke gemmes"); }
  });

  app.get("/api/tilbud/referater/:id", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      const referat = await hentEgenRaekke(supabase, "referater", req.params.id, firmId);
      res.json({ ok: true, referat });
    } catch (e) { svarPaaFejl(res, e, "referat kunne ikke hentes"); }
  });

  app.patch("/api/tilbud/referater/:id", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;

    const { felter: aendringer, ukendte } = pluk(req.body, REFERAT_RET_FELTER);
    if (afvisUkendte(res, ukendte)) return;
    if (!Object.keys(aendringer).length) {
      return res.status(400).json({ error: "intet_at_rette", besked: "Der var ikke noget at rette." });
    }
    if ("status" in aendringer && !["kladde", "faerdig"].includes(aendringer.status)) {
      // Samme saet som databasens check-constraint. Afvis her, saa fejlen er
      // laeselig i stedet for en Postgres-besked.
      return res.status(400).json({
        error: "ukendt_status",
        besked: "Et referat er enten en kladde eller færdigt.",
      });
    }
    // ⚠️ `transskript` og `ai_udkast` kan IKKE rettes. De er kildematerialet:
    // raateksten fra tale-til-tekst og modellens forslag, gemt uaendret saa de
    // kan sammenlignes med `indhold`. Kunne de rettes, ville sammenligningen
    // intet vaere vaerd - og teknik B-tallene ville maale noget andet end det,
    // modellen skrev. Migration 20260727065703 siger det selv.

    try {
      const referat = await opdaterEgenRaekke(supabase, "referater", req.params.id, firmId, aendringer);
      res.json({ ok: true, referat });
    } catch (e) { svarPaaFejl(res, e, "referat kunne ikke rettes"); }
  });

  return RUTER;
};
