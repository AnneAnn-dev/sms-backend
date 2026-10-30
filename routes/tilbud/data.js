// routes/tilbud/data.js — kunder, opgaver og referater.
//
// Monteres fra routes/tilbud/index.js, altsaa kun naar TILBUD_AKTIV er true.
//
//   GET    /api/tilbud/kunder            listen (?inaktive=1: ogsaa de inaktive)
//   POST   /api/tilbud/kunder            opret
//   PATCH  /api/tilbud/kunder/:id        ret
//   POST   /api/tilbud/kunder/:id/inaktiv  inaktivér/aktivér (D94 trin 3a)
//   POST   /api/tilbud/kunde-opslag      hvilken af firmaets kunder har nummeret? (D94 3a)
//   GET    /api/tilbud/kunder/:id/slet-oversigt  hvad slettes, og er der en spaerring? (D94 3b)
//   POST   /api/tilbud/kunder/:id/slet   slet kunden og alt om hende (D94 3b, eget flag)
//
//   GET    /api/tilbud/opgaver           listen, med kundens navn
//   POST   /api/tilbud/opgaver           opret - UDEN opkald, se nedenfor
//   GET    /api/tilbud/opgaver/:id       én, med dens referater
//   PATCH  /api/tilbud/opgaver/:id       ret
//
//   POST   /api/tilbud/referater         gem et referat paa en opgave
//   GET    /api/tilbud/referater/:id     hent ét
//   PATCH  /api/tilbud/referater/:id     ret indhold/titel/status
//   POST   /api/tilbud/referater/:id/udkast   saet udkastet ÉN gang (skive 2)
//   POST   /api/tilbud/referater/:id/transskript  indtal mere / ret teksten,
//                                          kun FØR der er lavet et udkast (17/10)
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
const { kundeNoegle, gyldigtSmsNummer, normalizePhone, opgavensNummer } = require("../../phone");
const { SLET_KUNDE_AKTIV } = require("../../flags");
const { sletOpgaveBilleder } = require("../../billedoprydning");

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
// `telefon` er IKKE her (D88 trin 2, 20/10-26): kundens numre bor i
// `kunde_telefoner` og skrives kun gennem kundeNoegle() — se gemNummer()
// nedenfor. `kunder.telefon` bliver staaende som doed kolonne (expand/contract)
// og fjernes i en senere release; ingen kode skriver eller laeser den mere.
const KUNDE_FELTER = [
  "navn", "email", "noter", "adresse",
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

// Ophavet til et udkast (D14): { model, version } fra /api/tilbud/referat,
// givet videre af klienten. Klienten kan ikke skrive feltnavnene selv (S17,
// se routes/tilbud/index.js), derfor ét samlet felt, der oversaettes her.
// Kun strenge, og korte: det er ophav, ikke indhold.
function fraOphav(o) {
  const kort = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
  if (!o || typeof o !== "object") return {};
  const ud = {};
  if (kort(o.model)) ud.ai_model = kort(o.model);
  if (kort(o.version)) ud.ai_prompt_version = kort(o.version);
  return ud;
}

// ─── Fejl, der peger paa den rigtige mekanisme ───────────────────────────────
// Samme lektie som 30/9: en fejlkode, der peger forkert, koster mere tid end
// ingen fejlkode. Databasens egne koder oversaettes her, saa en dublet ikke
// ligner en nedbrudt server.
function svarPaaFejl(res, e, hvad) {
  // 23505 = unique_violation. Skelnes paa indeksnavnet (D88 betingelse): et
  // nummer, der allerede er en anden kundes (kunde_telefoner), er noget andet
  // end en ukendt dublet — og en ukendt dublet maa ikke ligne et telefonnummer.
  if (e && e.code === "23505") {
    const hvor = `${e.message || ""} ${e.details || ""}`;
    if (/kunde_telefoner_firma_telefon_unik|kunder_firma_telefon_unik/.test(hvor)) {
      return res.status(409).json({
        error: "nummer_findes",
        besked: "Telefonnummeret hører allerede til en anden kunde.",
      });
    }
    return res.status(409).json({ error: "findes_allerede", besked: "Den findes allerede." });
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

  // Kundens numre (D88): kunde_telefoner er eneste kilde. Svaret har stadig
  // `telefon` (det foerste nummer), saa klienterne ikke skal skifte form, og
  // `telefoner` (alle, aeldste foerst).
  // arkiveret_at (D94 trin 3a): "Inaktiv" i appen. Kun laesning her; den
  // skrives af POST /api/tilbud/kunder/:id/inaktiv og find_eller_opret_kunde().
  const KUNDE_KOLONNER =
    "id, navn, email, adresse, postnr, by, er_erhverv, cvr, created_at, arkiveret_at, kunde_telefoner(telefon, created_at)";
  function medNumre(k) {
    if (!k) return k;
    const { kunde_telefoner, ...resten } = k;
    const telefoner = (kunde_telefoner || [])
      .slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((r) => r.telefon);
    return { ...resten, telefon: telefoner[0] || null, telefoner };
  }

  // Laeser `telefon` fra kroppen. undefined = ikke med; null = ugyldigt.
  function nummerFraKrop(krop) {
    if (!krop || !("telefon" in krop)) return undefined;
    const v = krop.telefon;
    if (v == null || (typeof v === "string" && !v.trim())) return "";
    return kundeNoegle(v);
  }

  // Lægger et nummer paa en kunde. Hoerer nummeret til en ANDEN af firmaets
  // kunder, kastes 23505 med indeksnavnet, saa svarPaaFejl siger det rigtige.
  // Samme kunde = intet at goere. Kaldes kun med en noegle fra kundeNoegle().
  async function gemNummer(firmId, kundeId, noegle) {
    const { data: ejer, error } = await supabase
      .from("kunde_telefoner").select("kunde_id")
      .eq("firm_id", firmId).eq("telefon", noegle).maybeSingle();
    if (error) throw error;
    if (ejer && ejer.kunde_id === kundeId) return;
    if (ejer) {
      const f = new Error("kunde_telefoner_firma_telefon_unik"); f.code = "23505"; throw f;
    }
    const { error: iFejl } = await supabase
      .from("kunde_telefoner").insert({ firm_id: firmId, kunde_id: kundeId, telefon: noegle });
    if (iFejl) throw iFejl;   // 23505 her = en anden naaede foerst; samme svar
  }

  const ugyldigtNummer = (res) => res.status(400).json({
    error: "ugyldigt_nummer",
    besked: "Telefonnummeret kan ikke bruges. Skriv et dansk nummer med 8 cifre, eller et med landekode.",
  });

  app.get("/api/tilbud/kunder", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      // D94 trin 3a: ?inaktive=1 giver ogsaa de inaktive (arkiverede) — til
      // listen "Inaktive kunder" og til soegningen. Uden: som foer.
      let q = supabase
        .from("kunder")
        .select(KUNDE_KOLONNER)
        .eq("firm_id", firmId);
      if (req.query.inaktive !== "1") q = q.is("arkiveret_at", null);
      const { data, error } = await q.order("navn");
      if (error) throw error;
      res.json({ ok: true, kunder: (data || []).map(medNumre) });
    } catch (e) { svarPaaFejl(res, e, "kunder kunne ikke hentes"); }
  });

  app.post("/api/tilbud/kunder", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;

    const { felter, ukendte } = pluk(req.body, KUNDE_FELTER);
    if (afvisUkendte(res, ukendte, ["telefon"])) return;
    if (!tekst(felter.navn)) {
      return res.status(400).json({
        error: "navn_mangler",
        besked: "En kunde skal have et navn.",
      });
    }
    const noegle = nummerFraKrop(req.body);
    if (noegle === null) return ugyldigtNummer(res);

    try {
      // Nummeret tjekkes FOER kunden oprettes: hoerer det til en anden, maa
      // der ikke ligge en ny kunde tilbage uden.
      if (noegle) {
        const { data: ejer, error: tFejl } = await supabase
          .from("kunde_telefoner").select("kunde_id")
          .eq("firm_id", firmId).eq("telefon", noegle).maybeSingle();
        if (tFejl) throw tFejl;
        if (ejer) { const f = new Error("kunde_telefoner_firma_telefon_unik"); f.code = "23505"; throw f; }
      }
      const { data, error } = await supabase
        .from("kunder")
        .insert(medFirma(firmId, felter))     // firm_id kan ikke glemmes her
        .select("id, navn")
        .single();
      if (error) throw error;
      if (noegle) {
        try { await gemNummer(firmId, data.id, noegle); }
        catch (e) {
          // En anden naaede foerst med samme nummer: fjern den nye kunde igen,
          // saa der ikke ligger en halv kunde. Fejler det, larmer det.
          const { error: dFejl } = await supabase.from("kunder").delete().eq("id", data.id).eq("firm_id", firmId);
          if (dFejl) sendError(new Error(`kunde ${data.id} uden nummer efter 23505: ${dFejl.message}`));
          throw e;
        }
      }
      res.status(201).json({ ok: true, kunde: { ...data, telefon: noegle || null, telefoner: noegle ? [noegle] : [] } });
    } catch (e) { svarPaaFejl(res, e, "kunde kunne ikke oprettes"); }
  });

  // ─── Ret kunde (D88 opgave 2, 21/10-26) ──────────────────────────────────
  // Kundens stamdata — navn, numre, kundens adresse — rettes KUN her (Anne 21/10).
  //
  // Kroppen kan ud over KUNDE_FELTER have:
  //   telefon         nyt nummer, der laegges til (de gamle bliver)
  //   fjern_telefon   nummer, der fjernes fra kunden. Kun koblingen i
  //                   kunde_telefoner fjernes; opgavernes og opkaldenes
  //                   historik er uroert (Ann 21/10, sletteregel i gdpr.xlsx)
  //   opgaver_fra     nummer, hvis aabne opgaver skal skifte modtager. Udelades
  //                   det, bruges fjern_telefon
  //   opgaver_til     det nummer, de aabne opgaver skal sende til i stedet.
  //                   Skal vaere kundens (eller lagt til i samme kald) og
  //                   SMS-gyldigt (dansk)
  //   behold_opgaver  true = de aabne opgaver beholder det fjernede nummer
  //
  // VALG (i), Ann 21/10: retter man et nummer her, tager kundens AABNE opgaver
  // det med — synligt (svaret siger hvor mange), aldrig i stilhed (betingelse
  // 4). Fjernes et nummer, som aabne opgaver sender til, uden at kalderen har
  // sagt, hvad der skal ske med dem, svares 409 `nummer_bruges` med antallet,
  // og INTET skrives. Afsluttede opgaver beholder altid deres nummer.
  //
  // "Sender til" afgoeres af opgavensNummer() i phone.js — samme regel som
  // /send-sms. Et nummer flyttes aldrig fra en anden kunde (betingelse 5):
  // gemNummer() svarer 409 `nummer_findes`.
  //
  // Raekkefoelgen af skrivningerne er valgt, saa et afbrudt kald kan gentages:
  // (1) nyt nummer laegges til, (2) opgaverne skifter modtager, (3) det gamle
  // nummer fjernes, (4) stamdata. Afbrydes det efter (2), har opgaverne allerede
  // det nye nummer, og et nyt kald finder 0 at flytte og fjerner blot nummeret.
  const RET_EKSTRA = ["telefon", "fjern_telefon", "opgaver_fra", "opgaver_til", "behold_opgaver"];

  // Kundens AABNE opgaver med det, der skal til for at afgoere, hvilket nummer
  // de sender til (opgavensNummer() i phone.js). Bruges af "Ret kunde" og af
  // GET .../opgave-numre, saa de to aldrig er uenige om, hvad "sender til" er.
  async function aabneOpgaver(firmId, kundeId) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, telefon, calls(from_number)")
      .eq("firm_id", firmId)
      .eq("kunde_id", kundeId)
      .eq("status", "open");
    if (error) throw error;
    return (data || []).map((o) => ({
      id: o.id, telefon: o.telefon, opkald: o.calls && o.calls.from_number,
      nummer: opgavensNummer(o.telefon, o.calls && o.calls.from_number),
    }));
  }

  // ─── Hvilke numre bruger kundens aabne opgaver? (D88 opgave 2, 23/10-26) ──
  // Kun laesning. Til arket "Ret kunde": det viser ved hvert nummer, hvor
  // mange aabne opgaver der sender dertil, og spoerger, naar et nyt nummer
  // laegges til, om de skal bruge det (Ann 23/10). Et nummer, der ikke staar
  // paa kunden (fx rettet paa opgaven), kommer ogsaa med.
  //   200 { ok, numre: [{ nummer, antal, sms }] }   nummer null = intet nummer
  //   404 fremmed eller ukendt kunde
  // ─── Inaktivér / aktivér en kunde (D94 trin 3a, Ann 27–28/10) ───────────
  // Inaktiv = `arkiveret_at`. Kunden forsvinder fra kundelisten (ligger under
  // "Inaktive kunder"), men intet slettes: numre, opgaver og stamdata bliver.
  // Ringer kunden igen, aktiverer find_eller_opret_kunde() hende. Opgaver,
  // aabne som afsluttede, roeres ikke. Ejerskab via opdaterEgenRaekke: fremmed
  // og ukendt id svarer begge 404.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  app.post("/api/tilbud/kunder/:id/inaktiv", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    if (!UUID.test(String(req.params.id || ""))) return res.status(404).json({ error: "ikke_fundet", besked: "Den findes ikke." });
    const inaktiv = req.body && req.body.inaktiv;
    if (typeof inaktiv !== "boolean") {
      return res.status(400).json({ error: "ugyldigt_felt", felt: "inaktiv", besked: "inaktiv skal være true eller false." });
    }
    try {
      await opdaterEgenRaekke(supabase, "kunder", req.params.id, firmId,
        { arkiveret_at: inaktiv ? new Date().toISOString() : null });
      const kunde = medNumre(await hentEgenRaekke(supabase, "kunder", req.params.id, firmId, KUNDE_KOLONNER));
      res.json({ ok: true, kunde });
    } catch (e) { svarPaaFejl(res, e, "kunden kunne ikke inaktiveres/aktiveres"); }
  });

  // ─── Hvilken kunde har nummeret? (D94 trin 3a, advarslen i Ny opgave) ───
  // Nummeret i KROPPEN, aldrig i URL'en (adgangslogs). Normaliseres med
  // kundeNoegle() — samme noegle som alt andet (D88 betingelse 1) — og slaas
  // KUN op i tokenets firma. Et andet firmas nummer, et ukendt og et ugyldigt
  // nummer giver PRAECIS samme svar ({ kunde: null }), saa opslaget ikke kan
  // bruges til at finde navne paa tvaers af firmaer. Intet nummer i loggen.
  app.post("/api/tilbud/kunde-opslag", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    const noegle = kundeNoegle(req.body && req.body.telefon);
    if (!noegle) return res.json({ ok: true, kunde: null });
    try {
      const { data, error } = await supabase
        .from("kunde_telefoner")
        .select("kunde_id, kunder(id, navn, email, adresse, postnr, by, arkiveret_at)")
        .eq("firm_id", firmId)
        .eq("telefon", noegle)
        .maybeSingle();
      if (error) throw error;
      const k = data && data.kunder;
      if (!k) return res.json({ ok: true, kunde: null });
      res.json({ ok: true, kunde: {
        id: k.id, navn: k.navn || "", email: k.email || "", adresse: k.adresse || "",
        postnr: k.postnr || "", by: k.by || "", telefon: noegle, inaktiv: !!k.arkiveret_at,
      } });
    } catch (e) { svarPaaFejl(res, e, "kundeopslag fejlede"); }
  });

  // ─── Slet kunde (D94 trin 3b, plan godkendt af Ann 29/10-26) ─────────────
  // Bag eget flag SLET_KUNDE_AKTIV: slukket svarer begge ruter 404
  // `ikke_aktiv`, og Kunder-appen viser ikke knappen. Selve sletningen er ÉN
  // databasefunktion (slet_kunde, se migrationen 20261029100000) med laase og
  // spaerringer; her oversaettes dens fejl, og billedfilerne slettes BAGEFTER
  // (Storage er ikke i transaktionen). En fil, der ikke kunne slettes, logges
  // med opgave-id'et — kunden ER slettet, og ryd-forladte-billeder.js tager
  // resten. Ingen navne eller numre i loggen.
  const SPAERRINGER = {
    // Uden antal (409 ved sletning): flertal. Oversigten kender antallet, se aabenTekst().
    aaben_opgave: "Kunden har åbne opgaver. Afslut dem først — eller inaktivér kunden i stedet.",
    tilbud: "Kunden har et tilbud, og tilbud gemmes indtil videre. Du kan inaktivere kunden i stedet.",
    nyt_opkald: "Kunden har ringet inden for den sidste uge, og opgaven er ikke kommet endnu. Prøv igen senere — eller inaktivér kunden i stedet.",
    proev_igen: "Kunden blev ændret imens. Prøv igen.",
  };
  // Ann 30/10 i prod: "en åben opgave" stod paa en kunde med to.
  const aabenTekst = (n) => n === 1
    ? "Kunden har en åben opgave. Afslut den først — eller inaktivér kunden i stedet."
    : `Kunden har ${n} åbne opgaver. Afslut dem først — eller inaktivér kunden i stedet.`;
  const ikkeAktiv = (res) => res.status(404).json({ error: "ikke_aktiv", besked: "Slet kunde er ikke slået til." });
  const ikkeFundet = (res) => res.status(404).json({ error: "ikke_fundet", besked: "Den findes ikke." });

  app.get("/api/tilbud/kunder/:id/slet-oversigt", async (req, res) => {
    if (!SLET_KUNDE_AKTIV) return ikkeAktiv(res);
    const firmId = await firma(req, res); if (!firmId) return;
    if (!UUID.test(String(req.params.id || ""))) return ikkeFundet(res);
    try {
      const { data, error } = await supabase.rpc("slet_kunde_oversigt", { p_firm: firmId, p_kunde: req.params.id });
      if (error) throw error;
      const o = Array.isArray(data) ? data[0] : data;
      if (!o || !o.findes) return ikkeFundet(res);
      const spaerring = o.aabne > 0 ? "aaben_opgave" : o.tilbud > 0 ? "tilbud" : o.nye_opkald > 0 ? "nyt_opkald" : null;
      res.json({ ok: true,
        oversigt: { opgaver: o.opgaver, billeder: o.billeder, referater: o.referater, sms: o.sms, opkald: o.opkald, numre: o.numre },
        spaerring, besked: spaerring === "aaben_opgave" ? aabenTekst(o.aabne) : spaerring ? SPAERRINGER[spaerring] : null });
    } catch (e) { svarPaaFejl(res, e, "sletteoversigten kunne ikke hentes"); }
  });

  app.post("/api/tilbud/kunder/:id/slet", async (req, res) => {
    if (!SLET_KUNDE_AKTIV) return ikkeAktiv(res);
    const firmId = await firma(req, res); if (!firmId) return;
    if (!UUID.test(String(req.params.id || ""))) return ikkeFundet(res);
    // Kun et bevidst kald sletter: kroppen skal sige bekraeft: true.
    if (!req.body || req.body.bekraeft !== true) {
      return res.status(400).json({ error: "ikke_bekraeftet", besked: "Sletningen skal bekræftes." });
    }
    let r;
    try {
      const { data, error } = await supabase.rpc("slet_kunde", { p_firm: firmId, p_kunde: req.params.id });
      if (error) {
        const kode = String(error.message || "").trim();
        if (kode === "ikke_fundet") return ikkeFundet(res);
        if (SPAERRINGER[kode]) return res.status(409).json({ error: kode, besked: SPAERRINGER[kode] });
        throw error;
      }
      r = Array.isArray(data) ? data[0] : data;
      if (!r) throw new Error("slet_kunde svarede tomt");
    } catch (e) { return svarPaaFejl(res, e, "kunden kunne ikke slettes"); }

    const opgaveIder = r.opgave_ider || [];
    const billeder = await sletOpgaveBilleder(supabase, opgaveIder);
    console.log(`🗑️ Kunde slettet: firma ${firmId} kunde ${req.params.id} — opgaver ${r.opgaver}, billedraekker ${r.billeder}, ` +
      `billedfiler ${billeder.filer}, referater ${r.referater}, sms ${r.sms}, opkald ${r.opkald}, numre ${r.numre}`);
    for (const f of billeder.fejl) {
      console.error(`❌ Slet kunde: billedfiler for opgave ${f.opgaveId} blev ikke slettet: ${f.besked}`);
      sendError(new Error(`slet kunde: billedfiler for opgave ${f.opgaveId}: ${f.besked}`));
    }
    res.json({ ok: true, slettet: { opgaver: r.opgaver, billeder: billeder.filer, referater: r.referater,
      sms: r.sms, opkald: r.opkald, numre: r.numre }, billeder_fejl: billeder.fejl.length });
  });

  app.get("/api/tilbud/kunder/:id/opgave-numre", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      await hentEgenRaekke(supabase, "kunder", req.params.id, firmId, "id");
      const taelling = new Map();
      for (const o of await aabneOpgaver(firmId, req.params.id)) {
        taelling.set(o.nummer, (taelling.get(o.nummer) || 0) + 1);
      }
      const numre = Array.from(taelling, ([nummer, antal]) => ({ nummer, antal, sms: !!gyldigtSmsNummer(nummer) }))
        .sort((a, b) => b.antal - a.antal || String(a.nummer).localeCompare(String(b.nummer)));
      res.json({ ok: true, numre });
    } catch (e) { svarPaaFejl(res, e, "opgavernes numre kunne ikke hentes"); }
  });

  app.patch("/api/tilbud/kunder/:id", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    const krop = req.body || {};

    const { felter: aendringer, ukendte } = pluk(krop, KUNDE_FELTER);
    if (afvisUkendte(res, ukendte, RET_EKSTRA)) return;

    const noegle = nummerFraKrop(krop);
    if (noegle === null) return ugyldigtNummer(res);
    // Et tomt `telefon` fjerner IKKE et nummer — dertil er `fjern_telefon`.
    // Et tomt felt maa ikke kunne ligne, at nummeret er vaek.
    if (noegle === "") {
      return res.status(400).json({
        error: "nummer_kan_ikke_fjernes",
        besked: "Et telefonnummer fjernes med fjern_telefon, ikke med et tomt felt.",
      });
    }
    const valgfrit = (navn) => {
      if (!(navn in krop)) return undefined;
      const v = kundeNoegle(krop[navn]);
      return v || null;
    };
    const fjern = valgfrit("fjern_telefon");
    const fra   = valgfrit("opgaver_fra");
    if (fjern === null || fra === null) return ugyldigtNummer(res);
    let til;
    if ("opgaver_til" in krop) {
      til = gyldigtSmsNummer(krop.opgaver_til);
      if (!til) {
        return res.status(400).json({
          error: "ikke_sms_nummer",
          besked: "Opgaverne kan kun sende SMS til et dansk nummer med 8 cifre.",
        });
      }
    }
    const behold = krop.behold_opgaver === true;
    if ("behold_opgaver" in krop && typeof krop.behold_opgaver !== "boolean") {
      return res.status(400).json({ error: "ugyldigt_felt", felt: "behold_opgaver", besked: "behold_opgaver skal være true eller false." });
    }

    const opgaverFra = fra || fjern;
    if (fjern && fra && fra !== fjern) {
      return res.status(400).json({ error: "modstridende_numre", besked: "opgaver_fra skal være det nummer, der fjernes." });
    }
    if (til && !opgaverFra) {
      return res.status(400).json({ error: "mangler_opgaver_fra", besked: "Sig hvilket nummer opgaverne skal skifte fra." });
    }
    if (fra && !til) {
      return res.status(400).json({ error: "mangler_opgaver_til", besked: "Sig hvilket nummer opgaverne skal skifte til." });
    }
    if (til && behold) {
      return res.status(400).json({ error: "modstridende_valg", besked: "Vælg enten at flytte opgaverne eller at lade dem beholde nummeret." });
    }
    if (fjern && (fjern === noegle || fjern === til)) {
      return res.status(400).json({ error: "modstridende_numre", besked: "Samme nummer kan ikke både fjernes og bruges." });
    }
    if (!Object.keys(aendringer).length && !noegle && !fjern && !til) {
      return res.status(400).json({ error: "intet_at_rette", besked: "Der var ikke noget at rette." });
    }
    if ("navn" in aendringer && !tekst(aendringer.navn)) {
      return res.status(400).json({ error: "navn_mangler", besked: "En kunde skal have et navn." });
    }

    try {
      // Ejerskabet foerst — ogsaa naar kun et nummer aendres. 404 for fremmed.
      const foer = medNumre(await hentEgenRaekke(supabase, "kunder", req.params.id, firmId, KUNDE_KOLONNER));

      if (fjern && !foer.telefoner.includes(fjern)) {
        return res.status(404).json({ error: "nummer_ikke_fundet", besked: "Nummeret står ikke på denne kunde." });
      }
      if (til && til !== noegle && !foer.telefoner.includes(til)) {
        return res.status(400).json({ error: "ikke_kundens_nummer", besked: "Opgaverne kan kun skifte til et af kundens egne numre." });
      }

      // Kundens AABNE opgaver, der sender til `opgaverFra` lige nu.
      let ramte = [];
      if (opgaverFra) {
        ramte = (await aabneOpgaver(firmId, req.params.id)).filter((o) => o.nummer === opgaverFra);
      }
      if (fjern && ramte.length && !til && !behold) {
        return res.status(409).json({
          error: "nummer_bruges",
          opgaver: ramte.length,
          besked: ramte.length === 1
            ? "1 åben opgave sender SMS til dette nummer. Vælg hvilket nummer den skal bruge, eller lad den beholde det."
            : `${ramte.length} åbne opgaver sender SMS til dette nummer. Vælg hvilket nummer de skal bruge, eller lad dem beholde det.`,
        });
      }

      // (1) Nyt nummer. 409 nummer_findes, hvis det er en anden kundes.
      if (noegle) await gemNummer(firmId, req.params.id, noegle);

      // (2) Opgaverne skifter modtager. Er det nye nummer opgavens eget
      // opkaldsnummer, gemmes null — samme konvention som /lead-telefon.
      let flyttet = 0;
      if (til && ramte.length) {
        const somOpkald = [], somIndtastet = [];
        for (const o of ramte) {
          (o.opkald && normalizePhone(o.opkald) === til ? somOpkald : somIndtastet).push(o.id);
        }
        for (const [ids, vaerdi] of [[somOpkald, null], [somIndtastet, til]]) {
          if (!ids.length) continue;
          const { data: opd, error: uFejl } = await supabase
            .from("leads").update({ telefon: vaerdi })
            .in("id", ids).eq("firm_id", firmId).eq("kunde_id", req.params.id).eq("status", "open")
            .select("id");
          if (uFejl) throw uFejl;
          flyttet += (opd || []).length;
        }
      }

      // (3) Det gamle nummer fjernes — kun koblingen.
      if (fjern) {
        const { error: dFejl } = await supabase
          .from("kunde_telefoner").delete()
          .eq("firm_id", firmId).eq("kunde_id", req.params.id).eq("telefon", fjern);
        if (dFejl) throw dFejl;
      }

      // (4) Stamdata.
      if (Object.keys(aendringer).length) {
        await opdaterEgenRaekke(supabase, "kunder", req.params.id, firmId, aendringer);
      }
      const kunde = medNumre(await hentEgenRaekke(supabase, "kunder", req.params.id, firmId, KUNDE_KOLONNER));
      res.json({ ok: true, kunde, opgaver_flyttet: flyttet, opgaver_beholdt: til ? 0 : ramte.length });
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
        // startet_at (D94 trin 2): kundesiden tegner samme streger som
        // dashboardets Opgaver-fane — blaa = ny, til der er gjort noget.
        .select("id, name, address, task, status, is_urgent, titel, created_at, startet_at, kunde_id, kunder(navn)")
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
        "id, name, address, task, status, is_urgent, titel, notes, desired_time, created_at, kunde_id, kunder(navn, kunde_telefoner(telefon, created_at))"
      );
      // Samme form som foer: kunder.telefon er kundens foerste nummer (D88).
      if (opgave.kunder) {
        const { navn, telefon, telefoner } = medNumre(opgave.kunder);
        opgave.kunder = { navn, telefon, telefoner };
      }

      // Referaterne i oversigtsform. INDHOLDET kommer ikke med i en liste -
      // det hentes pr. referat, saa en opgaveside ikke traekker al tekst med.
      //
      // `har_referat` (15/10-26, skive 3): listen skal kunne sige "Indtalt
      // tekst" eller "Referat" (Anns fund: fire ens "Noter 15/10 · Kladde",
      // der ikke kunne skelnes). Teksterne laeses her, men kun for at blive
      // til ét ja/nej — de forlader ikke serveren.
      const { data: raekker, error } = await supabase
        .from("referater")
        .select("id, titel, moede_dato, status, kilde, varighed_sek, created_at, ai_udkast, indhold")
        .eq("firm_id", firmId)
        .eq("lead_id", opgave.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const referater = (raekker || []).map(({ ai_udkast, indhold, ...r }) => ({
        ...r,
        har_referat: !!(tekst(ai_udkast) || tekst(indhold)),
      }));

      res.json({ ok: true, opgave, referater });
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
  // FELTOPDELINGEN GENSKABES (15/10-26, skive 2). Udkastet gemmes som tekst i
  // et fast format (referat-format.js): overskrift, punkter med "- ",
  // fritekst. tilFelter() laeser det tilbage, saa teknik B maales paa SAMME
  // felter som i /api/tilbud/referat — ogsaa navnereglen, der er slaaet fra i
  // overskriften. Foer 15/10 blev hele udkastet maalt som én fritekst, og saa
  // ville overskriftens store bogstaver taelle som mulige navne.
  //
  // `teknik_b_ord` er teknik B's EGET ordtal (antalOrd). Foer 15/10 laeste
  // koden et felt, der ikke findes (`v.ord`), og faldt altid tilbage til en
  // optaelling af hele teksten — med "-"-tegn og overskrift.
  function maalTeknikB(transskript, udkast) {
    if (!transskript || !udkast) return {};
    try {
      const teknikB = require("../../teknik-b");
      const { tilFelter } = require("../../referat-format");
      const v = teknikB.marker(transskript, tilFelter(udkast));
      return {
        teknik_b_markeringer: v.antalMarkeringer,
        teknik_b_ord: v.antalOrd,
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
    if (afvisUkendte(res, ukendte, ["lead_id", "ophav"])) return;
    // Ophavet gaelder kun et udkast. Uden udkast er der intet ophav at gemme.
    const ophav = tekst(felter.ai_udkast) ? fraOphav(req.body && req.body.ophav) : {};
    // EN KLADDE MED KUN TRANSSKRIPTIONEN ER ET REFERAT (besluttet af Ann
    // 15/10-26, Fase 2 punkt F, skive 1). Han kan staa paa pladsen, indtale,
    // rette teksten og gemme - og lade udkastet vente, eller aldrig bede om
    // det. Indtil 15/10 krævede ruten ai_udkast eller indhold, og saa var
    // hans diktering vaek, hvis han ikke ville have et udkast med det samme.
    //
    // Et udkast kan komme paa kladden BAGEFTER, én gang: se
    // POST /api/tilbud/referater/:id/udkast nedenfor (skive 2, 15/10).
    // At rette en kladde fra fanen er stadig ikke bygget (PATCH kan titel,
    // indhold og status — det er skaermen, der mangler).
    if (!tekst(felter.transskript) && !tekst(felter.ai_udkast) && !tekst(felter.indhold)) {
      return res.status(400).json({
        error: "tomt_referat",
        besked: "Der var hverken en transskription, et udkast eller et referat at gemme.",
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
          ...ophav,
          lead_id,
          // kilde og status har defaults ('optagelse', 'kladde'). Kommer
          // referatet ad en anden vej, saetter den rute kilden selv.
          ...maalTeknikB(felter.transskript, felter.ai_udkast),
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
    // den tekst, modellen fik, og modellens forslag, gemt uaendret saa de kan
    // sammenlignes med `indhold`. Kunne de rettes, ville sammenligningen intet
    // vaere vaerd - og teknik B-tallene ville maale noget andet end det,
    // modellen skrev. Migration 20260727065703 siger det selv.
    //
    // HVAD `transskript` ER (besluttet af Ann 15/10-26): hans RETTEDE tekst -
    // den, han godkendte i fanen, foer han gemte. Ikke tale-til-tekstens raa
    // svar. Grunden: det er den tekst, /api/tilbud/referat sender til
    // modellen, og teknik B skal maale modellen mod det, den faktisk fik.
    // Retter han "USB-plader" til "OSB-plader", er det ikke modellens fortjeneste.
    //
    // MULIG FORBEDRING (ikke besluttet): gem OGSAA den raa tekst i et eget
    // felt. Saa kan vi se, hvor ofte og hvor meget han retter - et maal for
    // tale-til-tekst, ikke for referatmodellen. Kraever en migration.

    // ─── LAASEN (besluttet af Ann 15/10-26, skive 3) ─────────────────────────
    // "Kladde" = kan stadig rettes. "Faerdig" = laast. Et faerdigt referat kan
    // IKKE rettes, heller ikke tilbage til kladde — ikke fra fanen og ikke fra
    // en anden klient. Laasen staar HER og ikke kun i fanen; ellers er den pynt.
    //
    // Filteret `status = 'kladde'` sidder i SAMME opdatering (som udkastets
    // `IS NULL`), saa en skaerm, der markerer faerdig, og en anden, der retter
    // samtidig, ikke kan krydse hinanden: den sidste faar 409.
    let raekke;
    try {
      raekke = await hentEgenRaekke(supabase, "referater", req.params.id, firmId, "id, status");
    } catch (e) { return svarPaaFejl(res, e, "referat kunne ikke hentes til rettelse"); }
    if (raekke.status === "faerdig") return afvisFaerdigt(res);

    try {
      const { data, error } = await supabase
        .from("referater")
        .update(aendringer)
        .eq("id", raekke.id)
        .eq("firm_id", firmId)
        .eq("status", "kladde")
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) return afvisFaerdigt(res);   // blev faerdigt imens
      res.json({ ok: true, referat: data });
    } catch (e) { svarPaaFejl(res, e, "referat kunne ikke rettes"); }
  });

  function afvisFaerdigt(res) {
    return res.status(409).json({
      error: "referat_faerdigt",
      besked: "Referatet er markeret som færdigt og kan ikke rettes. Genindlæs, så ser du det.",
    });
  }

  // ─── UDKASTET PAA EN GEMT KLADDE — ÉN GANG (besluttet af Ann 15/10-26) ─────
  //
  // Han kan indtale paa pladsen, gemme kladden og lave referatet paa kontoret.
  // Saa skal `ai_udkast` kunne komme paa en raekke, der allerede findes. Men
  // feltet er kildemateriale (se PATCH ovenfor): det maa saettes, ikke rettes.
  //
  // Derfor sin egen rute og ikke et felt i PATCH:
  //   - Den kan KUN saette udkastet, naar det er tomt. Opdateringen filtrerer
  //     paa `ai_udkast IS NULL` i SAMME kald, saa to skaerme, der begge trykker
  //     "Lav referat", ikke kan overskrive hinanden: den ene faar 200, den
  //     anden 409. Et tjek foer opdateringen alene ville ikke vaere nok — der
  //     er tid mellem tjek og skrivning.
  //   - Teknik B maales her, paa raekkens egen `transskript` — ikke paa en
  //     tekst fra klienten (samme grund som ved oprettelse: tallet skal kunne
  //     stoles paa).
  //   - `indhold` (hans rettede version) kan komme med i samme kald. Er det
  //     tomt, er udkastet hans version, uaendret (Ann 15/10: "der vil vaere
  //     situationer, hvor der ikke bliver rettet i udkastet").
  //
  // `ophav` ({ model, version }) kommer fra klienten, som fik det af
  // /api/tilbud/referat, og bliver til `ai_model` og `ai_prompt_version`. Det
  // er ophav (D14), ikke maaletal; at klienten kunne lyve om det, flytter
  // ingen penge og ingen fremmed data.
  //
  // Firmafilteret er en del af opdateringen (`.eq("firm_id", ...)`), som i
  // ejerskab.js. Hjaelperen bruges ikke, fordi den ikke kan filtrere paa
  // `ai_udkast IS NULL` — og det filter er hele pointen.
  const UDKAST_FELTER = ["ai_udkast", "indhold", "ophav"];

  app.post("/api/tilbud/referater/:id/udkast", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;

    const { felter, ukendte } = pluk(req.body, UDKAST_FELTER);
    if (afvisUkendte(res, ukendte)) return;
    if (!tekst(felter.ai_udkast)) {
      return res.status(400).json({ error: "udkast_mangler", besked: "Der var intet udkast at gemme." });
    }

    let raekke;
    try {
      raekke = await hentEgenRaekke(supabase, "referater", req.params.id, firmId, "id, transskript, ai_udkast, status");
    } catch (e) { return svarPaaFejl(res, e, "referat kunne ikke hentes til udkast"); }

    if (raekke.status === "faerdig") return afvisFaerdigt(res);   // skive 3

    if (raekke.ai_udkast) {
      return res.status(409).json({
        error: "udkast_findes",
        besked: "Referatet har allerede et udkast. Genindlæs, så ser du det.",
      });
    }
    if (!tekst(raekke.transskript)) {
      return res.status(400).json({
        error: "ingen_transskription",
        besked: "Referatet har ingen indtalt tekst at lave et udkast af.",
      });
    }

    const aendringer = {
      ai_udkast: felter.ai_udkast,
      ai_model: null, ai_prompt_version: null,
      ...fraOphav(felter.ophav),
      ...(tekst(felter.indhold) ? { indhold: felter.indhold } : {}),
      ...maalTeknikB(raekke.transskript, felter.ai_udkast),
    };

    try {
      const { data, error } = await supabase
        .from("referater")
        .update(aendringer)
        .eq("id", raekke.id)
        .eq("firm_id", firmId)
        .eq("status", "kladde")
        .is("ai_udkast", null)
        .select("id, titel, moede_dato, status, teknik_b_markeringer, teknik_b_ord")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        // Raekken fandtes og var hans et oejeblik siden, saa nul raekker her
        // betyder: en anden skaerm naaede at saette udkastet imens.
        return res.status(409).json({
          error: "udkast_findes",
          besked: "Referatet fik et udkast fra en anden skærm imens. Genindlæs, så ser du det.",
        });
      }
      console.log(`✅ udkast sat paa referat ${data.id}`);
      res.json({ ok: true, referat: data });
    } catch (e) { svarPaaFejl(res, e, "udkast kunne ikke gemmes"); }
  });

  // ─── INDTAL MERE PAA EN KLADDE (besluttet af Ann 17/10-26) ─────────────────
  //
  // En kladde med kun indtalt tekst kan faa mere tekst: han optager igen, den
  // nye tekst saettes efter den gamle i et felt, han kan rette, og han gemmer.
  // Hver tilfoejelse er sin egen optagelse med op til 20 minutter.
  //
  // `transskript` er kildemateriale (se PATCH ovenfor), og det gaelder stadig
  // — FRA det oejeblik, der findes et udkast. Udkastet er lavet af netop den
  // tekst, og teknik B maaler mod den. Foer udkastet er teksten hans kladde,
  // og den maa han rette. Derfor:
  //   - KUN kladder (`status = 'kladde'`) UDEN udkast (`ai_udkast IS NULL`) —
  //     begge filtre i SAMME opdatering, saa en anden skaerm, der laver
  //     referatet imens, faar teksten laast foerst (409 `tekst_laast`).
  //   - `titel` kan komme med; en kladde med kun indtalt tekst havde ellers
  //     ingen maade at faa titlen rettet paa.
  const TRANSSKRIPT_FELTER = ["transskript", "titel"];
  const MAKS_TEGN_TRANSSKRIPT = 60000;   // samme som /api/tilbud/referat

  app.post("/api/tilbud/referater/:id/transskript", async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;

    const { felter, ukendte } = pluk(req.body, TRANSSKRIPT_FELTER);
    if (afvisUkendte(res, ukendte)) return;
    const ny = tekst(felter.transskript);
    if (!ny) {
      return res.status(400).json({ error: "ingen_tekst", besked: "Der er ingen tekst at gemme." });
    }
    if (ny.length > MAKS_TEGN_TRANSSKRIPT) {
      return res.status(413).json({
        error: "for_meget_tekst",
        besked: "Teksten er for lang til ét referat. Start et nyt referat til resten.",
      });
    }

    let raekke;
    try {
      raekke = await hentEgenRaekke(supabase, "referater", req.params.id, firmId, "id, status, ai_udkast");
    } catch (e) { return svarPaaFejl(res, e, "referat kunne ikke hentes til tilfoejelse"); }
    if (raekke.status === "faerdig") return afvisFaerdigt(res);
    if (raekke.ai_udkast) return afvisLaast(res);

    const aendringer = { transskript: ny };
    if (tekst(felter.titel)) aendringer.titel = tekst(felter.titel);

    try {
      const { data, error } = await supabase
        .from("referater")
        .update(aendringer)
        .eq("id", raekke.id)
        .eq("firm_id", firmId)
        .eq("status", "kladde")
        .is("ai_udkast", null)
        .select("id, titel, moede_dato, status")
        .maybeSingle();
      if (error) throw error;
      if (!data) return afvisLaast(res);   // fik udkast eller blev faerdig imens
      console.log(`✅ tekst tilfoejet paa referat ${data.id}`);
      res.json({ ok: true, referat: data });
    } catch (e) { svarPaaFejl(res, e, "teksten kunne ikke gemmes"); }
  });

  function afvisLaast(res) {
    return res.status(409).json({
      error: "tekst_laast",
      besked: "Der er lavet et referat af teksten, så den kan ikke ændres længere. Genindlæs, så ser du det.",
    });
  }

  return RUTER;
};
