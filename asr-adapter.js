// asr-adapter.js — lyd ind, tekst ud. Én funktion, én leverandør ad gangen.
//
// HVORFOR DEN FINDES: vi kommer til at skifte transskriptionsmodel — enten når
// syv.ai lukker tabet inde i segmenterne (J9's re-trigger er åben og uden dato),
// eller når en tredje bliver bedre. Adapteren er det, der gør skiftet til en
// miljøvariabel i stedet for en omskrivning. Kravene står i docs/asr-adapter.md;
// denne fil må aldrig vokse ud over dem.
//
// FIRE REGLER, DER IKKE MÅ SLIBES AF:
//
//   1. SEGMENTER ER RETURTYPEN, også selvom Fase 1 kun bruger `tekst`.
//      Uden dem kan tæthedsværnet aldrig bygges, og den næste leverandør kan
//      ikke måles med prøvebænkens 04 og 05 uden et parallelt kodespor.
//      Det er et MÅLBARHEDSKRAV, ikke et værnskrav.
//
//   2. `konfidens` gemmes, men vises ALDRIG for brugeren.
//      Målt 14/9 (RESULTAT-03): whispers konfidens er normal eller høj netop
//      dér, hvor den tager fejl. Bygger nogen en gul markering på dette felt,
//      markerer den halvdelen af teksten og fanger ikke "USB-plader".
//
//   3. `ordliste` tages ALTID imod og kastes lydløst væk hos den leverandør,
//      der ikke kan bruge den (syv.ai har Vocabulary; Scaleway har ikke).
//      Ellers siver leverandørnavnet ud i kaldekoden, og så er adapteren holdt
//      op med at være en adapter.
//
//   4. PRISEN ER EN ENHED, IKKE EN KONSTANT. Scaleway afregner pr. lydminut,
//      syv.ai pr. lydtime. `kvote.js` skal spørge adapteren, ikke gange med et
//      tal — ellers er budgettet forkert præcis den dag, modellen skiftes.
//
// Lyd persisteres ALDRIG. Denne fil skriver ikke til disk og logger hverken
// lyd eller tekst — transskriptioner er persondata (CLAUDE.md, Sikkerhed).

"use strict";

// ─── Leverandører ────────────────────────────────────────────────────────────
// Begge kendte leverandører taler det samme OpenAI-kompatible endpoint:
// POST {url}/audio/transcriptions, multipart, med model + language +
// response_format. Det var netop derfor, prøvebænken kunne skifte mellem dem
// ved at ændre én parameter (bevist 13/9).
//
// NØGLEN HEDDER LEVERANDØRENS NAVN, ikke ASR_KEY. Samme regel som i
// prøvebænken: så kan Scaleway-nøglen aldrig sendes til syv.ai. Det er en
// fem-tegns beslutning nu og en hændelse senere.
const LEVERANDOERER = {
  scaleway: {
    // EGEN noegle til Generative APIs — ikke SCW_SECRET_KEY, som Scaleway TEM
    // bruger til mail (besluttet 27/9). To formaal, to noegler: en rotation af
    // mailnoeglen maa ikke slaa dikteringen ud, og et laek af den ene maa ikke
    // give begge dele. Noeglen baeres af en IAM-application scoped til det
    // projekt, hvor Generative APIs koerer.
    //
    // OMDOEBT 2/10 fra SCW_ASR_SECRET_KEY: transskription og referat bruger
    // SAMME noegle, fordi det er ÉT produkt (Generative APIs) paa ÉT projekt.
    // Et laek af den ene er et laek af den anden, saa en opdeling koeber ingen
    // sikkerhed — kun en udloebsdato mere at holde styr paa. Adskillelsen fra
    // TEM er derimod aegte: to tjenester, to formaal.
    // Gjort mens KUN staging havde variablen; prod havde den ikke endnu.
    noeglenavn: "SCW_GENAI_SECRET_KEY",
    pris: { enhed: "lydminut", satsOere: 2.24 },   // 1,34 kr./lydtime (13/9)
    stoetterOrdliste: false,
  },
  "syv.ai": {
    noeglenavn: "SYVAI_API_KEY",
    pris: { enhed: "lydtime", satsOere: 280 },     // Hviske v5.3, 2,80 kr./lydtime
    stoetterOrdliste: true,
    ordlisteFelt: "Vocabulary",
  },
};

