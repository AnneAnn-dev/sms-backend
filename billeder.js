// billeder.js
// -----------------------------------------------------------------------------
// Billeder paa opgaver (D88 trin 2, 19/10-26) — ÉT sted for grænser, filnavne
// og lagring, brugt af kundens formular (POST /formular/:token) og af
// haandvaerkerens egne opgaver (POST /opgave/:id/billeder).
//
// HVORFOR DENNE FIL: indtil 19/10 havde /formular en multer UDEN graenser
// (memoryStorage, ingen fil-, antal- eller typegraense), og kundens filnavn
// gik uaendret ind i stien i bucket'en. Én stor upload kunne fylde serverens
// hukommelse — den samme proces, der svarer Twilio. To upload-veje med hver
// sine regler ville give to sandheder; derfor bor reglerne her.
//
// Graenserne (Ann 19/10-26): hoejst 5 billeder pr. indsendelse, 10 MB stykket,
// kun billedfiler, hoejst 20 billeder pr. opgave i alt (kundens + hans egne).
// Bucket'en `lead-images` faar desuden 10 MB og image/* i Supabase-konsollen,
// saa graensen holder, selv hvis en kodevej en dag glemmer den.
//
// Lagringen er uaendret: `lead-images/<lead-id>/<tid>-<uuid>.<ext>` og en raekke
// i `lead_images`. Stien er pr. OPGAVE, ikke pr. firma — det er den,
// delete-firma.js rydder (`lead-images/<lead-id>/`). Firmaadskillelsen ligger i
// ejerskabstjekket foer upload, ikke i stien.
//
// Fejl gaar til AppSignal (samme moenster som kundematch.js). Tidligere
// forsvandt et fejlet billede i stilhed — kun en linje i Railway-loggen.
// -----------------------------------------------------------------------------
"use strict";

const crypto = require("crypto");
const multer = require("multer");
const { sendError } = require("@appsignal/nodejs");

const MAX_BILLEDER_PR_INDSENDELSE = 5;
const MAX_BYTES_PR_BILLEDE = 10 * 1024 * 1024;
const MAX_BILLEDER_PR_OPGAVE = 20;

// Kun disse typer. `image/*` alene er IKKE nok: image/svg+xml er et dokument,
// der kan indeholde script, og maa aldrig ligge i en bucket, vi signerer URL'er
// til. Endelsen kommer herfra — aldrig fra kundens filnavn.
const TILLADTE_TYPER = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

function rapporter(besked) {
  // Ingen persondata: kun lead-id, antal og fejlkoder. Kundens filnavn kan
  // indeholde navn eller adresse og kommer aldrig med.
  console.error("❌ billeder: " + besked);
  try { sendError(new Error("billeder: " + besked)); } catch (_) { /* maa aldrig vaelte kaldet */ }
}

function erTilladtType(mimetype) {
  return Object.prototype.hasOwnProperty.call(TILLADTE_TYPER, String(mimetype || "").toLowerCase());
}

// Stien i bucket'en. Serveren laver hele navnet: tid + tilfaeldigt id + endelse
// fra hvidlisten. Kundens filnavn ('../', ', %2F, æøå) kan dermed hverken
// bryde ud af mappen eller af en JS-streng i dashboardet (S33-klassen).
function filsti(leadId, mimetype) {
  const ext = TILLADTE_TYPER[String(mimetype || "").toLowerCase()];
  if (!ext) throw new Error("filsti: ikke en tilladt billedtype");
  if (!/^[0-9a-f-]{36}$/i.test(String(leadId || ""))) throw new Error("filsti: ugyldigt lead-id");
  return `${leadId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
}

// En fil, der ikke er et billede, springes over (og taelles), i stedet for at
// afvise hele indsendelsen: kundens tekst skal igennem, selvom han vedhaefter
// en pdf. Antal og stoerrelse kan multer ikke springe over — dem fanger
// medUpload() nedenfor, foer noget er gemt.
const billedUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES_PR_BILLEDE, files: MAX_BILLEDER_PR_INDSENDELSE },
  fileFilter: (req, file, cb) => {
    if (erTilladtType(file.mimetype)) return cb(null, true);
    req.afvisteFiler = (req.afvisteFiler || 0) + 1;
    cb(null, false);
  },
});

// Middleware-indpakning: en multer-fejl (for stor fil, for mange filer) gives
// til `vedFejl(req, res, kode)` i stedet for Express' generiske 500-side.
// kode: "for_stor" | "for_mange" | "upload_fejl".
function medUpload(feltnavn, vedFejl) {
  const mw = billedUpload.array(feltnavn);
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (!err) return next();
      const kode = err.code === "LIMIT_FILE_SIZE" ? "for_stor"
        : (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") ? "for_mange"
        : "upload_fejl";
      if (kode === "upload_fejl") rapporter(`multer: ${err.code || ""} ${err.message || err}`.trim());
      return vedFejl(req, res, kode);
    });
  };
}

// Gemmer billeder paa en opgave. Kaster aldrig: opgaven ER gemt, naar den her
// kaldes, og et billede maa ikke vaelte den. Returnerer
//   { gemt, oversteg, fejlede }
// oversteg = filer ud over 20 pr. opgave (gemmes ikke).
// Kalderen har allerede bevist, at leadId tilhoerer firmaet.
async function gemBilleder(supabase, leadId, filer) {
  const resultat = { gemt: 0, oversteg: 0, fejlede: 0 };
  const liste = Array.isArray(filer) ? filer : [];
  if (!liste.length) return resultat;

  let plads = MAX_BILLEDER_PR_OPGAVE;
  try {
    const { count, error } = await supabase
      .from("lead_images")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId);
    if (error) throw error;
    plads = Math.max(0, MAX_BILLEDER_PR_OPGAVE - (count || 0));
  } catch (e) {
    // Kan vi ikke taelle, gemmer vi ikke: et loft, der ikke kan maales, er
    // ikke et loft. Fejlen larmer; opgaven er gemt.
    rapporter(`lead ${leadId}: kunne ikke taelle billeder: ${(e && e.code) || ""} ${(e && e.message) || e}`.trim());
    resultat.fejlede = liste.length;
    return resultat;
  }

  for (const fil of liste) {
    if (plads <= 0) { resultat.oversteg++; continue; }
    try {
      const sti = filsti(leadId, fil.mimetype);
      const { error: upFejl } = await supabase.storage
        .from("lead-images")
        .upload(sti, fil.buffer, { contentType: fil.mimetype, upsert: false });
      if (upFejl) throw upFejl;

      // image_url bevares i samme form som foer (dashboardet tager stien efter
      // "/lead-images/" og signerer den). Bucket'en er privat — URL'en virker
      // ikke i sig selv (maalt i konsollen 19/10).
      const { data: url } = supabase.storage.from("lead-images").getPublicUrl(sti);
      const { error: rFejl } = await supabase
        .from("lead_images")
        .insert({ lead_id: leadId, image_url: url.publicUrl });
      if (rFejl) throw rFejl;

      resultat.gemt++;
      plads--;
    } catch (e) {
      resultat.fejlede++;
      rapporter(`lead ${leadId}: ${(e && (e.code || e.statusCode)) || ""} ${(e && e.message) || e}`.trim());
    }
  }
  return resultat;
}

module.exports = {
  MAX_BILLEDER_PR_INDSENDELSE,
  MAX_BYTES_PR_BILLEDE,
  MAX_BILLEDER_PR_OPGAVE,
  TILLADTE_TYPER,
  erTilladtType,
  filsti,
  billedUpload,
  medUpload,
  gemBilleder,
};
