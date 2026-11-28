// routes/tilbud/tilbud.js — selve tilbuddet (Fase 5 trin B, D5).
//
// Monteres fra routes/tilbud/index.js, kun når TILBUD_AKTIV og TILBUDSDEL_AKTIV
// begge er true. Kontrakten er docs/fase5-tilbud-kontrakt.md (udkast 9) — §-
// og #-henvisningerne herunder peger dertil og til byggeplanen.
//
//   GET    /api/tilbud/opgavetyper            firmaets typer, mest brugte først
//   POST   /api/tilbud/opgavetyper            { navn, enhed_id } — find eller opret
//   GET    /api/tilbud/enheder                grundlisten + firmaets egne
//   POST   /api/tilbud/enheder                { navn } — find eller opret ("Tilføj enhed")
//   GET    /api/tilbud?lead_id=               opgavens tilbud (resumé pr. version)
//   POST   /api/tilbud                        { lead_id } — ny kladde, ny kæde
//   GET    /api/tilbud/:id                    ét tilbud (§1)
//   PATCH  /api/tilbud/:id                    felter på en kladde
//   POST   /api/tilbud/:id/linjer             ny linje
//   PATCH  /api/tilbud/:id/linjer/:linjeId    ret en linje
//   DELETE /api/tilbud/:id/linjer/:linjeId    slet en linje
//   POST   /api/tilbud/:id/opgave-titel       { handling: "accepter" | "afvis" }
//   POST   /api/tilbud/:id/hent-profil        profilen ind igen, regnet om (#13)
//   POST   /api/tilbud/:id/godkend            frys, nummer, historik, lås (trin C, #2, #7)
//   POST   /api/tilbud/:id/sendt              hændelse, han selv markerer (#1)
//   POST   /api/tilbud/:id/accepteret         hændelse, han selv markerer (#2)
//   POST   /api/tilbud/:id/fortryd            fortryder sidste hændelse (§1, statusskift)
//   POST   /api/tilbud/:id/ny-version         ny kladde i samme kæde (#7, #13, #15)
//   GET    /api/tilbud/referencetal?opgavetype_id=  egne accepterede tilbud pr. enhed (trin D, #9, #16)
//   POST   /api/tilbud/tilbudslinjer          forslaget — det ene AI-kald (trin D, kontrakt §4),
//                                             kun med TILBUDSFORSLAG_AKTIV
//
// ─── TRE REGLER, DER BÆRER FILEN ────────────────────────────────────────────
//
// 1. EJERSKAB FRA TOKENET (§0, IDOR). Hver række hentes med firmaets filter på
//    (hentEgenRaekke), og et fremmed id giver 404 — aldrig 403, så man ikke kan
//    tælle sig frem til andres id'er. Linjer findes kun blandt tilbuddets egne.
//
// 2. KLIENTEN REGNER INGENTING (#14). Alle tal regnes af beregning.js, gemmes
//    og sendes tilbage. Enhver skrivning går gennem skriv(): regn hele
//    tilbuddet i hukommelsen FØRST (en rabat, der gør noget negativt, afvises
//    her med 422, før noget er skrevet), skriv så tilbuddet med rev som
//    nøgle, så linjerne, og regn til sidst summerne igen ud fra det, der nu
//    står i databasen.
//
// 3. REV (§0, A3). Hver skrivning skal sende det rev, klienten så (If-Match
//    eller feltet rev). Tilbuddet opdateres kun, hvis rev stadig passer, og rev
//    tælles op i samme kald. Passer det ikke: 409 med det aktuelle tilbud.
//
// ⚠️ KENDT GRÆNSE, bevidst. Supabase-klienten har ingen transaktion over flere
// kald, så tilbud og linjer skrives i hvert sit kald. To samtidige skrivninger
// på samme rev kan ikke ske (den ene får 409). Men fejler en linjeskrivning
// efter tilbuddet er skrevet, står summerne et øjeblik forkert, til næste
// skrivning regner dem igen. Det kan ALDRIG blive til et forkert godkendt
// tilbud: godkend_tilbud() regner det hele igen i databasen (tilbud_genregn)
// og afviser ved én øres afvigelse.
//
// ─── PERSONDATA (B6) ────────────────────────────────────────────────────────
// Ved fejl logges kun fejlkode — aldrig titler, beskrivelser, navne eller
// beløb fra kunden.

"use strict";

const crypto = require("crypto");
const { sendError } = require("@appsignal/nodejs");
const { firmIdFromToken } = require("../../auth");
const { kraevModul } = require("../../moduler");
const { medFirma, hentEgenRaekke } = require("../../ejerskab");
const { renTitel } = require("../../opgave-felter");
const { TILBUDSFORSLAG_AKTIV } = require("../../flags");
const B = require("./beregning");
// Grundlisten, synonymerne og opslaget ejes af spor 2 og findes ÉT sted (kontrakt §5, A9):
// tilbudslinjer-enheder.js i repoets rod. Målingen bruger samme fil.
const { GRUNDLISTE, findEnhed } = require("../../tilbudslinjer-enheder");

const RUTER = [
  "/api/tilbud",
  "/api/tilbud/:id",
  "/api/tilbud/:id/linjer",
  "/api/tilbud/:id/opgave-titel",
  "/api/tilbud/:id/hent-profil",
  "/api/tilbud/:id/godkend",
  "/api/tilbud/:id/sendt",
  "/api/tilbud/:id/accepteret",
  "/api/tilbud/:id/fortryd",
  "/api/tilbud/:id/ny-version",
  "/api/tilbud/referencetal",
  "/api/tilbud/opgavetyper",
  "/api/tilbud/enheder",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lofter (kontrakt §7, foreløbige). Beskrivelsen følger databasens grænse.
const MAKS = { titel: 100, typenavn: 60, enhedsnavn: 30, beskrivelse: 500, fritekst: 10000, linjer: 200 };

// ─── Fejl ────────────────────────────────────────────────────────────────────
// Afvist bærer sit eget svar. Alt andet oversættes i svarPaaFejl().
class Afvist extends Error {
  constructor(status, svar) { super(svar.error); this.status = status; this.svar = svar; }
}
const ugyldig = (felt, besked, error = "ugyldige_data") =>
  new Afvist(422, { error, mangler: [felt], besked });

function svarPaaFejl(res, e, hvad) {
  if (e instanceof Afvist) return res.status(e.status).json(e.svar);
  if (e instanceof B.Beregningsfejl) {
    const felt = e.detalje && e.detalje.felt ? e.detalje.felt : (e.detalje && e.detalje.linje !== undefined ? `linje ${e.detalje.linje}` : e.kode);
    return res.status(422).json({ error: "ugyldige_data", kode: e.kode, mangler: [felt], besked: e.message });
  }
  if (e && e.kode === "ejerskab_ikke_fundet") return res.status(404).json({ error: "ikke_fundet", besked: "Den findes ikke." });
  if (e && e.code === "42501") {
    return res.status(409).json({ error: "tilbud_laast", besked: "Tilbuddet er godkendt og kan ikke ændres. Lav en ny version." });
  }
  if (e && e.code === "23503") return res.status(404).json({ error: "ikke_fundet", besked: "Enheden eller typen findes ikke." });
  if (e && e.code === "23505") return res.status(409).json({ error: "findes_allerede", besked: "Den findes allerede." });
  if (e && e.code === "23514") return res.status(422).json({ error: "ugyldige_data", besked: "Et tal eller felt er uden for det tilladte." });
  console.error(`❌ ${hvad}:`, e && (e.kode || e.code || e.name));
  sendError(e);
  return res.status(500).json({ error: "serverfejl", besked: "Noget gik galt her hos os. Prøv igen om lidt." });
}

// ─── Læsning af input ────────────────────────────────────────────────────────
// Samme regel som data.js: et ukendt felt er en fejl, ikke noget man ignorerer.
function pluk(krop, tilladte) {
  const felter = {}, ukendte = [];
  for (const n of Object.keys(krop || {})) {
    if (tilladte.includes(n)) felter[n] = krop[n];
    else ukendte.push(n);
  }
  if (ukendte.length) {
    throw new Afvist(422, {
      error: "ukendte_felter", mangler: ukendte,
      besked: `Felterne ${ukendte.join(", ")} kendes ikke her. Et felt, der er stavet forkert, ville ellers blive sorteret fra i stilhed.`,
    });
  }
  return felter;
}
const har = (o, n) => Object.prototype.hasOwnProperty.call(o, n);

function laesRev(req) {
  let v = req.get("if-match");
  if (v !== undefined) v = String(v).replace(/^W\//, "").replace(/"/g, "").trim();
  else if (req.body && req.body.rev !== undefined) v = req.body.rev;
  else if (req.query && req.query.rev !== undefined) v = req.query.rev;
  const n = typeof v === "number" ? v : (/^\d{1,9}$/.test(String(v === undefined || v === null ? "" : v)) ? Number(v) : NaN);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw ugyldig("rev", "rev mangler. Send det rev, du fik sammen med tilbuddet (If-Match eller feltet rev).");
  }
  return n;
}

function tekstFelt(v, felt, maks) {
  if (v === null) return null;
  if (typeof v !== "string") throw ugyldig(felt, `${felt} skal være tekst.`);
  const t = v.trim();
  if (!t) return null;
  if (t.length > maks) throw ugyldig(felt, `${felt} må højst være ${maks} tegn.`, "for_lang");
  return t;
}
function boolFelt(v, felt) {
  if (typeof v !== "boolean") throw ugyldig(felt, `${felt} skal være true eller false.`);
  return v;
}
// Antal og mængde er TEKST med højst 3 decimaler (§0). Et JSON-tal afvises:
// 0.1 + 0.2 er ikke 0.3 i JavaScript, og klienten må ikke regne.
function antalFelt(v, felt) {
  if (v === null) return null;
  if (typeof v !== "string" || !B.ANTAL_RE.test(v)) throw ugyldig(felt, `${felt} skal være tekst med højst 3 decimaler og punktum, fx "1.5".`);
  return v;
}
function oereFelt(v, felt) {
  if (v === null) return null;
  if (!Number.isSafeInteger(v) || v < 0) throw ugyldig(felt, `${felt} skal være et helt antal øre (≥ 0).`);
  return v;
}
function uuidFelt(v, felt) {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw ugyldig(felt, `${felt} skal være et id.`);
  return v;
}

// Rabat (#16) -> kolonnerne. null eller { form: null } = ingen rabat.
function rabatFelt(v, felt) {
  if (v === null || (v && typeof v === "object" && v.form === null && Object.keys(v).every((k) => k === "form" || v[k] === null))) {
    return { rabat_form: null, rabat_procent: null, rabat_beloeb_oere: null };
  }
  if (!v || typeof v !== "object") throw ugyldig(felt, `${felt} skal være { form, procent } eller { form, beloeb_oere }.`);
  const ukendte = Object.keys(v).filter((k) => !["form", "procent", "beloeb_oere"].includes(k));
  if (ukendte.length) throw ugyldig(`${felt}.${ukendte[0]}`, `${felt} kender ikke ${ukendte.join(", ")}.`);
  if (v.form === "procent") {
    if (typeof v.procent !== "string" || !B.PROCENT_RE.test(v.procent)) throw ugyldig(`${felt}.procent`, "Procent skal være tekst med højst 2 decimaler, fx \"10\".");
    if (v.beloeb_oere != null) throw ugyldig(`${felt}.beloeb_oere`, "En procentrabat har intet beløb.");
    return { rabat_form: "procent", rabat_procent: v.procent, rabat_beloeb_oere: null };
  }
  if (v.form === "kroner") {
    if (v.procent != null) throw ugyldig(`${felt}.procent`, "En kronerabat har ingen procent.");
    const b = oereFelt(v.beloeb_oere === undefined ? null : v.beloeb_oere, `${felt}.beloeb_oere`);
    if (b === null) throw ugyldig(`${felt}.beloeb_oere`, "Skriv rabattens beløb i øre.");
    return { rabat_form: "kroner", rabat_procent: null, rabat_beloeb_oere: b };
  }
  throw ugyldig(`${felt}.form`, `${felt}.form skal være null, "procent" eller "kroner".`);
}

// Tal fra databasen kommer som JSON-tal (numeric) — til tekst uden afrunding.
function talTekst(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  const s = String(v);
  if (/e/i.test(s)) throw new Error("talTekst: uventet eksponent");
  return s;
}
// Samme værdi? Tal fra databasen (1.5) og tekst fra klienten ("1.5") er ens.
const samme = (a, b) => (a === null || a === undefined ? b === null || b === undefined : String(a) === String(b));
// firma_profil.timepris er kroner med 2 decimaler -> øre, uden kommatal.
function kronerTilOere(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  const [hel, dec = ""] = s.split(".");
  return Number(BigInt(hel) * 100n + BigInt((dec + "00").slice(0, 2)));
}

// Uenige-punkter fjernes, når feltet bekræftes (§1).
const udenUenig = (uenige, felt) => (Array.isArray(uenige) ? uenige : []).filter((u) => u && u.felt !== felt);

// ─── Beregningens form ───────────────────────────────────────────────────────
const somBeregningLinje = (l) => ({
  type: l.type,
  antal: talTekst(l.antal),
  enhedspris_oere: l.enhedspris_oere === undefined ? null : l.enhedspris_oere,
  rabat: { form: l.rabat_form || null, procent: talTekst(l.rabat_procent), beloeb_oere: l.rabat_beloeb_oere === undefined ? null : l.rabat_beloeb_oere },
});
const somBeregningTilbud = (t) => ({
  moms_sats: talTekst(t.moms_sats),
  rabat: { form: t.rabat_form || null, procent: talTekst(t.rabat_procent), beloeb_oere: t.rabat_beloeb_oere === undefined ? null : t.rabat_beloeb_oere },
});
const sorterLinjer = (linjer) => linjer.slice().sort((a, b) =>
  (a.sortering - b.sortering) || String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id).localeCompare(String(b.id)));

