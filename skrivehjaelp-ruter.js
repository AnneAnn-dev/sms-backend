// skrivehjaelp-ruter.js — Skrivehjælp (Fase 4, T2): tre udkast-ruter, profil og kvote.
// Indlæses fra server.js bag flaget SKRIVEHJAELP_AKTIV, EFTER modulspærren:
//   app.use("/api/skrivehjaelp/svar", kraevModul(supabase, "svar"));
//   app.use(["/api/skrivehjaelp/opslag", "/api/skrivehjaelp/kommentar"], kraevModul(supabase, "facebook"));
//   require("./skrivehjaelp-ruter")(app, supabase);
//
//   GET  /api/skrivehjaelp/profil     branche, afsendernavn, valgmuligheder og situationer
//   POST /api/skrivehjaelp/profil     { branche, afsenderNavn, afsenderTelefon }  (spørges ved første brug)
//   GET  /api/skrivehjaelp/kvote      hvad er der tilbage i puljerne svar og facebook
//   POST /api/skrivehjaelp/svar       { situation, felter, andet, kanal, tone, besked, variant?, nuvaerendeUdkast? }
//   POST /api/skrivehjaelp/opslag     { idea, goal, platform }
//   POST /api/skrivehjaelp/kommentar  { comment, raw }
//
// SAMME VÆRN SOM REFERATET (routes/tilbud), i samme rækkefølge:
//   1. firm_id fra tokenet, aldrig fra kroppen.
//   2. Prompten bygges på serveren (S6). Ugyldigt input og et manglende afgørende felt
//      afvises med 400 FØR kvoten og kaldet (lag 2): det koster intet.
//   3. kvote.tjek med puljen og et beregnet værste tilfælde for TO kald (ét nyt forsøg).
//   4. Hvert kald bogføres, også et betalt kald, der gav et ubrugeligt svar.
//   5. skrivehjaelp-format.js dømmer formen; forkert form prøves én gang til, aldrig mere.
//
// Ingen tekst i logs: kundens besked, firmaets fakta og udkastet er persondata.
// Kun formål, kode og tal logges.

"use strict";

const { sendError } = require("@appsignal/nodejs");
const { firmIdFromToken } = require("./auth");
const { aktiveModuler } = require("./moduler");
const P = require("./prompts/skrivehjaelp");
const { PACKS, sectorOf } = require("./prompts/skrivehjaelp-pakker");
const F = require("./skrivehjaelp-format");
const standardTekstmodel = require("./tekst-adapter");
const kvote = require("./kvote");

// Faste kaldparametre, som i T1-målingen (maal-skrivehjaelp.js). "Begge" giver fire tekster.
const PARAM = {
  svar:      { temperatur: 0.3, maksTokens: 800 },
  opslag:    { temperatur: 0.8, maksTokens: 1500 },
  kommentar: { temperatur: 0.5, maksTokens: 800 },
};
const MAKS_TOKENS_BEGGE = 2500;
const TIMEOUT_MS = 30000;           // målt 5/11: enkelte kald tog 11-25 s
const TEGN_PR_TOKEN = 3;            // overvurderer tokens med vilje (dansk ligger nær 4)
const FORMAAL = { svar: "skrivehjaelp_svar", kommentar: "skrivehjaelp_kommentar", opslag: "skrivehjaelp_opslag" };
const PULJE = { svar: "svar", kommentar: "svar", opslag: "facebook" };
const MAKS_NAVN = 60;
// Ann 8/11: en besked ÉN gang, når et udkast får dagens forbrug i puljen over 90 %.
// Krydsningen regnes ud af forbruget før kaldet og prisen bagefter; intet gemmes.
const DAGSVARSEL_ANDEL = 0.9;
function krydsedeDagsvarsel(foerOere, prisOere, loftOere) {
  if (!(loftOere > 0)) return false;
  const g = loftOere * DAGSVARSEL_ANDEL;
  return foerOere < g && foerOere + Number(prisOere || 0) >= g;
}
// Samme form som CHECK-reglen i migrationen: valgfrit +, 8-20 cifre og mellemrum.
const TELEFON_RE = /^\+?[0-9 ]{8,20}$/;

// Brancherne er fagene i Annes pakker. Den generelle pakke mangler endnu (Anne);
// indtil da kører et ukendt fag på Håndværk-pakken (sectorOf).
const BRANCHER = Object.values(PACKS).map((p) => ({ gruppe: p.label, fag: [...p.trades] }));
const ALLE_FAG = BRANCHER.flatMap((b) => b.fag);