const ALIASSER = ["latest", "newest", "stable", "default"];

// ─── Konfiguration ───────────────────────────────────────────────────────────
// Fail-closed som flags.js: mangler noget, kastes der ved første kald — ikke
// ved import, så appen kan starte uden ASR konfigureret (flaget er slukket i
// prod).
function hentKonfig(env) {
  const e = env || process.env;
  const navn = (e.TILBUD_ASR_LEVERANDOER || "").trim();
  const url = (e.TILBUD_ASR_URL || "").trim();
  const model = (e.TILBUD_ASR_MODEL || "").trim();

  if (!navn) throw konfigfejl("TILBUD_ASR_LEVERANDOER mangler");
  const lev = LEVERANDOERER[navn];
  if (!lev) {
    throw konfigfejl(
      `ukendt leverandoer '${navn}'. Kendte: ${Object.keys(LEVERANDOERER).join(", ")}`
    );
  }
  if (!url) throw konfigfejl("TILBUD_ASR_URL mangler");
  if (!model) throw konfigfejl("TILBUD_ASR_MODEL mangler");

  // D14: modelstrengen laases eksplicit. En model, der skifter under os, goer
  // regressionssaettet vaerdiloest uden at nogen opdager det.
  const lav = model.toLowerCase();
  if (ALIASSER.some((a) => lav === a || lav.endsWith(":" + a) || lav.endsWith("-" + a))) {
    throw konfigfejl(
      `TILBUD_ASR_MODEL er et alias ('${model}'). Skriv det praecise modelnavn med version (D14).`
    );
  }

  // Adressen skal baere PROJEKT-ID'et (et UUID), ikke access key'en.
  // Fundet 27/9: med access key'en i stien svarer Scaleway 404 "ROUTE NOT
  // FOUND", og fejlen ligner en forkert sti frem for en forkert vaerdi. En
  // konfigurationsfejl skal fejle som en konfigurationsfejl.
  if (navn === "scaleway") {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    if (!uuid.test(url)) {
      const accessKey = /SCW[A-Z0-9]{17}/.test(url);
      throw konfigfejl(
        accessKey
          ? "TILBUD_ASR_URL indeholder en ACCESS KEY. Der skal staa projekt-id'et (et UUID): https://api.scaleway.ai/<projekt-id>/v1"
          : "TILBUD_ASR_URL mangler projekt-id'et (et UUID): https://api.scaleway.ai/<projekt-id>/v1"
      );
    }
  }

  const noegle = (e[lev.noeglenavn] || "").trim();
  if (!noegle) throw konfigfejl(`${lev.noeglenavn} mangler (noeglen for '${navn}')`);

  return { navn, lev, url: url.replace(/\/+$/, ""), model, noegle };
}

function konfigfejl(besked) {
  const f = new Error("ASR-konfiguration: " + besked);
  f.kode = "asr_konfiguration";
  return f;
}

// ─── Prisen ──────────────────────────────────────────────────────────────────
// kvote.js spoerger HER. Aldrig en konstant i kaldekoden.
function prisenhed(env) {
  const { lev } = hentKonfig(env);
  return { enhed: lev.pris.enhed, satsOere: lev.pris.satsOere };
}

function prisOere(lydsekunder, env) {
  const { lev } = hentKonfig(env);
  const sek = Number(lydsekunder) || 0;
  if (lev.pris.enhed === "lydminut") return (sek / 60) * lev.pris.satsOere;
  if (lev.pris.enhed === "lydtime") return (sek / 3600) * lev.pris.satsOere;
  if (lev.pris.enhed === "kald") return lev.pris.satsOere;
  throw konfigfejl(`ukendt prisenhed '${lev.pris.enhed}'`);
}