// ─── Svarets form (§1, §2) ──────────────────────────────────────────────────
function linjeTilKlient(l) {
  return {
    id: l.id,
    sortering: l.sortering,
    type: l.type,
    beskrivelse: l.beskrivelse,
    antal: talTekst(l.antal),
    enhed: l.enhed_navn == null && l.enhed_id == null ? null : { id: l.enhed_id, navn: l.enhed_navn, ny: !!l.enhed_ny },
    enhedspris_oere: l.enhedspris_oere,
    brutto_oere: l.brutto_oere,
    rabat: { form: l.rabat_form, procent: talTekst(l.rabat_procent), beloeb_oere: l.rabat_beloeb_oere },
    rabat_oere: l.linje_sum_oere === null ? null : l.rabat_oere,
    linje_sum_oere: l.linje_sum_oere,
    uenig: l.uenig,
    ordret: l.ordret,
    kilde: l.kilde,
    bekraeftet: l.bekraeftet,
  };
}

// Hvad står i vejen for godkendelse (§1 kan_godkendes, §3, B13). Samme tjek
// som godkend_tilbud() i databasen — plus profilfelterne, som kun kontrakten
// kræver (bank, timepris). Databasen tjekker igen ved godkendelsen (trin C).
function hvadMangler(t, linjer, lead) {
  const m = [];
  const sorteret = sorterLinjer(linjer);
  if (!sorteret.length) m.push("ingen linjer");
  sorteret.forEach((l, i) => {
    const nr = i + 1;
    if (l.antal === null) m.push(`linje ${nr}: antal mangler`);
    if (l.enhedspris_oere === null) m.push(`linje ${nr}: pris mangler`);
    if (!l.bekraeftet) m.push(`linje ${nr}: ikke bekræftet`);
    if (l.enhed_ny) m.push(`linje ${nr}: ny enhed ikke oprettet`);
  });
  if (!t.titel || !t.titel.trim() || !t.titel_bekraeftet) m.push("titel ikke bekræftet");
  if (t.indledning && t.indledning_kilde === "model" && !t.indledning_bekraeftet) m.push("indledning ikke bekræftet");
  if (t.opgavetype_navn && (!t.opgavetype_id || !t.opgavetype_bekraeftet)) m.push("opgavetype ikke bekræftet");
  if (t.maengde !== null && !t.maengde_bekraeftet) m.push("mængde ikke bekræftet");
  if (!t.firma_navn || !String(t.firma_navn).trim()) m.push("firmanavn mangler (Profil)");
  if (!t.firma_cvr || !String(t.firma_cvr).trim()) m.push("CVR mangler (Profil)");
  if (!t.firma_bank_reg || !t.firma_bank_konto) m.push("bankoplysninger mangler (Profil)");
  if (t.timepris_oere === null) m.push("timepris mangler (Profil)");
  if (t.gyldig_dage === null) m.push("gyldighed mangler");
  if (!lead || !lead.name || !lead.name.trim()) m.push("kundens navn mangler");
  if (!lead || !lead.address || !lead.address.trim()) m.push("arbejdssted mangler");
  try { B.regnTilbud(somBeregningTilbud(t), sorteret.map(somBeregningLinje)); }
  catch (e) { if (e instanceof B.Beregningsfejl) m.push(e.message); else throw e; }
  return m;
}

function tilbudTilKlient(t, linjer, kilder, lead) {
  const kladde = t.status === "kladde";
  const mangler = kladde ? hvadMangler(t, linjer, lead) : [];
  return {
    id: t.id,
    lead_id: t.lead_id,
    kaede_id: t.kaede_id,
    version: t.version,
    status: t.status,
    tilbudsnummer: t.tilbudsnummer,
    rev: t.rev,
    erstatter: t.erstatter_tilbudsnummer == null ? null : { tilbudsnummer: t.erstatter_tilbudsnummer, godkendt_at: t.erstatter_godkendt_at },

    titel: t.titel,
    titel_kilde: t.titel_kilde,
    titel_bekraeftet: t.titel_bekraeftet,
    opgave_titel_forslag: t.opgave_titel_forslag,
    opgave_titel_forslag_status: t.opgave_titel_forslag_status,

    opgavetype: t.opgavetype_navn == null ? null
      : { id: t.opgavetype_id, navn: t.opgavetype_navn, enhed: t.opgavetype_enhed, ny: t.opgavetype_id == null },
    opgavetype_kilde: t.opgavetype_kilde,
    opgavetype_bekraeftet: t.opgavetype_bekraeftet,
    maengde: t.maengde == null ? null : {
      faktorer: t.maengde_faktorer == null ? null : t.maengde_faktorer.map(talTekst),
      vaerdi: talTekst(t.maengde),
      enhed: t.opgavetype_enhed,
    },
    maengde_kilde: t.maengde_kilde,
    maengde_bekraeftet: t.maengde_bekraeftet,

    uenige: t.uenige || [],

    indledning: t.indledning,
    indledning_kilde: t.indledning_kilde,
    indledning_bekraeftet: t.indledning_bekraeftet,
    betingelser: t.betingelser,
    gyldig_dage: t.gyldig_dage,
    gyldig_til: t.gyldig_til,
    timepris_oere: t.timepris_oere,
    moms_sats: t.moms_sats == null ? null : Number(t.moms_sats).toFixed(2),
    koersel: {
      form: t.koersel_form,
      km: talTekst(t.koersel_km),
      sats_oere: t.koersel_sats_oere,
      beloeb_oere: t.koersel_beloeb_oere,
    },
    rabat: { form: t.rabat_form, procent: talTekst(t.rabat_procent), beloeb_oere: t.rabat_beloeb_oere },

    firma: {
      navn: t.firma_navn, cvr: t.firma_cvr, adresse: t.firma_adresse, telefon: t.firma_telefon,
      email: t.firma_email, bank_reg: t.firma_bank_reg, bank_konto: t.firma_bank_konto,
    },
    // I en kladde læses kunden fra opgaven; ved godkendelse fryses den (A10).
    kunde: kladde
      ? { navn: lead ? lead.name : null, arbejdssted: lead ? lead.address : null }
      : { navn: t.kunde_navn, arbejdssted: t.kunde_arbejdssted },
    profil_kopieret_at: t.profil_kopieret_at,

    summer: {
      arbejde_oere: t.arbejde_oere, materialer_oere: t.materialer_oere, koersel_oere: t.koersel_oere, andet_oere: t.andet_oere,
      foer_samlet_rabat_oere: t.foer_samlet_rabat_oere, samlet_rabat_oere: t.samlet_rabat_oere,
      ex_moms_oere: t.ex_moms_oere, moms_oere: t.moms_oere, inkl_moms_oere: t.inkl_moms_oere,
    },

    kilder: {
      referat_ids: (kilder || []).map((k) => k.referat_id).filter(Boolean),
      beskrivelse_kopi: t.kilde_beskrivelse_kopi,
      noter_kopi: t.kilde_noter_kopi,
      lavet_at: t.kilder_lavet_at,
    },

    linjer: sorterLinjer(linjer).map(linjeTilKlient),

    forslag_markeringer: t.forslag_markeringer || null,

    kan_godkendes: kladde && mangler.length === 0,
    mangler,

    godkendt_at: t.godkendt_at,
    sendt_at: t.sendt_at,
    accepteret_at: t.accepteret_at,
  };
}

