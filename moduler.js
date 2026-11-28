// moduler.js — moduler pr. firma (udviklingsplanens Fase 1b, 13/10-26).
// -----------------------------------------------------------------------------
// Hvilke moduler har et firma, og må det kalde en given rute?
//
// ÉN SPÆRRE, kaldt FØR ruten. Ruterne selv ved intet om moduler; server.js
// monterer kraevModul() foran dem. Så kan en ny rute ikke glemme tjekket, så
// længe den ligger under en sti, der allerede er spærret.
//
// FAIL-CLOSED. Uden række: intet modul (403). Kan rækkerne ikke læses: 503,
// ikke "lad den gå". Et modul, der koster penge pr. kald, må aldrig åbne sig,
// fordi databasen hikker.
//
// AFMELDT MODUL (beslutningsgrundlaget 13/10): håndværkeren kan stadig LÆSE
// sit eget, men ikke lave nyt. Derfor kan en spærre sættes til kun at gælde
// skrivning ({ kunSkrivning: true }).
//
// Modulnavnene står OGSÅ i migrationens CHECK-regel (firma_moduler_modul).
// Ret begge steder.
// -----------------------------------------------------------------------------

"use strict";

const { firmIdFromToken } = require("./auth");
const flags = require("./flags");

// "kunder" (Fase 4 salg, 17/11-26): Kunder og Opgaver for et firma, der ikke
// har dem gennem et andet modul. Saelges ikke for sig; foelger med pakken
// "Skrivehjaelp og SoMe med kunder" (frisbii-katalog.js).
const MODULER = ["telefon", "referat", "tilbud", "faktura", "booking", "svar", "facebook", "kunder"];

// Har firmaet Kunder og Opgaver? (Fase 4 salg T3, 17/11-26.) Alle moduler
// undtagen Skrivehjaelpens to giver dem; "kunder" findes netop for det firma,
// der ellers kun har svar og facebook ("Skrivehjaelp og SoMe med kunder").
// Reglen staar KUN her: appen faar svaret fra /api/moduler (harKunder), og
// velkomstmailen (T5) spoerger samme funktion. Et nyt modul skal tilfoejes
// her eller i UDEN_KUNDER - proev-frisbii-katalog.js bliver roed, hvis ikke.
const GIVER_KUNDER = ["telefon", "referat", "tilbud", "faktura", "booking", "kunder"];
const UDEN_KUNDER = ["svar", "facebook"];
function harKunder(moduler) {
  return (moduler || []).some((m) => GIVER_KUNDER.includes(m));
}

// Aktiv = fra <= nu og (til tom eller til > nu). Filtreres her og ikke i
// forespørgslen, så tidsreglen står ét sted og kan læses.
async function aktiveModuler(supabase, firmId) {
  const { data, error } = await supabase
    .from("firma_moduler")
    .select("modul, fra, til")
    .eq("firm_id", firmId);
  if (error) throw new Error(`firma_moduler: ${error.message}`);
  const nu = Date.now();
  return (data || [])
    .filter((r) => Date.parse(r.fra) <= nu && (r.til == null || Date.parse(r.til) > nu))
    .map((r) => r.modul)
    .sort();
}

function kraevModul(supabase, modul, { kunSkrivning = false } = {}) {
  if (!MODULER.includes(modul)) throw new Error(`kraevModul: ukendt modul "${modul}"`);
  return async (req, res, next) => {
    if (kunSkrivning && (req.method === "GET" || req.method === "HEAD")) return next();
    const firmId = await firmIdFromToken(supabase, req);
    if (!firmId) return res.status(401).json({ error: "Ikke logget ind" });
    let har;
    try {
      har = await aktiveModuler(supabase, firmId);
    } catch (err) {
      console.error("❌ modulspærre:", err.message);
      return res.status(503).json({ error: "moduler_utilgaengelige" });
    }
    if (!har.includes(modul)) {
      return res.status(403).json({
        error: "modul_mangler",
        modul,
        besked: "Dit abonnement omfatter ikke denne del. Du kan tilføje den under Profil.",
      });
    }
    next();
  };
}

// Fase 5 (28/11-26, spor 2's ønske): hvilke dele af tilbuddet serveren FAKTISK
// har. Flagene ligger i lag, som ruterne monteres: tilbudsdelen kun under
// TILBUD_AKTIV (routes/tilbud/index.js), forslaget kun under tilbudsdelen
// (routes/tilbud/tilbud.js). Klienten får de effektive værdier, så "Lav
// forslag" aldrig vises over en rute, der svarer 404. Flagene læses fra
// flags.js — ingen kopi.
function tilbudsflag(tilbudAktiv, f = flags) {
  const tilbudsdelAktiv = Boolean(tilbudAktiv && f.TILBUDSDEL_AKTIV);
  return { tilbudsdelAktiv, tilbudsforslagAktiv: Boolean(tilbudsdelAktiv && f.TILBUDSFORSLAG_AKTIV) };
}

// GET /api/moduler — hvad appen skal vise. tilbudAktiv er den globale
// nødbremse (TILBUD_AKTIV): slukket betyder, at referat og tilbud ikke
// findes på serveren, uanset firmaets rækker. harKunder (T3): false skjuler
// Opgaver og Kunder i appen (se harKunder ovenfor). tilbudsdelAktiv og
// tilbudsforslagAktiv: se tilbudsflag ovenfor. De siger, hvad serveren har,
// ikke om firmaet har modulet "tilbud" — det står i moduler.
function registrerModulRuter(app, supabase, { tilbudAktiv }) {
  app.get("/api/moduler", async (req, res) => {
    const firmId = await firmIdFromToken(supabase, req);
    if (!firmId) return res.status(401).json({ error: "Ikke logget ind" });
    try {
      const moduler = await aktiveModuler(supabase, firmId);
      res.json({ moduler, tilbudAktiv, harKunder: harKunder(moduler), ...tilbudsflag(tilbudAktiv) });
    } catch (err) {
      console.error("❌ /api/moduler:", err.message);
      res.status(503).json({ error: "moduler_utilgaengelige" });
    }
  });
}

module.exports = { MODULER, GIVER_KUNDER, UDEN_KUNDER, harKunder, aktiveModuler, kraevModul, registrerModulRuter, tilbudsflag };