const FEJLKODER = {
  referat_konfiguration: "skrivehjaelp_ukonfigureret",
  skrivehjaelp_konfiguration: "skrivehjaelp_ukonfigureret",
  kvote_konfiguration: "kvote_ukonfigureret",
  kvote_laesning: "kvote_utilgaengelig",
};

function situationerFor(fag) {
  const pack = PACKS[sectorOf(fag)];
  return Object.entries(pack.situations).map(([id, s]) => ({
    id, label: s.label, gruppe: s.group || null,
    afgoerende: Object.prototype.hasOwnProperty.call(P.AFGOERENDE, id) ? P.AFGOERENDE[id] : null,
    felter: s.fields.map((f) => ({ id: f.id, label: f.label, type: f.type, options: f.options || null, placeholder: f.placeholder || null })),
  }));
}

module.exports = function skrivehjaelpRuter(app, supabase, { tekstmodel = standardTekstmodel, env, log = console } = {}) {
  const meld = (e) => { try { sendError(e); } catch (_) { /* AppSignal må aldrig vælte et svar */ } };

  async function hentFirma(firmId) {
    const [a, b] = await Promise.all([
      supabase.from("firms").select("id, name, owner_phone").eq("id", firmId).maybeSingle(),
      supabase.from("firma_profil").select("branche, afsender_navn, afsender_telefon, telefon").eq("firm_id", firmId).maybeSingle(),
    ]);
    if (a.error || b.error || !a.data) throw new Error("firma kunne ikke laeses");
    const pr = b.data || {};
    // Underskriften (Ann 8/11): "Peter, Hansens VVS", og det telefonnummer, firmaet selv
    // har valgt ved første brug (afsender_telefon). Firmaets nummer og ejerens mobil er
    // kun FORSLAG i formularen; ingen af dem havner i et svar, uden at firmaet har valgt det.
    return {
      firm: a.data.name || "", person: pr.afsender_navn || "", phone: pr.afsender_telefon || "", trade: pr.branche || "",
      telefonForslag: telefonForslag(pr.telefon, a.data.owner_phone),
    };
  }

  // Forslag til skærmen: firmaets nummer og ejerens mobil, hver med sin betegnelse.
  // Er de ens (Ann 8/11: ofte), vises de som ét valg.
  function telefonForslag(firma, ejer) {
    const ren = (x) => (typeof x === "string" ? x.trim() : "");
    const cifre = (x) => ren(x).replace(/[^0-9]/g, "").replace(/^45(?=\d{8}$)/, "");
    const f = ren(firma), e = ren(ejer);
    if (f && e && cifre(f) === cifre(e)) return [{ nummer: f, hvad: "Firmaets nummer og dit nummer" }];
    return [f && { nummer: f, hvad: "Firmaets nummer" }, e && { nummer: e, hvad: "Dit nummer" }].filter(Boolean);
  }

  async function harEtModul(firmId) {
    const m = await aktiveModuler(supabase, firmId);
    return m.includes("svar") || m.includes("facebook");
  }

  // ─── Profil ────────────────────────────────────────────────────────────────
  app.get("/api/skrivehjaelp/profil", async (req, res) => {
    const firmId = await firmIdFromToken(supabase, req);
    if (!firmId) return res.status(401).json({ error: "Ikke logget ind" });
    try {
      if (!(await harEtModul(firmId))) return res.status(403).json({ error: "modul_mangler" });
      const f = await hentFirma(firmId);
      res.set("Cache-Control", "no-store");
      res.json({
        firmanavn: f.firm, branche: f.trade || null, afsenderNavn: f.person || null,
        afsenderTelefon: f.phone || null, telefonForslag: f.telefonForslag,
        profilMangler: !f.trade || !f.person,
        brancher: BRANCHER,
        situationer: f.trade ? situationerFor(f.trade) : [],
        kanaler: Object.keys(P.KANAL), toner: Object.keys(P.TONE), maal: P.MAAL, platforme: P.PLATFORM,
      });
    } catch (e) {
      log.error("❌ /api/skrivehjaelp/profil:", e.message);
      res.status(503).json({ error: "profil_utilgaengelig" });
    }
  });

  app.post("/api/skrivehjaelp/profil", async (req, res) => {
    const firmId = await firmIdFromToken(supabase, req);
    if (!firmId) return res.status(401).json({ error: "Ikke logget ind" });
    const branche = typeof req.body?.branche === "string" ? req.body.branche.trim() : "";
    const navn = typeof req.body?.afsenderNavn === "string" ? req.body.afsenderNavn.trim().replace(/\s+/g, " ") : "";
    if (!ALLE_FAG.includes(branche)) return res.status(400).json({ error: "ukendt_branche", besked: "Vælg din branche på listen." });
    if (!navn || navn.length > MAKS_NAVN || /[<>]/.test(navn)) {
      return res.status(400).json({ error: "ugyldigt_navn", besked: `Skriv dit navn (højst ${MAKS_NAVN} tegn).` });
    }
    // Tomt = intet nummer under svarene. Ellers et dansk eller udenlandsk nummer.
    const tlf = typeof req.body?.afsenderTelefon === "string" ? req.body.afsenderTelefon.trim().replace(/\s+/g, " ") : "";
    if (tlf && !TELEFON_RE.test(tlf)) {
      return res.status(400).json({ error: "ugyldigt_telefonnummer", besked: "Skriv telefonnummeret med cifre, fx 12 34 56 78, eller lad feltet stå tomt." });
    }
    try {
      if (!(await harEtModul(firmId))) return res.status(403).json({ error: "modul_mangler" });
      const { error } = await supabase.from("firma_profil").update({ branche, afsender_navn: navn, afsender_telefon: tlf || null }).eq("firm_id", firmId);
      if (error) throw new Error(error.message);
      res.json({ ok: true, branche, afsenderNavn: navn, afsenderTelefon: tlf || null, situationer: situationerFor(branche) });
    } catch (e) {
      log.error("❌ POST /api/skrivehjaelp/profil:", e.message);
      res.status(503).json({ error: "profil_utilgaengelig" });
    }
  });

  // ─── Kvote ─────────────────────────────────────────────────────────────────
  app.get("/api/skrivehjaelp/kvote", async (req, res) => {
    const firmId = await firmIdFromToken(supabase, req);
    if (!firmId) return res.status(401).json({ error: "Ikke logget ind" });
    try {
      const m = await aktiveModuler(supabase, firmId);
      const ud = {};
      if (m.includes("svar")) ud.svar = await kvote.status({ firmId, pulje: "svar" }, supabase, env);
      if (m.includes("facebook")) ud.facebook = await kvote.status({ firmId, pulje: "facebook" }, supabase, env);
      if (!Object.keys(ud).length) return res.status(403).json({ error: "modul_mangler" });
      res.set("Cache-Control", "no-store");
      res.json(ud);
    } catch (e) {
      log.error("❌ /api/skrivehjaelp/kvote:", e.kode || "", e.message);
      res.status(503).json({ error: FEJLKODER[e.kode] || "kvote_utilgaengelig" });
    }
  });

  // ─── De tre udkast ─────────────────────────────────────────────────────────
  async function udkast(type, req, res) {
    const firmId = await firmIdFromToken(supabase, req);
    if (!firmId) return res.status(401).json({ error: "Ikke logget ind" });

    let firma;
    try { firma = await hentFirma(firmId); }
    catch (e) { log.error(`❌ skrivehjaelp/${type}: firma`, e.message); return res.status(503).json({ error: "firma_utilgaengeligt" }); }
    if (!firma.trade || !firma.person) {
      return res.status(409).json({ error: "profil_mangler", besked: "Fortæl først din branche og dit navn." });
    }

    const input = req.body && typeof req.body === "object" ? req.body : {};
    let prompt;
    try {
      prompt = type === "svar" ? P.bygSvar(input, firma) : type === "opslag" ? P.bygOpslag(input, firma) : P.bygKommentar(input, firma);
    } catch (e) {
      if (e instanceof P.ValideringsFejl) return res.status(400).json({ error: "ugyldigt_input", besked: e.message });
      log.error(`❌ skrivehjaelp/${type}: prompten kunne ikke bygges`, e.message);
      meld(e);
      return res.status(500).json({ error: "serverfejl" });
    }

    const begge = type === "opslag" && input.platform === "Begge";
    const param = { ...PARAM[type], ...(begge ? { maksTokens: MAKS_TOKENS_BEGGE } : {}), timeoutMs: TIMEOUT_MS };

    // ── Kvoten, FØR der ringes. Værste tilfælde: to kald (ét nyt forsøg) ──────
    let dom;
    try {
      const ind = Math.ceil((prompt.system.length + prompt.bruger.length) / TEGN_PR_TOKEN);
      const maxPrisOere = 2 * tekstmodel.prisOereSkrivehjaelp(ind, param.maksTokens, env);
      dom = await kvote.tjek({ firmId, maxPrisOere, pulje: PULJE[type] }, supabase, env);
    } catch (e) {
      const kode = FEJLKODER[e.kode] || "kvote_utilgaengelig";
      log.error(`❌ skrivehjaelp/${type} kunne ikke forberedes [${kode}]:`, e.kode || "", e.message);
      meld(e);
      return res.status(503).json({ error: kode, besked: "Skrivehjælpen kan ikke bruges lige nu. Prøv igen om lidt." });
    }
    if (!dom.tilladt) {
      const h = new Error(`Kvoteafvisning (${FORMAAL[type]}): ${dom.aarsag}`);
      h.name = "Kvoteafvisning";
      log.warn(`⚠️ KVOTE afviste ${FORMAAL[type]}`, { firmId, aarsag: dom.aarsag, forbrugtOere: dom.forbrugtOere, loftOere: dom.loftOere });
      meld(h);
      return res.status(402).json({ error: dom.aarsag, besked: dom.besked, naesteNulstilling: dom.naesteNulstilling });
    }

    // ── Kaldet, med bogføring af HVERT kald ──────────────────────────────────
    const bogfoer = async (x) => {
      try {
        await kvote.bogfoer({
          firmId, formaal: FORMAAL[type], leverandoer: x.leverandoer, model: x.model,
          enhed: "token", maengde: (x.tokensInd || 0) + (x.tokensUd || 0), prisOere: x.prisOere,
        }, supabase);
      } catch (b) { log.error("❌ skrivehjaelp: bogfoeringen fejlede:", b.message); meld(b); }
    };
    let brugtOere = 0;
    const kald = async () => {
      let r;
      try {
        r = await tekstmodel.skriv({ system: prompt.system, bruger: prompt.bruger, ...param }, env);
      } catch (e) {
        if (typeof e.prisOere === "number" && e.prisOere > 0) { await bogfoer(e); brugtOere += e.prisOere; }
        throw e;
      }
      await bogfoer(r);
      brugtOere += r.prisOere;
      return r.raat;
    };
    const kendte = F.kendteFakta(input, firma);
    const efterbehandl = type === "svar" ? (raat) => F.efterbehandlSvar(raat, kendte) : (raat) => F.efterbehandlForslag(raat, kendte, { begge });

    let r;
    try {
      r = await F.medEtNytForsoeg(kald, efterbehandl);
    } catch (e) {
      const kode = FEJLKODER[e.kode] || (e.kode === "skrivehjaelp_tom" ? "udkast_tomt" : "udkast_fejlede");
      log.error(`❌ skrivehjaelp/${type} fejlede [${e.kode || "?"}]:`, e.message);
      meld(e);
      return res.status(kode.endsWith("ukonfigureret") ? 503 : 502).json({ error: kode, besked: "Vi kunne ikke skrive et udkast lige nu. Prøv igen om lidt." });
    }
    if (!r.ok) {
      const f = new Error(`Skrivehjaelp: forkert form to gange (${FORMAAL[type]}): ${r.forsoeg.join(" / ")}`);
      f.name = "Skrivehjaelpform";
      log.error("❌ " + f.message);
      meld(f);
      return res.status(502).json({ error: "udkast_ubrugeligt", besked: "Udkastet kom tilbage i en form, vi ikke kunne bruge. Prøv igen." });
    }

    const varsel = krydsedeDagsvarsel(dom.forbrugtIDagOere, brugtOere, dom.dagsloftOere) ? "dag90" : null;
    if (kvote.krydsedeVarsel(dom.forbrugtOere, brugtOere, dom.loftOere)) {
      const v = new Error(`Kvotevarsel: firmaet har passeret ${kvote.VARSEL_ANDEL * 100} % af puljen ${PULJE[type]}`);
      v.name = "Kvotevarsel";
      meld(v);
    }
    res.set("Cache-Control", "no-store");
    if (type === "svar") return res.json({ svar: r.svar, noter: r.noter, forsoeg: r.forsoeg.length, varsel });
    return res.json({ forslag: r.forslag, begge, forsoeg: r.forsoeg.length, varsel });
  }

  for (const type of ["svar", "opslag", "kommentar"]) {
    app.post(`/api/skrivehjaelp/${type}`, async (req, res) => {
      try { await udkast(type, req, res); }
      catch (e) {
        log.error(`❌ /api/skrivehjaelp/${type}:`, e.message);
        meld(e);
        if (!res.headersSent) res.status(500).json({ error: "serverfejl" });
      }
    });
  }
  log.log("✍️  Skrivehjælp registreret paa /api/skrivehjaelp (SKRIVEHJAELP_AKTIV)");
};

module.exports.BRANCHER = BRANCHER;
module.exports.situationerFor = situationerFor;