module.exports = function (app, supabase) {
  // Spærren (moduler.js): skrivning kræver modulet tilbud. Læsning gør ikke —
  // et afmeldt modul må stadig se sit eget (beslutningsgrundlaget 13/10).
  const spaerSkriv = kraevModul(supabase, "tilbud");
  const spaerLaes = kraevModul(supabase, "tilbud", { kunSkrivning: true });

  // :id skal være et uuid (B10). Ellers springes ruten over, så de faste stier
  // (/api/tilbud/kunder, /status, /kvote …) stadig rammes, og intet andet
  // matcher: Express svarer 404.
  const idVagt = (...navne) => (req, res, next) =>
    (navne.every((n) => UUID_RE.test(req.params[n] || "")) ? next() : next("route"));

  async function firma(req, res) {
    const firmId = await firmIdFromToken(supabase, req);
    if (!firmId) { res.status(401).json({ error: "Ikke logget ind" }); return null; }
    return firmId;
  }

  // ─── Læsning ──────────────────────────────────────────────────────────────
  async function hentLinjer(firmId, tilbudId) {
    const { data, error } = await supabase.from("tilbud_linjer").select("*")
      .eq("tilbud_id", tilbudId).eq("firm_id", firmId);
    if (error) throw error;
    return data || [];
  }
  async function hentAlt(firmId, id) {
    const t = await hentEgenRaekke(supabase, "tilbud", id, firmId, "*");
    return { t, linjer: await hentLinjer(firmId, t.id) };
  }
  async function fuld(firmId, id) {
    const { t, linjer } = await hentAlt(firmId, id);
    const { data: kilder, error: kE } = await supabase.from("tilbud_kilder")
      .select("referat_id, nr").eq("tilbud_id", t.id).eq("firm_id", firmId).order("nr");
    if (kE) throw kE;
    const { data: lead, error: lE } = await supabase.from("leads")
      .select("id, name, address").eq("id", t.lead_id).eq("firm_id", firmId).maybeSingle();
    if (lE) throw lE;
    return tilbudTilKlient(t, linjer, kilder || [], lead);
  }

  // Profilen, som den er nu (#13, A4). Kopieres ind ved oprettelse og hent-profil.
  async function profilKopi(firmId) {
    const { data: p, error } = await supabase.from("firma_profil")
      .select("cvr, adresse, telefon, email, bank_reg, bank_konto, timepris, moms_sats, standard_betingelser, standard_gyldighed_dage, koersel_km_sats_oere, koersel_fast_oere")
      .eq("firm_id", firmId).maybeSingle();
    if (error) throw error;
    const { data: f, error: fE } = await supabase.from("firms").select("name").eq("id", firmId).maybeSingle();
    if (fE) throw fE;
    return {
      felter: {
        firma_navn: f ? f.name : null,
        firma_cvr: p ? p.cvr : null,
        firma_adresse: p ? p.adresse : null,
        firma_telefon: p ? p.telefon : null,
        firma_email: p ? p.email : null,
        firma_bank_reg: p ? p.bank_reg : null,
        firma_bank_konto: p ? p.bank_konto : null,
        timepris_oere: p ? kronerTilOere(p.timepris) : null,
        // Uden profilrække: profilens egne standarder (25 % og 30 dage).
        moms_sats: p ? talTekst(p.moms_sats) : "25.00",
        betingelser: p ? p.standard_betingelser : null,
        gyldig_dage: p ? p.standard_gyldighed_dage : 30,
        profil_kopieret_at: new Date().toISOString(),
      },
      kmSats: p ? p.koersel_km_sats_oere : null,
      fast: p ? p.koersel_fast_oere : null,
    };
  }

  // Grundlistens række for et navn ("timer" til arbejdslinjen).
  async function grundEnhed(navn) {
    const { data, error } = await supabase.from("enheder").select("id, navn")
      .is("firm_id", null).eq("navn", navn).maybeSingle();
    if (error) throw error;
    return data;
  }
  // En enhed, firmaet må bruge: grundlisten eller dets egne (A9). Ellers 404.
  async function brugbarEnhed(firmId, id) {
    const { data, error } = await supabase.from("enheder").select("id, navn, firm_id, aktiv").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data || (data.firm_id !== null && data.firm_id !== firmId)) {
      throw new Afvist(404, { error: "ikke_fundet", besked: "Enheden findes ikke." });
    }
    return data;
  }

  // "Tilføj enhed" (#11): grundlisten først (også synonymer), så firmaets egne
  // uden hensyn til store/små bogstaver, punktum og mellemrum. Ellers oprettes
  // den på firmaet. En deaktiveret egen enhed tages i brug igen.
  async function findEllerOpretEnhed(firmId, navn) {
    const { data: egne, error } = await supabase.from("enheder").select("id, navn, aktiv").eq("firm_id", firmId);
    if (error) throw error;
    const fund = findEnhed(navn, egne || []);
    if (fund.grundliste) return { enhed: await grundEnhed(fund.navn), oprettet: false, grundliste: true };
    if (!fund.ny) {
      const fundet = (egne || []).find((e) => e.id === fund.id);
      if (fundet && !fundet.aktiv) {
        const { error: aE } = await supabase.from("enheder").update({ aktiv: true }).eq("id", fundet.id).eq("firm_id", firmId);
        if (aE) throw aE;
      }
      return { enhed: { id: fund.id, navn: fund.navn }, oprettet: false, grundliste: false };
    }
    const { data: ny, error: iE } = await supabase.from("enheder")
      .insert(medFirma(firmId, { navn: fund.navn })).select("id, navn").single();
    if (iE && iE.code === "23505") return findEllerOpretEnhed(firmId, navn);   // en anden nåede først
    if (iE) throw iE;
    return { enhed: ny, oprettet: true, grundliste: false };
  }

  // Opgavetype (#11): unik pr. firma på normaliseret navn OG enhed — samme navn
  // med en anden enhed er en ny type.
  const typeNorm = (s) => String(s).trim().replace(/\s+/g, " ").toLowerCase();
  async function findEllerOpretType(firmId, navn, enhedId) {
    const { data: typer, error } = await supabase.from("opgavetyper")
      .select("id, navn, enhed_id, aktiv").eq("firm_id", firmId).eq("enhed_id", enhedId);
    if (error) throw error;
    const fundet = (typer || []).find((x) => typeNorm(x.navn) === typeNorm(navn));
    if (fundet) {
      if (!fundet.aktiv) {
        const { error: aE } = await supabase.from("opgavetyper").update({ aktiv: true }).eq("id", fundet.id).eq("firm_id", firmId);
        if (aE) throw aE;
      }
      return { type: fundet, oprettet: false };
    }
    const { data: ny, error: iE } = await supabase.from("opgavetyper")
      .insert(medFirma(firmId, { navn, enhed_id: enhedId })).select("id, navn, enhed_id").single();
    if (iE && iE.code === "23505") return findEllerOpretType(firmId, navn, enhedId);
    if (iE) throw iE;
    return { type: ny, oprettet: true };
  }

  // ─── Skrivning ────────────────────────────────────────────────────────────
  // Linjeoperationer: { op: "insert", raekke } | { op: "update", id, felter } | { op: "delete", id }.
  // Tallene på en indsat eller rettet linje regnes her, ét sted.
  function anvend(linjer, ops) {
    let ud = linjer.map((l) => ({ ...l }));
    for (const o of ops) {
      if (o.op === "insert") ud.push({ ...o.raekke });
      else if (o.op === "update") ud = ud.map((l) => (l.id === o.id ? { ...l, ...o.felter } : l));
      else if (o.op === "delete") ud = ud.filter((l) => l.id !== o.id);
    }
    return ud;
  }
  function medTal(raekke, nr) {
    const r = B.regnLinje(somBeregningLinje(raekke), nr);
    return { brutto_oere: r.brutto_oere, rabat_oere: r.rabat_oere, linje_sum_oere: r.linje_sum_oere };
  }

  async function revFejl(firmId, id) {
    const aktuel = await fuld(firmId, id);
    if (aktuel.status !== "kladde") {
      return new Afvist(409, { error: "tilbud_laast", besked: "Tilbuddet er godkendt og kan ikke ændres. Lav en ny version.", tilbud: aktuel });
    }
    return new Afvist(409, { error: "rev_passer_ikke", besked: "Tilbuddet er ændret et andet sted. Her er den nyeste udgave.", tilbud: aktuel });
  }

  // byg(t, linjer) -> { felter, ops, efter } — felter på tilbuddet, linjeoperationer
  // og evt. noget, der skal ske efter, at tilbuddet er skrevet.
  async function skriv(req, firmId, id, byg) {
    const rev = laesRev(req);
    const { t, linjer } = await hentAlt(firmId, id);
    if (t.status !== "kladde" || t.rev !== rev) throw await revFejl(firmId, t.id);

    const plan = await byg(t, linjer);
    const felter = plan.felter || {};
    const ops = plan.ops || [];

    // Regn de rørte linjer og hele tilbuddet i hukommelsen, FØR noget skrives.
    let nye = anvend(linjer, ops);
    for (const o of ops) {
      if (o.op === "delete") continue;
      const lid = o.op === "insert" ? o.raekke.id : o.id;
      const nr = sorterLinjer(nye).findIndex((l) => l.id === lid) + 1;
      const tal = medTal(nye.find((l) => l.id === lid), nr);
      if (o.op === "insert") Object.assign(o.raekke, tal); else Object.assign(o.felter, tal);
    }
    nye = anvend(linjer, ops);
    if (nye.length > MAKS.linjer) throw ugyldig("linjer", `Et tilbud kan højst have ${MAKS.linjer} linjer.`, "for_mange");
    const regnet = B.regnTilbud(somBeregningTilbud({ ...t, ...felter }), sorterLinjer(nye).map(somBeregningLinje));

    const { data: skrevet, error } = await supabase.from("tilbud")
      .update({ ...felter, ...regnet.summer, rev: rev + 1 })
      .eq("id", t.id).eq("firm_id", firmId).eq("rev", rev).eq("status", "kladde")
      .select("id").maybeSingle();
    if (error) throw error;
    if (!skrevet) throw await revFejl(firmId, t.id);

    for (const o of ops) {
      let r;
      if (o.op === "insert") r = await supabase.from("tilbud_linjer").insert(o.raekke);
      else if (o.op === "update") r = await supabase.from("tilbud_linjer").update(o.felter).eq("id", o.id).eq("tilbud_id", t.id).eq("firm_id", firmId);
      else r = await supabase.from("tilbud_linjer").delete().eq("id", o.id).eq("tilbud_id", t.id).eq("firm_id", firmId);
      if (r.error) throw r.error;
    }
    if (plan.efter) await plan.efter(rev + 1);
    await efterregn(firmId, t.id, rev + 1);
    return fuld(firmId, t.id);
  }

  // Summerne igen, ud fra det, der NU står i databasen. Skrives kun, hvis rev
  // stadig er vores; ellers regner den næste skrivning selv.
  async function efterregn(firmId, id, rev) {
    try {
      const { t, linjer } = await hentAlt(firmId, id);
      if (t.rev !== rev || t.status !== "kladde") return;
      const { summer } = B.regnTilbud(somBeregningTilbud(t), sorterLinjer(linjer).map(somBeregningLinje));
      if (Object.keys(summer).every((k) => t[k] === summer[k])) return;
      const { error } = await supabase.from("tilbud").update(summer)
        .eq("id", id).eq("firm_id", firmId).eq("rev", rev).eq("status", "kladde");
      if (error) throw error;
    } catch (e) {
      // Godkendelsen regner igen i databasen; en fejl her må ikke vælte svaret.
      console.error("❌ tilbud efterregn:", e && (e.kode || e.code || e.name));
      sendError(e);
    }
  }

  // Kørselslinjen vedligeholdes af serveren ud fra tilbuddets kørsel (§2, #5).
  function koerselOps(t, linjer) {
    const eksisterende = linjer.filter((l) => l.type === "koersel");
    const ops = [];
    const k = B.koerselsLinje({ form: t.koersel_form, km: talTekst(t.koersel_km), sats_oere: t.koersel_sats_oere, beloeb_oere: t.koersel_beloeb_oere });
    if (!k) { for (const l of eksisterende) ops.push({ op: "delete", id: l.id }); return ops; }
    const felter = {
      beskrivelse: "Kørsel",
      antal: k.antal,
      enhedspris_oere: k.enhedspris_oere,
      enhed_id: null,
      enhed_navn: t.koersel_form === "km" ? "km" : null,
      enhed_ny: false,
      rabat_form: null, rabat_procent: null, rabat_beloeb_oere: null,
      kilde: "haandvaerker", bekraeftet: true, ordret: true, uenig: null,
    };
    if (eksisterende.length) {
      ops.push({ op: "update", id: eksisterende[0].id, felter });
      for (const l of eksisterende.slice(1)) ops.push({ op: "delete", id: l.id });
    } else {
      const maks = linjer.reduce((m, l) => Math.max(m, l.sortering), 0);
      ops.push({ op: "insert", raekke: medFirma(t.firm_id, { id: crypto.randomUUID(), tilbud_id: t.id, type: "koersel", sortering: maks + 1, ...felter }) });
    }
    return ops;
  }

  /* ────────────────────────────  OPGAVETYPER  ──────────────────────────── */

  // Firmaets aktive typer, de mest brugte først, ved lige antal den senest
  // brugte (kontrakt §4). Bruges af listen og af forslaget (højst 50 dér).
  async function firmaetsTyper(firmId) {
    const { data: typer, error } = await supabase.from("opgavetyper")
      .select("id, navn, enhed_id, created_at").eq("firm_id", firmId).eq("aktiv", true);
    if (error) throw error;
    const { data: enheder, error: eE } = await supabase.from("enheder").select("id, navn");
    if (eE) throw eE;
    const { data: brug, error: bE } = await supabase.from("tilbud")
      .select("opgavetype_id, created_at").eq("firm_id", firmId).not("opgavetype_id", "is", null);
    if (bE) throw bE;
    const navnPaa = new Map((enheder || []).map((e) => [e.id, e.navn]));
    const tael = new Map();
    for (const b of brug || []) {
      const x = tael.get(b.opgavetype_id) || { antal: 0, senest: "" };
      x.antal++; if (String(b.created_at) > x.senest) x.senest = String(b.created_at);
      tael.set(b.opgavetype_id, x);
    }
    return (typer || []).map((x) => ({
      id: x.id, navn: x.navn,
      enhed: { id: x.enhed_id, navn: navnPaa.get(x.enhed_id) || null },
      antal_brugt: (tael.get(x.id) || {}).antal || 0,
      senest_brugt: (tael.get(x.id) || {}).senest || null,
    })).sort((a, b) => (b.antal_brugt - a.antal_brugt) || String(b.senest_brugt || "").localeCompare(String(a.senest_brugt || "")) || a.navn.localeCompare(b.navn, "da"));
  }

  app.get("/api/tilbud/opgavetyper", spaerLaes, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try { res.json({ ok: true, opgavetyper: await firmaetsTyper(firmId) }); }
    catch (e) { svarPaaFejl(res, e, "opgavetyper kunne ikke hentes"); }
  });

  app.post("/api/tilbud/opgavetyper", spaerSkriv, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      const f = pluk(req.body, ["navn", "enhed_id"]);
      const navn = tekstFelt(f.navn === undefined ? null : f.navn, "navn", MAKS.typenavn);
      if (!navn) throw ugyldig("navn", "Typen skal have et navn.");
      const enhed = await brugbarEnhed(firmId, uuidFelt(f.enhed_id, "enhed_id"));
      const { type, oprettet } = await findEllerOpretType(firmId, navn, enhed.id);
      res.status(oprettet ? 201 : 200).json({ ok: true, oprettet, opgavetype: { id: type.id, navn: type.navn, enhed: { id: enhed.id, navn: enhed.navn } } });
    } catch (e) { svarPaaFejl(res, e, "opgavetype kunne ikke oprettes"); }
  });

  /* ──────────────────────────────  ENHEDER  ───────────────────────────── */

  app.get("/api/tilbud/enheder", spaerLaes, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      const { data: grund, error } = await supabase.from("enheder").select("id, navn").is("firm_id", null).eq("aktiv", true);
      if (error) throw error;
      const { data: egne, error: eE } = await supabase.from("enheder").select("id, navn").eq("firm_id", firmId).eq("aktiv", true);
      if (eE) throw eE;
      const plads = (n) => { const i = GRUNDLISTE.indexOf(n); return i < 0 ? 999 : i; };
      const ud = (grund || []).slice().sort((a, b) => plads(a.navn) - plads(b.navn)).map((e) => ({ id: e.id, navn: e.navn, grundliste: true }))
        .concat((egne || []).slice().sort((a, b) => a.navn.localeCompare(b.navn, "da")).map((e) => ({ id: e.id, navn: e.navn, grundliste: false })));
      res.json({ ok: true, enheder: ud });
    } catch (e) { svarPaaFejl(res, e, "enheder kunne ikke hentes"); }
  });

  app.post("/api/tilbud/enheder", spaerSkriv, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      const f = pluk(req.body, ["navn"]);
      const navn = tekstFelt(f.navn === undefined ? null : f.navn, "navn", MAKS.enhedsnavn);
      if (!navn) throw ugyldig("navn", "Enheden skal have et navn.");
      const { enhed, oprettet, grundliste } = await findEllerOpretEnhed(firmId, navn);
      res.status(oprettet ? 201 : 200).json({ ok: true, oprettet, enhed: { id: enhed.id, navn: enhed.navn, grundliste } });
    } catch (e) { svarPaaFejl(res, e, "enhed kunne ikke oprettes"); }
  });

  /* ──────────────────────────────  TILBUD  ────────────────────────────── */

  // Opgavens tilbud — alle versioner, som resumé uden kildekopier (§6).
  app.get("/api/tilbud", spaerLaes, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      const leadId = uuidFelt(req.query.lead_id, "lead_id");
      await hentEgenRaekke(supabase, "leads", leadId, firmId, "id");
      const { data, error } = await supabase.from("tilbud")
        .select("id, kaede_id, version, status, tilbudsnummer, titel, rev, ex_moms_oere, inkl_moms_oere, created_at, godkendt_at, sendt_at, accepteret_at")
        .eq("firm_id", firmId).eq("lead_id", leadId).order("version");
      if (error) throw error;
      res.json({ ok: true, tilbud: data || [] });
    } catch (e) { svarPaaFejl(res, e, "tilbud kunne ikke hentes"); }
  });

  // Ny kladde, version 1, ny kæde (§6, #15). Profilen kopieres ind (#13), og
  // arbejdslinjen oprettes med timeprisen og uden timer (#3).
  app.post("/api/tilbud", spaerSkriv, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      const f = pluk(req.body, ["lead_id"]);
      const lead = await hentEgenRaekke(supabase, "leads", uuidFelt(f.lead_id, "lead_id"), firmId, "id");
      const { data: findes, error: fE } = await supabase.from("tilbud").select("id")
        .eq("firm_id", firmId).eq("lead_id", lead.id).limit(1);
      if (fE) throw fE;
      if ((findes || []).length) {
        return res.status(409).json({ error: "kaede_findes", tilbud_id: findes[0].id, besked: "Opgaven har allerede et tilbud." });
      }

      const profil = await profilKopi(firmId);
      const { data: t, error: tE } = await supabase.from("tilbud")
        .insert(medFirma(firmId, {
          lead_id: lead.id, version: 1, ...profil.felter,
          koersel_form: null, koersel_sats_oere: profil.kmSats, koersel_beloeb_oere: profil.fast,
        }))
        .select("id").single();
      // 23505 på tilbud_en_kaede_pr_opgave: en anden nåede først.
      if (tE && tE.code === "23505") return res.status(409).json({ error: "kaede_findes", besked: "Opgaven har allerede et tilbud." });
      if (tE) throw tE;

      const timer = await grundEnhed("timer");
      const arbejde = {
        tilbud_id: t.id, sortering: 1, type: "arbejde", beskrivelse: "Arbejde",
        antal: null, enhed_id: timer ? timer.id : null, enhed_navn: timer ? timer.navn : "timer", enhed_ny: false,
        enhedspris_oere: profil.felter.timepris_oere, kilde: "haandvaerker", bekraeftet: true, ordret: true,
        ...medTal({ type: "arbejde", antal: null, enhedspris_oere: profil.felter.timepris_oere }, 1),
      };
      const { error: lE } = await supabase.from("tilbud_linjer").insert(medFirma(firmId, arbejde));
      if (lE) {
        // Ingen halv kladde: den kan slettes, så længe den er kladde.
        await supabase.from("tilbud").delete().eq("id", t.id).eq("firm_id", firmId).eq("status", "kladde");
        throw lE;
      }
      res.status(201).json({ ok: true, tilbud: await fuld(firmId, t.id) });
    } catch (e) { svarPaaFejl(res, e, "tilbud kunne ikke oprettes"); }
  });

  app.get("/api/tilbud/:id", idVagt("id"), spaerLaes, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try { res.json({ ok: true, tilbud: await fuld(firmId, req.params.id) }); }
    catch (e) { svarPaaFejl(res, e, "tilbud kunne ikke hentes"); }
  });

  // Felter på en kladde. Et forslag bekræftes med *_bekraeftet: true, hvert for
  // sig (B14). At ændre indholdet gør feltet til hans (kilde: haandvaerker).
  const TILBUD_FELTER = ["rev", "titel", "titel_bekraeftet", "opgavetype", "opgavetype_bekraeftet",
    "maengde", "maengde_bekraeftet", "indledning", "indledning_bekraeftet", "betingelser", "gyldig_dage", "koersel", "rabat"];

  app.patch("/api/tilbud/:id", idVagt("id"), spaerSkriv, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      const ind = pluk(req.body, TILBUD_FELTER);
      if (!Object.keys(ind).some((k) => k !== "rev")) {
        throw new Afvist(422, { error: "intet_at_rette", mangler: [], besked: "Der var ikke noget at rette." });
      }
      const tilbud = await skriv(req, firmId, req.params.id, async (t, linjer) => {
        const f = {};
        let uenige = t.uenige || [];
        const nu = (k) => (har(f, k) ? f[k] : t[k]);

        if (har(ind, "titel")) {
          const v = tekstFelt(ind.titel, "titel", MAKS.titel);
          if (v !== t.titel) { f.titel = v; f.titel_kilde = v === null ? null : "haandvaerker"; }
          if (v === null) f.titel_bekraeftet = false;
        }
        if (har(ind, "titel_bekraeftet")) {
          const v = boolFelt(ind.titel_bekraeftet, "titel_bekraeftet");
          if (v && !nu("titel")) throw ugyldig("titel", "Skriv en titel, før den bekræftes.");
          f.titel_bekraeftet = v;
        }

        if (har(ind, "opgavetype")) {
          const v = ind.opgavetype;
          if (v === null) {
            Object.assign(f, { opgavetype_id: null, opgavetype_navn: null, opgavetype_enhed: null, opgavetype_kilde: null, opgavetype_bekraeftet: false });
            uenige = udenUenig(uenige, "opgavetype");
          } else if (v && typeof v === "object" && har(v, "id") && Object.keys(v).length === 1) {
            const { data: type, error } = await supabase.from("opgavetyper").select("id, navn, enhed_id")
              .eq("id", uuidFelt(v.id, "opgavetype.id")).eq("firm_id", firmId).maybeSingle();
            if (error) throw error;
            if (!type) throw new Afvist(404, { error: "ikke_fundet", besked: "Typen findes ikke." });
            const enhed = await brugbarEnhed(firmId, type.enhed_id);
            if (type.id !== t.opgavetype_id) {
              Object.assign(f, { opgavetype_id: type.id, opgavetype_navn: type.navn, opgavetype_enhed: enhed.navn, opgavetype_kilde: "haandvaerker" });
            }
          } else if (v && typeof v === "object" && Object.keys(v).every((k) => k === "navn" || k === "enhed_id")) {
            const navn = tekstFelt(v.navn === undefined ? null : v.navn, "opgavetype.navn", MAKS.typenavn);
            if (!navn) throw ugyldig("opgavetype.navn", "Typen skal have et navn.");
            const enhed = await brugbarEnhed(firmId, uuidFelt(v.enhed_id, "opgavetype.enhed_id"));
            // Findes typen allerede, bruges den; ellers står den som ny, til han bekræfter (#11).
            const { data: typer, error } = await supabase.from("opgavetyper").select("id, navn")
              .eq("firm_id", firmId).eq("enhed_id", enhed.id);
            if (error) throw error;
            const fundet = (typer || []).find((x) => typeNorm(x.navn) === typeNorm(navn));
            Object.assign(f, {
              opgavetype_id: fundet ? fundet.id : null, opgavetype_navn: fundet ? fundet.navn : navn,
              opgavetype_enhed: enhed.navn, opgavetype_kilde: "haandvaerker",
            });
          } else {
            throw ugyldig("opgavetype", 'opgavetype skal være null, { "id": … } eller { "navn": …, "enhed_id": … }.');
          }
        }
        if (har(ind, "opgavetype_bekraeftet")) {
          const v = boolFelt(ind.opgavetype_bekraeftet, "opgavetype_bekraeftet");
          if (v) {
            if (!nu("opgavetype_navn")) throw ugyldig("opgavetype", "Der er ingen opgavetype at bekræfte.");
            if (!nu("opgavetype_id")) {
              // En ny type oprettes først nu (#11). Enheden skal findes i forvejen.
              const { data: egne, error } = await supabase.from("enheder").select("id, navn").eq("firm_id", firmId).eq("aktiv", true);
              if (error) throw error;
              const fund = findEnhed(nu("opgavetype_enhed"), egne || []);
              let enhed = null;
              if (fund && fund.grundliste) enhed = await grundEnhed(fund.navn);
              else if (fund && !fund.ny) enhed = { id: fund.id, navn: fund.navn };
              if (!enhed) {
                throw new Afvist(422, { error: "enhed_findes_ikke", mangler: ["opgavetype.enhed"], besked: "Enheden findes ikke endnu. Tilføj den, før typen bekræftes." });
              }
              const { type } = await findEllerOpretType(firmId, nu("opgavetype_navn"), enhed.id);
              Object.assign(f, { opgavetype_id: type.id, opgavetype_navn: type.navn, opgavetype_enhed: enhed.navn });
            }
            uenige = udenUenig(uenige, "opgavetype");
          }
          f.opgavetype_bekraeftet = v;
        }

        if (har(ind, "maengde")) {
          const v = ind.maengde;
          if (v === null) {
            Object.assign(f, { maengde: null, maengde_faktorer: null, maengde_kilde: null, maengde_bekraeftet: false });
            uenige = udenUenig(uenige, "maengde");
          } else if (v && typeof v === "object" && Object.keys(v).length === 1 && har(v, "vaerdi")) {
            const vaerdi = antalFelt(v.vaerdi, "maengde.vaerdi");
            if (vaerdi === null) throw ugyldig("maengde.vaerdi", "Skriv mængden, eller send maengde: null.");
            Object.assign(f, { maengde: vaerdi, maengde_faktorer: null, maengde_kilde: "haandvaerker" });
          } else if (v && typeof v === "object" && Object.keys(v).length === 1 && har(v, "faktorer")) {
            if (!Array.isArray(v.faktorer)) throw ugyldig("maengde.faktorer", "faktorer skal være en liste.");
            v.faktorer.forEach((x, i) => antalFelt(x, `maengde.faktorer[${i}]`));
            const r = B.maengdeFraFaktorer(v.faktorer);
            Object.assign(f, { maengde: r.vaerdi, maengde_faktorer: v.faktorer, maengde_kilde: "haandvaerker" });
          } else {
            throw ugyldig("maengde", 'maengde skal være null, { "vaerdi": "…" } eller { "faktorer": ["…"] }.');
          }
        }
        if (har(ind, "maengde_bekraeftet")) {
          const v = boolFelt(ind.maengde_bekraeftet, "maengde_bekraeftet");
          if (v && nu("maengde") === null) throw ugyldig("maengde", "Der er ingen mængde at bekræfte.");
          if (v) uenige = udenUenig(uenige, "maengde");
          f.maengde_bekraeftet = v;
        }

        // Indledningen (kontrakt udkast 12): som titlen. Rettet eller bekræftet ->
        // tallene, formkontrollen markerede i den, gælder ikke længere.
        const udenTal = () => {
          const m = nu("forslag_markeringer");
          if (m && Array.isArray(m.indledning_tal_ikke) && m.indledning_tal_ikke.length) f.forslag_markeringer = { ...m, indledning_tal_ikke: [] };
        };
        if (har(ind, "indledning")) {
          const v = tekstFelt(ind.indledning, "indledning", MAKS.fritekst);
          if (v !== t.indledning) { f.indledning = v; f.indledning_kilde = v === null ? null : "haandvaerker"; udenTal(); }
          if (v === null) f.indledning_bekraeftet = false;
        }
        if (har(ind, "indledning_bekraeftet")) {
          const v = boolFelt(ind.indledning_bekraeftet, "indledning_bekraeftet");
          if (v && !nu("indledning")) throw ugyldig("indledning", "Der er ingen indledning at bekræfte.");
          f.indledning_bekraeftet = v;
          if (v) udenTal();
        }
        if (har(ind, "betingelser")) f.betingelser = tekstFelt(ind.betingelser, "betingelser", MAKS.fritekst);
        if (har(ind, "gyldig_dage")) {
          const v = ind.gyldig_dage;
          if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 365)) throw ugyldig("gyldig_dage", "Gyldighed er 1–365 dage.");
          f.gyldig_dage = v;
        }
        if (har(ind, "rabat")) Object.assign(f, rabatFelt(ind.rabat, "rabat"));

        let ops = [];
        if (har(ind, "koersel")) {
          const v = ind.koersel;
          if (!v || typeof v !== "object") throw ugyldig("koersel", "koersel skal være { form, … }.");
          const ukendte = Object.keys(v).filter((k) => !["form", "km", "sats_oere", "beloeb_oere"].includes(k));
          if (ukendte.length) throw ugyldig(`koersel.${ukendte[0]}`, `koersel kender ikke ${ukendte.join(", ")}.`);
          // Formen fryses i tilbuddet (#5). Mangler satsen eller beløbet, bruges
          // det, kladden allerede har (kopieret fra profilen) — profilen læses ikke igen.
          if (v.form === null) {
            Object.assign(f, { koersel_form: null, koersel_km: null });
          } else if (v.form === "km") {
            if (v.beloeb_oere != null) throw ugyldig("koersel.beloeb_oere", "Kørsel i km har intet fast beløb.");
            Object.assign(f, {
              koersel_form: "km",
              koersel_km: har(v, "km") ? antalFelt(v.km, "koersel.km") : t.koersel_km,
              koersel_sats_oere: har(v, "sats_oere") ? oereFelt(v.sats_oere, "koersel.sats_oere") : t.koersel_sats_oere,
              koersel_beloeb_oere: null,
            });
          } else if (v.form === "fast") {
            if (v.km != null || v.sats_oere != null) throw ugyldig("koersel.km", "Fast kørsel har ingen km eller sats.");
            Object.assign(f, {
              koersel_form: "fast", koersel_km: null, koersel_sats_oere: null,
              koersel_beloeb_oere: har(v, "beloeb_oere") ? oereFelt(v.beloeb_oere, "koersel.beloeb_oere") : t.koersel_beloeb_oere,
            });
          } else {
            throw ugyldig("koersel.form", 'koersel.form skal være null, "km" eller "fast".');
          }
          ops = koerselOps({ ...t, ...f }, linjer);
        }

        if (uenige !== (t.uenige || [])) f.uenige = uenige;
        return { felter: f, ops };
      });
      res.json({ ok: true, tilbud });
    } catch (e) { svarPaaFejl(res, e, "tilbud kunne ikke rettes"); }
  });

  /* ───────────────────────────────  LINJER  ───────────────────────────── */

  const LINJE_FELTER = ["rev", "type", "beskrivelse", "antal", "enhed", "enhedspris_oere", "rabat", "sortering"];
  const egenType = (v, felt) => {
    if (v === "koersel") throw ugyldig(felt, "Kørselslinjen styres af tilbuddets kørsel.", "koersel_styres_af_tilbuddet");
    if (!["arbejde", "materiale", "andet"].includes(v)) throw ugyldig(felt, 'type skal være "arbejde", "materiale" eller "andet".');
    return v;
  };
  async function enhedFelter(firmId, v, felt) {
    if (v === null) return { enhed_id: null, enhed_navn: null, enhed_ny: false };
    if (!v || typeof v !== "object" || Object.keys(v).length !== 1 || !har(v, "id")) {
      throw ugyldig(felt, 'enhed skal være null eller { "id": … }. En ny enhed tilføjes med POST /api/tilbud/enheder.');
    }
    const e = await brugbarEnhed(firmId, uuidFelt(v.id, `${felt}.id`));
    return { enhed_id: e.id, enhed_navn: e.navn, enhed_ny: false };
  }
  function sorteringFelt(v) {
    if (!Number.isInteger(v) || v < 0 || v > 100000) throw ugyldig("sortering", "sortering skal være et helt tal ≥ 0.");
    return v;
  }

  // Hans egen linje er hans og bekræftet (§2: ordret true på hans egne linjer).
  app.post("/api/tilbud/:id/linjer", idVagt("id"), spaerSkriv, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      const ind = pluk(req.body, LINJE_FELTER);
      const tilbud = await skriv(req, firmId, req.params.id, async (t, linjer) => {
        const type = egenType(ind.type, "type");
        const beskrivelse = tekstFelt(ind.beskrivelse === undefined ? null : ind.beskrivelse, "beskrivelse", MAKS.beskrivelse);
        if (!beskrivelse) throw ugyldig("beskrivelse", "Linjen skal have en beskrivelse.");
        const raekke = medFirma(firmId, {
          id: crypto.randomUUID(), tilbud_id: t.id, type, beskrivelse,
          sortering: har(ind, "sortering") ? sorteringFelt(ind.sortering) : linjer.reduce((m, l) => Math.max(m, l.sortering), 0) + 1,
          antal: har(ind, "antal") ? antalFelt(ind.antal, "antal") : null,
          enhedspris_oere: har(ind, "enhedspris_oere") ? oereFelt(ind.enhedspris_oere, "enhedspris_oere") : null,
          ...(har(ind, "enhed") ? await enhedFelter(firmId, ind.enhed, "enhed") : { enhed_id: null, enhed_navn: null, enhed_ny: false }),
          ...(har(ind, "rabat") ? rabatFelt(ind.rabat, "rabat") : { rabat_form: null, rabat_procent: null, rabat_beloeb_oere: null }),
          kilde: "haandvaerker", bekraeftet: true, ordret: true, uenig: null,
        });
        return { ops: [{ op: "insert", raekke }] };
      });
      res.status(201).json({ ok: true, tilbud });
    } catch (e) { svarPaaFejl(res, e, "linje kunne ikke oprettes"); }
  });

  app.patch("/api/tilbud/:id/linjer/:linjeId", idVagt("id", "linjeId"), spaerSkriv, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      const ind = pluk(req.body, LINJE_FELTER.concat(["bekraeftet"]));
      if (!Object.keys(ind).some((k) => k !== "rev")) {
        throw new Afvist(422, { error: "intet_at_rette", mangler: [], besked: "Der var ikke noget at rette." });
      }
      const tilbud = await skriv(req, firmId, req.params.id, async (t, linjer) => {
        const l = linjer.find((x) => x.id === req.params.linjeId);
        if (!l) throw new Afvist(404, { error: "ikke_fundet", besked: "Linjen findes ikke." });
        if (l.type === "koersel") throw ugyldig("type", "Kørselslinjen styres af tilbuddets kørsel.", "koersel_styres_af_tilbuddet");

        const f = {};
        if (har(ind, "type")) f.type = egenType(ind.type, "type");
        if (har(ind, "beskrivelse")) {
          const v = tekstFelt(ind.beskrivelse, "beskrivelse", MAKS.beskrivelse);
          if (!v) throw ugyldig("beskrivelse", "Linjen skal have en beskrivelse.");
          f.beskrivelse = v;
        }
        if (har(ind, "antal")) f.antal = antalFelt(ind.antal, "antal");
        if (har(ind, "enhedspris_oere")) f.enhedspris_oere = oereFelt(ind.enhedspris_oere, "enhedspris_oere");
        if (har(ind, "enhed")) Object.assign(f, await enhedFelter(firmId, ind.enhed, "enhed"));
        if (har(ind, "rabat")) Object.assign(f, rabatFelt(ind.rabat, "rabat"));
        if (har(ind, "sortering")) f.sortering = sorteringFelt(ind.sortering);

        // At ændre indholdet gør linjen til hans (§3). Kun en ændret beskrivelse
        // gør den ordret — de andre felter rører ikke ved, hvad modellen skrev.
        const indhold = ["type", "beskrivelse", "antal", "enhedspris_oere", "enhed_id", "enhed_navn", "rabat_form", "rabat_procent", "rabat_beloeb_oere"];
        const aendret = indhold.some((k) => har(f, k) && !samme(f[k], l[k]));
        if (aendret) f.kilde = "haandvaerker";
        if (har(f, "beskrivelse") && f.beskrivelse !== l.beskrivelse) f.ordret = true;

        // At skrive en pris er at bekræfte linjen (#3, B14).
        if (har(ind, "bekraeftet")) f.bekraeftet = boolFelt(ind.bekraeftet, "bekraeftet");
        if (f.enhedspris_oere !== undefined && f.enhedspris_oere !== null && !har(ind, "bekraeftet")) f.bekraeftet = true;

        const bekraeftes = har(f, "bekraeftet") ? f.bekraeftet : l.bekraeftet;
        if (bekraeftes) {
          // En ny enhed fra forslaget oprettes, når linjen bekræftes ("Tilføj enhed", §2).
          const ny = har(f, "enhed_ny") ? f.enhed_ny : l.enhed_ny;
          if (ny) {
            const navn = tekstFelt(har(f, "enhed_navn") ? f.enhed_navn : l.enhed_navn, "enhed", MAKS.enhedsnavn);
            if (!navn) throw ugyldig("enhed", "Enheden har intet navn. Vælg en enhed.");
            const { enhed } = await findEllerOpretEnhed(firmId, navn);
            Object.assign(f, { enhed_id: enhed.id, enhed_navn: enhed.navn, enhed_ny: false });
          }
          if (l.uenig !== null) f.uenig = null;
        }
        return { ops: [{ op: "update", id: l.id, felter: f }] };
      });
      res.json({ ok: true, tilbud });
    } catch (e) { svarPaaFejl(res, e, "linje kunne ikke rettes"); }
  });

  app.delete("/api/tilbud/:id/linjer/:linjeId", idVagt("id", "linjeId"), spaerSkriv, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      pluk(req.body, ["rev"]);
      const tilbud = await skriv(req, firmId, req.params.id, async (t, linjer) => {
        const l = linjer.find((x) => x.id === req.params.linjeId);
        if (!l) throw new Afvist(404, { error: "ikke_fundet", besked: "Linjen findes ikke." });
        if (l.type === "koersel") throw ugyldig("type", "Kørselslinjen fjernes ved at vælge ingen kørsel.", "koersel_styres_af_tilbuddet");
        return { ops: [{ op: "delete", id: l.id }] };
      });
      res.json({ ok: true, tilbud });
    } catch (e) { svarPaaFejl(res, e, "linje kunne ikke slettes"); }
  });

  /* ───────────────────────  OPGAVENS TITEL OG PROFIL  ─────────────────── */

  // Først ved accept skrives titlen på opgaven, leads.titel (§3, #12).
  app.post("/api/tilbud/:id/opgave-titel", idVagt("id"), spaerSkriv, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      const ind = pluk(req.body, ["rev", "handling"]);
      if (!["accepter", "afvis"].includes(ind.handling)) throw ugyldig("handling", 'handling skal være "accepter" eller "afvis".');
      const tilbud = await skriv(req, firmId, req.params.id, async (t) => {
        if (!t.opgave_titel_forslag || t.opgave_titel_forslag_status !== "afventer") {
          throw new Afvist(409, { error: "intet_forslag", besked: "Der er intet forslag til opgavens titel, der venter." });
        }
        if (ind.handling === "afvis") return { felter: { opgave_titel_forslag_status: "afvist" } };
        return {
          felter: { opgave_titel_forslag_status: "accepteret" },
          efter: async (nyRev) => {
            const { error } = await supabase.from("leads").update({ titel: renTitel(t.opgave_titel_forslag) })
              .eq("id", t.lead_id).eq("firm_id", firmId);
            if (error) {
              // Titlen nåede ikke opgaven: forslaget skal stå som ventende igen.
              await supabase.from("tilbud").update({ opgave_titel_forslag_status: "afventer", rev: nyRev + 1 })
                .eq("id", t.id).eq("firm_id", firmId).eq("rev", nyRev).eq("status", "kladde");
              throw error;
            }
          },
        };
      });
      res.json({ ok: true, tilbud });
    } catch (e) { svarPaaFejl(res, e, "opgavens titel kunne ikke skrives"); }
  });

  // Profilen ind igen og regnet om (#13). Arbejdslinjer, der står til den gamle
  // timepris, følger med; en linje, han selv har givet en anden pris, røres ikke.
  app.post("/api/tilbud/:id/hent-profil", idVagt("id"), spaerSkriv, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      pluk(req.body, ["rev"]);
      const tilbud = await skriv(req, firmId, req.params.id, async (t, linjer) => {
        const p = await profilKopi(firmId);
        const f = { ...p.felter };
        if (t.koersel_form === "km") f.koersel_sats_oere = p.kmSats;
        else if (t.koersel_form === "fast") f.koersel_beloeb_oere = p.fast;
        else { f.koersel_sats_oere = p.kmSats; f.koersel_beloeb_oere = p.fast; }
        const ops = [];
        if (t.timepris_oere !== f.timepris_oere) {
          for (const l of linjer) {
            if (l.type === "arbejde" && l.enhedspris_oere === t.timepris_oere) {
              ops.push({ op: "update", id: l.id, felter: { enhedspris_oere: f.timepris_oere } });
            }
          }
        }
        return { felter: f, ops: ops.concat(koerselOps({ ...t, ...f }, anvend(linjer, ops))) };
      });
      res.json({ ok: true, tilbud });
    } catch (e) { svarPaaFejl(res, e, "profilen kunne ikke hentes ind"); }
  });

  /* ─────────────────────────────  TRIN C  ────────────────────────────── */
  // (rpcFejl og tagRev bruges også af trin D nedenfor.)

  // Hvem gjorde det (historikkens created_by). null, hvis det ikke kan læses —
  // historikken skal skrives alligevel.
  async function brugerId(req) {
    try {
      const token = (req.headers.authorization || "").replace("Bearer ", "");
      if (!token || !supabase.auth || !supabase.auth.getUser) return null;
      const { data } = await supabase.auth.getUser(token);
      return data && data.user ? data.user.id : null;
    } catch (_) { return null; }
  }

  // Databasefunktionernes fejl -> svar. Teksterne er vores egne (ingen kundetekst).
  function rpcFejl(error) {
    const m = String(error.message || "");
    if (/tilbud_findes_ikke/.test(m)) return new Afvist(404, { error: "ikke_fundet", besked: "Den findes ikke." });
    if (/firma_profil_mangler/.test(m)) return new Afvist(422, { error: "kan_ikke_godkendes", mangler: ["firmaprofil mangler (Profil)"], besked: "Udfyld din profil, før tilbuddet godkendes." });
    if (/tilbud_mangler:/.test(m)) {
      return new Afvist(422, { error: "kan_ikke_godkendes", mangler: m.split("tilbud_mangler:")[1].split(";").map((x) => x.trim()).filter(Boolean), besked: "Tilbuddet kan ikke godkendes endnu." });
    }
    if (/summer_passer_ikke/.test(m)) {
      // Koden og databasen regner ikke ens. Det må aldrig ske — og sker det, skal
      // det ses med det samme (#14), ikke rettes i stilhed.
      const e = new Error("summer_passer_ikke"); e.code = "summer_passer_ikke";
      console.error("❌ godkend: databasens genregning er uenig med koden");
      sendError(e);
      return new Afvist(422, { error: "summer_passer_ikke", mangler: ["summer"], besked: "Tallene kunne ikke bekræftes. Tilbuddet er ikke godkendt. Prøv at rette en linje og godkend igen — ellers kontakt os." });
    }
    if (/tilbud_ikke_kladde|haendelse_ikke_tilladt|tilbud_statusskift|tilbud_laast/.test(m)) {
      return new Afvist(409, { error: "haendelse_ikke_tilladt", besked: "Det kan ikke lade sig gøre i tilbuddets nuværende status." });
    }
    return error;
  }

  // Tag rev (rev -> rev + 1) med rev som nøgle, før en databasefunktion kaldes.
  // Så kan en rettelse, han ikke har set, ikke nå at komme imellem: den, der
  // kommer bagefter med det gamle rev, får 409.
  async function tagRev(firmId, t, rev) {
    const { data, error } = await supabase.from("tilbud").update({ rev: rev + 1 })
      .eq("id", t.id).eq("firm_id", firmId).eq("rev", rev).eq("status", t.status)
      .select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw await revFejl(firmId, t.id);
  }

  // Godkend (§6, #2, #7). Koden tjekker først (læselig liste til ham), så
  // tjekker og regner databasen igen og tildeler nummeret (godkend_tilbud).
  app.post("/api/tilbud/:id/godkend", idVagt("id"), spaerSkriv, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      pluk(req.body, ["rev"]);
      const rev = laesRev(req);
      const { t, linjer } = await hentAlt(firmId, req.params.id);
      if (t.status !== "kladde" || t.rev !== rev) throw await revFejl(firmId, t.id);
      const { data: lead, error: lE } = await supabase.from("leads").select("id, name, address")
        .eq("id", t.lead_id).eq("firm_id", firmId).maybeSingle();
      if (lE) throw lE;
      const mangler = hvadMangler(t, linjer, lead);
      if (mangler.length) {
        throw new Afvist(422, { error: "kan_ikke_godkendes", mangler, besked: "Tilbuddet kan ikke godkendes endnu." });
      }
      // Summerne skal være regnet ud fra det, der står nu (efterregn retter en
      // afbrudt skrivning). Databasen regner selv igen og afviser ved afvigelse.
      const { summer } = B.regnTilbud(somBeregningTilbud(t), sorterLinjer(linjer).map(somBeregningLinje));
      const skal = Object.keys(summer).some((k) => t[k] !== summer[k]);
      const { data: taget, error: tE } = await supabase.from("tilbud")
        .update({ ...(skal ? summer : {}), rev: rev + 1 })
        .eq("id", t.id).eq("firm_id", firmId).eq("rev", rev).eq("status", "kladde")
        .select("id").maybeSingle();
      if (tE) throw tE;
      if (!taget) throw await revFejl(firmId, t.id);
      const { error } = await supabase.rpc("godkend_tilbud", { p_tilbud: t.id, p_firm: firmId, p_bruger: await brugerId(req) });
      if (error) throw rpcFejl(error);
      res.json({ ok: true, tilbud: await fuld(firmId, t.id) });
    } catch (e) { svarPaaFejl(res, e, "tilbud kunne ikke godkendes"); }
  });

  // Hændelserne (#1, #2) og fortryd (§1). Statusskiftet og historikken skrives
  // af tilbud_haendelse() i databasen; her tjekkes kun ejerskab, rev og om
  // skiftet overhovedet giver mening, så svaret er læseligt.
  const HAENDELSER = {
    sendt:      { fra: ["godkendt"], db: "sendt" },
    accepteret: { fra: ["godkendt", "sendt"], db: "accepteret" },
    fortryd:    { fra: ["sendt", "accepteret"], db: "fortrudt" },
  };
  for (const [navn, h] of Object.entries(HAENDELSER)) {
    app.post(`/api/tilbud/:id/${navn}`, idVagt("id"), spaerSkriv, async (req, res) => {
      const firmId = await firma(req, res); if (!firmId) return;
      try {
        pluk(req.body, ["rev"]);
        const rev = laesRev(req);
        const t = await hentEgenRaekke(supabase, "tilbud", req.params.id, firmId, "*");
        if (t.rev !== rev) throw await revFejl(firmId, t.id);
        if (!h.fra.includes(t.status)) {
          throw new Afvist(409, {
            error: "haendelse_ikke_tilladt", status: t.status,
            besked: t.status === "kladde" ? "Tilbuddet skal godkendes først." : "Det kan ikke lade sig gøre i tilbuddets nuværende status.",
            tilbud: await fuld(firmId, t.id),
          });
        }
        await tagRev(firmId, t, rev);
        const { error } = await supabase.rpc("tilbud_haendelse", { p_tilbud: t.id, p_firm: firmId, p_haendelse: h.db, p_bruger: await brugerId(req) });
        if (error) throw rpcFejl(error);
        res.json({ ok: true, tilbud: await fuld(firmId, t.id) });
      } catch (e) { svarPaaFejl(res, e, `tilbud ${navn} kunne ikke markeres`); }
    });
  }

  // Ny version (§6, #7, #13, #15): ny kladde i samme kæde. Profilen kopieres,
  // som den er NU; indholdet, linjerne og kilderne kopieres fra den version,
  // den skal erstatte. Den gamle version røres ikke — den bliver først
  // `erstattet`, når den nye godkendes (godkend_tilbud).
  app.post("/api/tilbud/:id/ny-version", idVagt("id"), spaerSkriv, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    let nyId = null;
    try {
      pluk(req.body, ["rev"]);
      const rev = laesRev(req);
      const { t, linjer } = await hentAlt(firmId, req.params.id);
      if (t.rev !== rev) throw await revFejl(firmId, t.id);
      if (!["godkendt", "sendt", "accepteret"].includes(t.status)) {
        throw new Afvist(409, { error: "haendelse_ikke_tilladt", status: t.status, besked: t.status === "kladde" ? "En kladde rettes direkte; der laves ikke en ny version af den." : "Der kan kun laves en ny version af den gældende udgave." });
      }
      const { data: kaede, error: kE } = await supabase.from("tilbud").select("id, version, status")
        .eq("firm_id", firmId).eq("kaede_id", t.kaede_id);
      if (kE) throw kE;
      const kladde = (kaede || []).find((x) => x.status === "kladde");
      if (kladde) return res.status(409).json({ error: "kladde_findes", tilbud_id: kladde.id, besked: "Der er allerede en ny version under arbejde." });
      if ((kaede || []).some((x) => x.version > t.version)) {
        throw new Afvist(409, { error: "haendelse_ikke_tilladt", besked: "Der findes en nyere version. Lav den nye version ud fra den." });
      }

      const p = await profilKopi(firmId);
      const felter = {
        ...p.felter,
        lead_id: t.lead_id, kaede_id: t.kaede_id, version: t.version + 1,
        titel: t.titel, titel_kilde: t.titel_kilde, titel_bekraeftet: t.titel_bekraeftet,
        opgavetype_id: t.opgavetype_id, opgavetype_navn: t.opgavetype_navn, opgavetype_enhed: t.opgavetype_enhed,
        opgavetype_kilde: t.opgavetype_kilde, opgavetype_bekraeftet: t.opgavetype_bekraeftet,
        maengde: talTekst(t.maengde), maengde_faktorer: t.maengde_faktorer == null ? null : t.maengde_faktorer.map(talTekst),
        maengde_kilde: t.maengde_kilde, maengde_bekraeftet: t.maengde_bekraeftet,
        uenige: t.uenige || [],
        indledning: t.indledning,
        // En kopieret indledning uden mærke er hans (fra før kontraktens udkast 12).
        indledning_kilde: t.indledning_kilde || (t.indledning ? "haandvaerker" : null),
        indledning_bekraeftet: t.indledning_bekraeftet,
        rabat_form: t.rabat_form, rabat_procent: talTekst(t.rabat_procent), rabat_beloeb_oere: t.rabat_beloeb_oere,
        // Kørslens form og km hører til opgaven; satsen og beløbet til profilen.
        koersel_form: t.koersel_form, koersel_km: talTekst(t.koersel_km),
        koersel_sats_oere: t.koersel_form === "fast" ? null : p.kmSats,
        koersel_beloeb_oere: t.koersel_form === "km" ? null : p.fast,
        kilde_beskrivelse_kopi: t.kilde_beskrivelse_kopi, kilde_noter_kopi: t.kilde_noter_kopi, kilder_lavet_at: t.kilder_lavet_at,
      };
      nyId = crypto.randomUUID();
      const nyT = { ...felter, id: nyId, firm_id: firmId };

      // Linjerne kopieres (ikke kørslen, den laves igen ud fra den nye sats).
      // Arbejdslinjer, der stod til den gamle timepris, følger den nye (#13).
      let nyeLinjer = sorterLinjer(linjer).filter((l) => l.type !== "koersel").map((l) => ({
        id: crypto.randomUUID(), tilbud_id: nyId, firm_id: firmId,
        sortering: l.sortering, type: l.type, beskrivelse: l.beskrivelse, antal: talTekst(l.antal),
        enhed_id: l.enhed_id, enhed_navn: l.enhed_navn, enhed_ny: l.enhed_ny,
        enhedspris_oere: l.type === "arbejde" && l.enhedspris_oere === t.timepris_oere ? felter.timepris_oere : l.enhedspris_oere,
        rabat_form: l.rabat_form, rabat_procent: talTekst(l.rabat_procent), rabat_beloeb_oere: l.rabat_beloeb_oere,
        kilde: l.kilde, bekraeftet: l.bekraeftet, ordret: l.ordret, uenig: l.uenig,
      }));
      nyeLinjer = anvend(nyeLinjer, koerselOps(nyT, nyeLinjer));
      const sorteret = sorterLinjer(nyeLinjer);
      sorteret.forEach((l, i) => Object.assign(l, medTal(l, i + 1)));
      const { summer } = B.regnTilbud(somBeregningTilbud(nyT), sorteret.map(somBeregningLinje));

      const { error: tE } = await supabase.from("tilbud").insert(medFirma(firmId, { id: nyId, ...felter, ...summer }));
      if (tE && tE.code === "23505") { nyId = null; return res.status(409).json({ error: "kladde_findes", besked: "Der er allerede en ny version under arbejde." }); }
      if (tE) { nyId = null; throw tE; }
      if (sorteret.length) {
        const { error } = await supabase.from("tilbud_linjer").insert(sorteret);
        if (error) throw error;
      }
      const { data: kilder, error: kiE } = await supabase.from("tilbud_kilder")
        .select("referat_id, nr, dato, kilde, tekst_kopi").eq("tilbud_id", t.id).eq("firm_id", firmId);
      if (kiE) throw kiE;
      if ((kilder || []).length) {
        const { error } = await supabase.from("tilbud_kilder")
          .insert(kilder.map((k) => medFirma(firmId, { ...k, tilbud_id: nyId, lead_id: t.lead_id })));
        if (error) throw error;
      }
      const id = nyId; nyId = null;
      res.status(201).json({ ok: true, tilbud: await fuld(firmId, id) });
    } catch (e) {
      // Ingen halv kladde: den nye version slettes igen, så længe den er kladde.
      if (nyId) await supabase.from("tilbud").delete().eq("id", nyId).eq("firm_id", firmId).eq("status", "kladde");
      svarPaaFejl(res, e, "ny version kunne ikke oprettes");
    }
  });

  /* ─────────────────────────────  TRIN D  ────────────────────────────── */

  // Referencetal (#9, #16, kontrakt §6): KUN firmaets egne accepterede tilbud
  // af typen (S21). Kr. pr. enhed for arbejde og materialer hver for sig, efter
  // linjerabat og før rabatten på hele tilbuddet; den samlede rabat for sig.
  // Ingen bundgrænse for egne tal — antallet står ved siden af.
  app.get("/api/tilbud/referencetal", spaerLaes, async (req, res) => {
    const firmId = await firma(req, res); if (!firmId) return;
    try {
      const typeId = uuidFelt(req.query.opgavetype_id, "opgavetype_id");
      const { data: type, error } = await supabase.from("opgavetyper").select("id, navn, enhed_id")
        .eq("id", typeId).eq("firm_id", firmId).maybeSingle();
      if (error) throw error;
      if (!type) throw new Afvist(404, { error: "ikke_fundet", besked: "Typen findes ikke." });
      const enhed = await brugbarEnhed(firmId, type.enhed_id);
      const { data: rk, error: rE } = await supabase.from("tilbud")
        .select("maengde, arbejde_oere, materialer_oere, foer_samlet_rabat_oere, samlet_rabat_oere")
        .eq("firm_id", firmId).eq("opgavetype_id", type.id).eq("status", "accepteret");
      if (rE) throw rE;
      const pr = (rk || []).filter((x) => x.maengde !== null && Number(x.maengde) > 0).map((x) => {
        const milli = B.tilTusindedele(talTekst(x.maengde), "maengde");
        return {
          arbejde: Number(B.divRund(BigInt(x.arbejde_oere) * 1000n, milli)),
          materialer: Number(B.divRund(BigInt(x.materialer_oere) * 1000n, milli)),
          // hundrededele af en procent (heltal); vises med to decimaler
          rabat: x.foer_samlet_rabat_oere > 0 ? Number(B.divRund(BigInt(x.samlet_rabat_oere) * 10000n, BigInt(x.foer_samlet_rabat_oere))) : 0,
        };
      });
      // Heltal ind; medianen af et lige antal er gennemsnittet af de to midterste, afrundet.
      const spænd = (tal) => {
        if (!tal.length) return null;
        const s = tal.slice().sort((a, b) => a - b), n = s.length;
        const median = n % 2 ? s[(n - 1) / 2] : Number(B.divRund(BigInt(s[n / 2 - 1]) + BigInt(s[n / 2]), 2n));
        return { min: s[0], median, max: s[n - 1] };
      };
      const procent = (x) => (x === null ? null : { min: (x.min / 100).toFixed(2), median: (x.median / 100).toFixed(2), max: (x.max / 100).toFixed(2) });
      res.json({
        ok: true,
        opgavetype: { id: type.id, navn: type.navn, enhed: enhed.navn },
        antal: pr.length,
        arbejde_oere_pr_enhed: spænd(pr.map((x) => x.arbejde)),
        materialer_oere_pr_enhed: spænd(pr.map((x) => x.materialer)),
        samlet_rabat_procent: procent(spænd(pr.map((x) => x.rabat))),
      });
    } catch (e) { svarPaaFejl(res, e, "referencetal kunne ikke hentes"); }
  });

  // Forslaget (kontrakt §4) — kun med TILBUDSFORSLAG_AKTIV (nødbremsen, B9).
  // Spor 2's filer hentes først her, så et slukket flag aldrig læser dem.
  if (TILBUDSFORSLAG_AKTIV) {
    const P = require("../../prompts/tilbudslinjer");
    const { laesSvar } = require("../../tilbudslinjer-format");
    const kvote = require("../../kvote");
    const tekstmodel = require("../../tekst-adapter");
    const F = require("./forslag");
    // Kontrakt §7 og måledokumentet: det målte loft, sat af Ann 28/11. Kørslen
    // 28/11 (2026-11-28-08-49-03) lagde præcis 10.000 tegn kildetekst ind
    // (beskrivelse, noter og referater, som F.inputTegn tæller): højst 10,09 øre
    // og 5,2 s (G8 højst 25 øre pr. kald, G9 højst 40 s). Ved 5.242 tegn (26/11):
    // 8,2 øre og 6,1 s. Hæves kun efter en ny måling ved det højere tal.
    const MAKS_INPUT_TEGN = 10000;
    const TEGN_PR_TOKEN = 3;         // bevidst lavt for dansk: overvurderer prisen, aldrig under
    const MAKS_TOKENS_UD = 3000;     // som målingen (maal-tilbudslinjer.js)

    // Et rpc-kald, der returnerer én værdi: PostgREST giver værdien selv.
    const skalar = (d) => (Array.isArray(d) ? (d.length ? Object.values(d[0])[0] : null) : d);

    async function bogfoer(firmId, x) {
      if (!(typeof x.prisOere === "number" && x.prisOere > 0)) return;
      try {
        await kvote.bogfoer({ firmId, formaal: "tilbud", leverandoer: x.leverandoer, model: x.model,
          enhed: "token", maengde: (x.tokensInd || 0) + (x.tokensUd || 0), prisOere: x.prisOere }, supabase);
      } catch (e) {
        console.error("❌ tilbudsforslag: kaldet kunne ikke bogfoeres:", e.kode || e.name);
        sendError(e);
      }
    }

    app.post("/api/tilbud/tilbudslinjer", spaerSkriv, async (req, res) => {
      const firmId = await firma(req, res); if (!firmId) return;
      let laast = null;
      try {
        // 1. Kun id'er fra klienten, aldrig tekst (§4).
        const ind = pluk(req.body, ["tilbud_id", "referat_ids"]);
        const tilbudId = uuidFelt(ind.tilbud_id, "tilbud_id");
        const ids = ind.referat_ids === undefined ? [] : ind.referat_ids;
        if (!Array.isArray(ids) || ids.length > 50) throw ugyldig("referat_ids", "referat_ids skal være en liste med højst 50 id'er.");
        const valgte = [...new Set(ids.map((x, i) => uuidFelt(x, `referat_ids[${i}]`)))];

        const t = await hentEgenRaekke(supabase, "tilbud", tilbudId, firmId, "id, lead_id, status");
        if (t.status !== "kladde") throw new Afvist(409, { error: "tilbud_laast", besked: "Tilbuddet er godkendt og kan ikke ændres. Lav en ny version." });
        const { data: lead, error: lE } = await supabase.from("leads")
          .select("id, task, notes, created_at, oprettet_via").eq("id", t.lead_id).eq("firm_id", firmId).maybeSingle();
        if (lE) throw lE;
        if (!lead) throw new Afvist(404, { error: "ikke_fundet", besked: "Den findes ikke." });
        // Hvert referat skal høre til netop denne opgave og dette firma (IDOR).
        const { data: opgavens, error: rE } = await supabase.from("referater")
          .select("id, lead_id, indhold, moede_dato, kilde, created_at").eq("firm_id", firmId).eq("lead_id", t.lead_id);
        if (rE) throw rE;
        const paaOpgaven = new Map((opgavens || []).map((r) => [r.id, r]));
        if (valgte.some((id) => !paaOpgaven.has(id))) throw new Afvist(404, { error: "ikke_fundet", besked: "Et af referaterne findes ikke på denne opgave." });

        // 2. Serveren henter selv teksterne og bygger data (§4).
        const typer = await firmaetsTyper(firmId);
        const { data: grund, error: gE } = await supabase.from("enheder").select("id, navn").is("firm_id", null).eq("aktiv", true);
        if (gE) throw gE;
        const { data: egne, error: eE } = await supabase.from("enheder").select("id, navn").eq("firm_id", firmId).eq("aktiv", true);
        if (eE) throw eE;
        const { data: brugte, error: bE } = await supabase.from("tilbud_linjer").select("enhed_id").eq("firm_id", firmId).not("enhed_id", "is", null);
        if (bE) throw bE;
        const brug = new Map();
        for (const b of brugte || []) brug.set(b.enhed_id, (brug.get(b.enhed_id) || 0) + 1);
        const egneMest = (egne || []).slice().sort((a, b) => (brug.get(b.id) || 0) - (brug.get(a.id) || 0) || a.navn.localeCompare(b.navn, "da")).slice(0, 30);
        const { data, kilder } = F.bygData({
          lead, referater: valgte.map((id) => paaOpgaven.get(id)),
          typer: typer.map((x) => ({ navn: x.navn, enhed: x.enhed.navn })),
          enheder: GRUNDLISTE.concat(egneMest.map((e) => e.navn)),
        });

        // Loftet på input i alt (§7). Intet skæres stille af: klienten tilbyder at fravælge referater (B8).
        const tegn = F.inputTegn(data);
        if (tegn > MAKS_INPUT_TEGN) {
          return res.status(413).json({
            error: "for_meget_input", tegn, loft: MAKS_INPUT_TEGN,
            referater: kilder.map((k) => ({ id: k.id, nr: k.nr, tegn: k.tekst.length })),
            besked: "Opgavens tekster er for lange til ét forslag. Fravælg et eller flere referater, og prøv igen.",
          });
        }
        let prompt;
        try { prompt = P.bygTilbudslinjePrompt(data); }
        catch (e) {
          if (e instanceof P.ValideringsFejl) throw new Afvist(422, { error: "ugyldige_data", mangler: ["kilder"], besked: e.message });
          throw e;
        }
        let maxPrisOere;
        try {
          maxPrisOere = 2 * tekstmodel.prisOereTilbudslinjer(Math.ceil((prompt.system.length + prompt.user.length) / TEGN_PR_TOKEN), MAKS_TOKENS_UD);
        } catch (e) {
          console.error("❌ tilbudsforslag: modellen er ikke sat op:", e.kode);
          sendError(e);
          return res.status(503).json({ error: "forslag_utilgaengeligt", besked: "Forslaget kan ikke laves lige nu. Du kan stadig lave tilbuddet selv." });
        }

        // Kører der allerede et forslag? (§4 trin 1)
        const { data: st, error: sE } = await supabase.rpc("tilbud_forslag_start", { p_tilbud: t.id, p_firm: firmId });
        if (sE) throw sE;
        const start = skalar(st);
        if (start === "koerer") throw new Afvist(409, { error: "forslag_koerer", besked: "Der laves allerede et forslag til tilbuddet. Vent et øjeblik." });
        if (start === "ikke_kladde") throw new Afvist(409, { error: "tilbud_laast", besked: "Tilbuddet er godkendt og kan ikke ændres. Lav en ny version." });
        if (start !== "ok") throw new Afvist(404, { error: "ikke_fundet", besked: "Den findes ikke." });
        laast = t.id;

        // 3. Kvoten FØR kaldet (Ø2, puljen tilbud).
        let dom;
        try { dom = await kvote.tjek({ firmId, maxPrisOere, pulje: "tilbud" }, supabase); }
        catch (e) {
          console.error("❌ tilbudsforslag: kvoten kunne ikke laeses:", e.kode);
          sendError(e);
          throw new Afvist(503, { error: "kvote_utilgaengelig", besked: "Forslaget kan ikke laves lige nu. Du kan stadig lave tilbuddet selv." });
        }
        if (!dom.tilladt) {
          const h = new Error(`Kvoteafvisning (tilbud): ${dom.aarsag}`); h.name = "Kvoteafvisning";
          console.warn("⚠️ KVOTE afviste tilbudsforslag", { firmId, aarsag: dom.aarsag });
          sendError(h);
          throw new Afvist(429, { error: dom.aarsag, besked: dom.besked, naesteNulstilling: dom.naesteNulstilling });
        }

        // 4. Kaldet — og ét nyt forsøg ved et ugyldigt svar. Hvert kald bogføres, også et ubrugeligt.
        // G9: højst ét minut i alt for begge forsøg (forslag.js, FORSLAG_FRIST_MS).
        let fundet = null, retry = false;
        const sum = { ms: 0, tokensInd: 0, tokensUd: 0, prisOere: 0 };
        const t0 = Date.now();
        for (let forsoeg = 1; forsoeg <= 2 && !fundet; forsoeg++) {
          // Fristen læses fra F ved hvert kald, så prøven kan sætte den ned i sin egen
          // serverproces (hjaelp-haengende-model.js). Prod læser altid 60 s.
          const frist = F.tidTilForsoeg(t0, Date.now(), F.FORSLAG_FRIST_MS, F.MIN_FORSOEG_MS);
          if (!frist) break;   // for lidt tid til et nyt forsøg: behandles som et ubrugeligt svar
          let r;
          try { r = await tekstmodel.tilbudslinjer({ system: prompt.system, bruger: prompt.user, timeoutMs: frist }); }
          catch (e) {
            await bogfoer(firmId, e);   // et afbrudt kald har ingen pris: intet bogføres
            if (e.kode === "tilbudslinjer_tom" && forsoeg === 1) { retry = true; continue; }
            console.error("❌ tilbudsforslag: kaldet fejlede:", e.kode, e.timeout ? "timeout" : (e.status || ""));
            sendError(e);
            if (e.timeout) throw new Afvist(503, { error: "forslag_tog_for_lang_tid", besked: "Det tog for lang tid. Prøv igen." });
            throw new Afvist(503, { error: "forslag_fejlede", besked: "Forslaget kunne ikke laves lige nu. Prøv igen, eller lav tilbuddet selv." });
          }
          await bogfoer(firmId, r);
          sum.ms += r.ms || 0; sum.tokensInd += r.tokensInd || 0; sum.tokensUd += r.tokensUd || 0; sum.prisOere += r.prisOere || 0;
          const l = laesSvar(r.raat, data);
          if (l.ok) {
            fundet = { obj: l.obj, model: r.model, indledningTalIkke: l.indledningTalIkke || [] };
            // Kun tal (B6): hvor meget formkontrollen markerede og rensede (spor 2, 22/11 og 24/11).
            console.info("tilbudsforslag", { forsoeg, ordret: l.ordret || null, renset: l.renset || null, noterRegel: l.noterRegel || null,
              indledningTalIkke: (l.indledningTalIkke || []).length, advarsel: !!(l.obj && l.obj.advarsel), fjernedeTags: prompt.fjernedeTags || 0 });
          }
          else {
            // B6: kun antallet og feltstierne' første led — aldrig svaret eller kildeteksten.
            console.warn("⚠️ tilbudsforslag formfejl", { forsoeg, antal: l.fejl.length, felter: l.fejl.map((f) => String(f).split(/[ :[]/)[0]).slice(0, 10) });
            if (forsoeg === 1) retry = true;
          }
        }
        if (!fundet) {
          const e = new Error("tilbudsforslag_ubrugeligt"); e.name = "Tilbudsforslag";
          sendError(e);
          throw new Afvist(502, { error: "forslag_ubrugeligt", besked: "Forslaget kom tilbage i en form, vi ikke kunne bruge. Prøv igen, eller lav tilbuddet selv." });
        }

        // 5. Omsæt og skriv gennem den låsende funktion (§4 trin 5 og 6).
        const forslag = F.normaliser({
          obj: fundet.obj, data, kilder,
          typer: typer.map((x) => ({ id: x.id, navn: x.navn, enhed: x.enhed.navn })),
          egne: egne || [], grund: grund || [],
          log: { model: fundet.model, prompt_version: P.TILBUDSLINJER_PROMPT_VERSION, retry,
            svartid_ms: sum.ms, tokens_ind: sum.tokensInd, tokens_ud: sum.tokensUd },
          indledningTalIkke: fundet.indledningTalIkke,
          fjernedeTags: prompt.fjernedeTags,
        });
        const linjer = await hentLinjer(firmId, t.id);
        const bliver = linjer.filter((l) => !(l.kilde === "model" && !l.bekraeftet)).length;
        if (bliver + forslag.linjer.length > MAKS.linjer) {
          throw ugyldig("linjer", `Forslaget ville give over ${MAKS.linjer} linjer. Slet nogle linjer, og prøv igen.`, "for_mange");
        }
        const { data: nyRev, error: wE } = await supabase.rpc("tilbud_skriv_forslag", { p_tilbud: t.id, p_firm: firmId, p_forslag: forslag });
        if (wE) throw rpcFejl(wE);
        laast = null;   // funktionen har ryddet markeringen
        await efterregn(firmId, t.id, Number(skalar(nyRev)));
        if (kvote.krydsedeVarsel && kvote.krydsedeVarsel(dom.forbrugtOere, sum.prisOere, dom.loftOere)) {
          const v = new Error(`Kvotevarsel (tilbud): firmaet har passeret ${kvote.VARSEL_ANDEL * 100} % af sit loft`);
          v.name = "Kvotevarsel"; sendError(v);
        }
        res.json({ ok: true, tilbud: await fuld(firmId, t.id) });
      } catch (e) {
        // Markeringen ryddes FØR svaret sendes — ellers kan et nyt forsøg lige
        // bagefter få "kører allerede". Fejler oprydningen, rydder fristen den.
        if (laast) {
          try { await supabase.rpc("tilbud_forslag_slip", { p_tilbud: laast, p_firm: firmId }); }
          catch (_) { /* fristen (180 sek.) rydder den alligevel */ }
        }
        svarPaaFejl(res, e, "tilbudsforslag fejlede");
      }
    });
  }

  return TILBUDSFORSLAG_AKTIV ? RUTER.concat(["/api/tilbud/tilbudslinjer"]) : RUTER;
};

// Til prøverne: de rene funktioner uden database.
module.exports._intern = { hvadMangler, tilbudTilKlient, rabatFelt, kronerTilOere, talTekst, laesRev };