// ─── Selve kaldet ────────────────────────────────────────────────────────────
async function transskriber(
  { lyd, filnavn, sprog = "da", ordliste = null, timeoutMs = 120000 },
  env
) {
  if (!lyd) throw brugsfejl("lyd mangler");
  if (!filnavn) throw brugsfejl("filnavn mangler (multipart kraever et navn med endelse)");

  const k = hentKonfig(env);

  const krop = new FormData();
  krop.append("file", new Blob([lyd]), filnavn);
  krop.append("model", k.model);
  krop.append("language", sprog);
  // verbose_json er det eneste format, der giver segmenter. Regel 1.
  krop.append("response_format", "verbose_json");

  // Regel 3: ordlisten tages imod og kastes lydloest vaek, hvis leverandoeren
  // ikke kan bruge den. Kaldekoden maa aldrig vide, hvem der er i den anden ende.
  if (ordliste && k.lev.stoetterOrdliste && k.lev.ordlisteFelt) {
    krop.append(k.lev.ordlisteFelt, Array.isArray(ordliste) ? ordliste.join(",") : String(ordliste));
  }

  const afbryd = new AbortController();
  const ur = setTimeout(() => afbryd.abort(), timeoutMs);
  let svar;
  try {
    svar = await fetch(`${k.url}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${k.noegle}` },
      body: krop,
      signal: afbryd.signal,
    });
  } catch (e) {
    clearTimeout(ur);
    throw kaldfejl(
      e.name === "AbortError"
        ? `transskriptionen tog over ${Math.round(timeoutMs / 1000)} sekunder`
        : `kunne ikke naa leverandoeren (${e.message})`
    );
  }
  clearTimeout(ur);

  if (!svar.ok) {
    // Leverandoerens fejltekst kan indeholde filnavn, men aldrig lydindhold.
    // Den logges af kaldekoden, ikke her.
    const tekst = await svar.text().catch(() => "");
    throw kaldfejl(`leverandoeren svarede ${svar.status}`, svar.status, tekst.slice(0, 300));
  }

  let raa;
  try {
    raa = await svar.json();
  } catch (e) {
    throw kaldfejl("leverandoeren svarede noget, der ikke er JSON");
  }

  return normaliser(raa, k);
}

// ─── Normalisering ───────────────────────────────────────────────────────────
// Alt leverandoerspecifikt stopper her. Resten af systemet ser kun denne form.
function normaliser(raa, k) {
  const segmenter = Array.isArray(raa.segments)
    ? raa.segments.map((s) => ({
        startSek: tal(s.start),
        slutSek: tal(s.end),
        tekst: typeof s.text === "string" ? s.text.trim() : "",
        // Begge foelgende er VALGFRIE. En leverandoer, der ikke giver dem, maa
        // ikke faa adapteren til at fejle - de saettes til null, og det, der
        // laeser dem, taaler null.
        ingenTaleSandsynlighed: tal(s.no_speech_prob),
        // ⚠️ GEMMES, MEN VISES ALDRIG. Se regel 2 oeverst.
        konfidens: tal(s.avg_logprob),
      }))
    : [];

  const varighed =
    tal(raa.duration) !== null
      ? tal(raa.duration)
      : segmenter.length
      ? segmenter[segmenter.length - 1].slutSek
      : null;

  return {
    tekst: typeof raa.text === "string" ? raa.text.trim() : "",
    sprog: raa.language || null,
    varighedSek: varighed,
    segmenter,
    leverandoer: k.navn,
    model: k.model,
    lydsekunder: varighed,   // grundlaget for prisberegningen
  };
}

function tal(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function brugsfejl(besked) {
  const f = new Error("ASR: " + besked);
  f.kode = "asr_brug";
  return f;
}

function kaldfejl(besked, status, uddrag) {
  const f = new Error("ASR: " + besked);
  f.kode = "asr_kald";
  if (status) f.status = status;
  if (uddrag) f.uddrag = uddrag;
  return f;
}

module.exports = {
  transskriber,
  prisenhed,
  prisOere,
  // Eksporteret til test. Kald dem ikke fra produktionskode.
  _normaliser: normaliser,
  _hentKonfig: hentKonfig,
  _LEVERANDOERER: LEVERANDOERER,
};
