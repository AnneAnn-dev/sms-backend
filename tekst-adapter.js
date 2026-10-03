// tekst-adapter.js — transskription ind, referat ud. Samme form som asr-adapter.js.
//
// HVORFOR DEN FINDES: transskription og referat skal kunne skiftes HVER FOR SIG.
// Vi har allerede set, at den bedste transskription og den bedste referatmodel
// kan komme fra to forskellige huse — og at en ræsonnerende model er ubrugelig
// til referatet, uanset hvor god den er ellers (J9: `qwen3.5-397b-a17b` brugte
// 4.000 tokens på at tænke og leverede intet, bevist 13/9).
//
// FEM REGLER, DER IKKE MÅ SLIBES AF:
//
//   1. SYSTEMPROMPT OG BRUGERTEKST HOLDES ADSKILT hele vejen til kaldet og
//      sættes ALDRIG sammen til én streng (S6). Transskriptionen er DATA, ikke
//      instruktion. Sætter man dem sammen, kan en håndværker, der dikterer
//      "glem alt ovenstående", ændre reglerne.
//
//   2. PRISEN ER TO TAL, IKKE ÉT. Input og output koster ikke det samme —
//      output er fem gange dyrere hos Scaleway, og det er 81 % af referatets
//      pris (målt 1/10). `kvote.js` skal spørge adapteren, ikke gange.
//
//   3. FORMEN VALIDERES, ALDRIG INDHOLDET (P5). Modellen må gerne skrive et
//      middelmådigt referat. Den må ikke aflevere noget, koden gemmer som om
//      det var i orden.
//
//   4. ET TOMT SVAR FRA EN RÆSONNERENDE MODEL SKAL SIGE SIT EGET NAVN. Fejlen
//      "modellen svarede tomt, men brugte 4.000 tokens" skal kunne læses som
//      "det er forkert værktøj", ikke som "noget gik galt".
//
//   5. MODELSTRENGEN LÅSES (D14). Aldrig et alias. En model, der skifter under
//      os, gør regressionssættet værdiløst, uden at nogen opdager det.
//
// Denne fil logger hverken transskription, referat eller prompt — kun tal.
// Transskriptioner er persondata (CLAUDE.md, Sikkerhed).

"use strict";

const { REFERAT_SYSTEMPROMPT, REFERAT_PROMPT_VERSION } = require("./prompts/referat");

// ─── Prisen ──────────────────────────────────────────────────────────────────
// Leverandørens EGEN enhed: euro pr. million tokens. Omregningen står ét sted,
// så den kan rettes ét sted — regningen kommer i euro, loftet er i kroner.
//
// Læst på Scaleways prisside 1/10-2026. ⚠️ Bekræft i konsollen ved et skifte.
const EUR_TIL_DKK = 7.46;

const LEVERANDOERER = {
  scaleway: {
    // SAMME nøgle som transskriptionen: det er ét produkt (Generative APIs) på
    // ét projekt, og et læk af den ene er et læk af den anden. Adskillelsen fra
    // TEM-mailens SCW_SECRET_KEY er derimod ægte — to tjenester, to formål.
    // Omdøbt 2/10-2026 fra SCW_ASR_SECRET_KEY, mens KUN staging havde variablen;
    // prod har aldrig kendt det gamle navn. asr-adapter.js læser den samme.
    // Verificeret med et rigtigt kald: 200, 6,09 øre, bogføringen stemte.
    noeglenavn: "SCW_GENAI_SECRET_KEY",
    // ⚠️ NAVNENE SKAL FINDES, IKKE BARE SE RIGTIGE UD. Efterprøvet mod
    // GET {url}/models 3/10-2026. Alias-vagten nedenfor fanger "latest" og
    // "stable" — den fanger IKKE et navn, der er plausibelt og alligevel dødt.
    // 3/10-2026 stod her "mistral-small-3.2-24b-instruct"; den rigtige hedder
    // "-2506", og et kald med den gamle gav 422 MODEL NOT FOUND. Tørkørslen
    // kunne ikke se det: den har hverken netværk eller nøgle.
    // Før du tilføjer eller retter et navn her:  node proev-tekst-adapter.js --modeller
    priser: {
      // euro pr. million tokens
      "mistral-medium-3.5-128b":             { ind: 1.50, ud: 7.50 },
      "mistral-small-3.2-24b-instruct-2506": { ind: 0.15, ud: 0.35 },
      "llama-3.3-70b-instruct":              { ind: 0.90, ud: 0.90 },
    },
  },
};

const ALIASSER = ["latest", "newest", "stable", "default"];

// ─── Konfiguration ───────────────────────────────────────────────────────────
// Fail-closed som flags.js og asr-adapter.js: der kastes ved første kald, ikke
// ved import, så appen kan starte uden referat konfigureret.
function hentKonfig(env) {
  const e = env || process.env;
  const navn = (e.TILBUD_REFERAT_LEVERANDOER || "").trim();
  const url = (e.TILBUD_REFERAT_URL || "").trim();
  const model = (e.TILBUD_REFERAT_MODEL || "").trim();

  if (!navn) throw konfigfejl("TILBUD_REFERAT_LEVERANDOER mangler");
  const lev = LEVERANDOERER[navn];
  if (!lev) {
    throw konfigfejl(
      `ukendt leverandoer '${navn}'. Kendte: ${Object.keys(LEVERANDOERER).join(", ")}`
    );
  }
  if (!url) throw konfigfejl("TILBUD_REFERAT_URL mangler");
  if (!model) throw konfigfejl("TILBUD_REFERAT_MODEL mangler");

  // D14
  const lav = model.toLowerCase();
  if (ALIASSER.some((a) => lav === a || lav.endsWith(":" + a) || lav.endsWith("-" + a))) {
    throw konfigfejl(
      `TILBUD_REFERAT_MODEL er et alias ('${model}'). Skriv det praecise modelnavn med version (D14).`
    );
  }

  // Samme faelde som i asr-adapter.js: access key'en i stien giver 404 og
  // ligner en forkert sti frem for en forkert vaerdi (fundet 27/9).
  if (navn === "scaleway") {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    if (!uuid.test(url)) {
      throw konfigfejl(
        /SCW[A-Z0-9]{17}/.test(url)
          ? "TILBUD_REFERAT_URL indeholder en ACCESS KEY. Der skal staa projekt-id'et (et UUID)."
          : "TILBUD_REFERAT_URL mangler projekt-id'et (et UUID): https://api.scaleway.ai/<projekt-id>/v1"
      );
    }
  }

  // ⚠️ FAIL-CLOSED PAA PRISEN. Kender vi ikke modellens takst, kan kvoten ikke
  // regne, og saa maa kaldet ikke ske. Et forbrug, vi ikke kan prissaette, er
  // et loft, der ikke virker.
  const pris = lev.priser[model];
  if (!pris) {
    throw konfigfejl(
      `prisen for '${model}' er ukendt. Tilfoej den i tekst-adapter.js (euro pr. million tokens, ` +
      `laest paa leverandoerens prisside) foer modellen tages i brug. Kendte: ` +
      Object.keys(lev.priser).join(", ")
    );
  }

  const noegle = (e[lev.noeglenavn] || "").trim();
  if (!noegle) throw konfigfejl(`${lev.noeglenavn} mangler (noeglen for '${navn}')`);

  return { navn, lev, pris, url: url.replace(/\/+$/, ""), model, noegle };
}

function konfigfejl(besked) {
  const f = new Error("Referat-konfiguration: " + besked);
  f.kode = "referat_konfiguration";
  return f;
}

// ─── Prisen — kvote.js spoerger HER ──────────────────────────────────────────
function prisenhed(env) {
  const { pris } = hentKonfig(env);
  return {
    enhed: "token",
    indOerePrMio: Math.round(pris.ind * EUR_TIL_DKK * 100 * 100) / 100,
    udOerePrMio: Math.round(pris.ud * EUR_TIL_DKK * 100 * 100) / 100,
  };
}

function prisOere(tokensInd, tokensUd, env) {
  const { pris } = hentKonfig(env);
  const i = (Number(tokensInd) || 0) / 1e6;
  const u = (Number(tokensUd) || 0) / 1e6;
  return (i * pris.ind + u * pris.ud) * EUR_TIL_DKK * 100;
}

// ─── Formvalidering (P5) ─────────────────────────────────────────────────────
// Validerer FORM og GRAENSER, aldrig indhold. Ordret samme regler som
// proevebaenkens 03-referat.ps1, saa et referat, der bestod dér, bestaar her.
const FELTER = ["overskrift", "punkter", "fritekst"];
const MAKS_PUNKTER = 20;      // prompten sigter mod 15; afstanden er med vilje
const MAKS_OVERSKRIFT = 100;
const MAKS_SVAR_TEGN = 8000;

function valider(raatSvar) {
  const fejl = [];
  if (!raatSvar || !String(raatSvar).trim()) return { ok: false, fejl: ["tomt svar fra modellen"] };

  // Hegn omkring JSON er almindeligt, selvom prompten forbyder det.
  const t = String(raatSvar).trim()
    .replace(/^\s*```(?:json)?\s*/, "")
    .replace(/\s*```\s*$/, "");

  let obj;
  try { obj = JSON.parse(t); }
  catch { return { ok: false, fejl: ["JSON kan ikke parses"] }; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, fejl: ["svaret er ikke et objekt"] };
  }

  for (const k of FELTER) if (!(k in obj)) fejl.push(`felt mangler: ${k}`);
  for (const n of Object.keys(obj)) if (!FELTER.includes(n)) fejl.push(`opfundet felt: ${n}`);

  if (typeof obj.overskrift !== "string" || !obj.overskrift.trim()) fejl.push("overskrift er tom");
  else if (obj.overskrift.length > MAKS_OVERSKRIFT) {
    fejl.push(`overskrift for lang: ${obj.overskrift.length} tegn`);
  }

  if (!Array.isArray(obj.punkter)) fejl.push("punkter er ikke en liste");
  else {
    if (obj.punkter.length < 1) fejl.push("punkter er tom");
    if (obj.punkter.length > MAKS_PUNKTER) fejl.push(`for mange punkter: ${obj.punkter.length}`);
    if (obj.punkter.some((p) => typeof p !== "string" || !p.trim())) fejl.push("tomt punkt i listen");
  }

  if (typeof obj.fritekst !== "string" || !obj.fritekst.trim()) fejl.push("fritekst er tom");
  if (t.length > MAKS_SVAR_TEGN) fejl.push(`svar over loftet: ${t.length} tegn`);

  // Groft dansk-tjek. Fanger et svar, der pludselig er paa engelsk.
  //
  // ⚠️ VALIDATOREN MAA ALDRIG SELV KASTE. Fundet 2/10 af proeven: svarede
  // modellen med `punkter` som en STRENG, kaldte denne linje .join paa en
  // streng og vaeltede hele ruten. En validator, der kan falde over et daarligt
  // svar, er praecis det modsatte af det, den findes for. Derfor laeses hvert
  // felt her med en typekontrol, ikke med en antagelse.
  const alt = [
    typeof obj.overskrift === "string" ? obj.overskrift : "",
    Array.isArray(obj.punkter) ? obj.punkter.filter((p) => typeof p === "string").join(" ") : "",
    typeof obj.fritekst === "string" ? obj.fritekst : "",
  ].join(" ");
  if (!/(\b(og|skal|der|som|ikke|med)\b|æ|ø|å)/i.test(alt)) {
    fejl.push("ser ikke ud til at vaere dansk");
  }

  return fejl.length ? { ok: false, fejl } : { ok: true, obj };
}

// ─── Selve kaldet ────────────────────────────────────────────────────────────
async function referer(
  { tekst, systemprompt = REFERAT_SYSTEMPROMPT, temperatur = 0.3, maksTokens = 4000, timeoutMs = 120000 },
  env
) {
  if (!tekst || !String(tekst).trim()) throw brugsfejl("tekst mangler");
  const k = hentKonfig(env);

  const afbryd = new AbortController();
  const ur = setTimeout(() => afbryd.abort(), timeoutMs);
  let svar;
  try {
    svar = await fetch(`${k.url}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${k.noegle}`, "Content-Type": "application/json" },
      // Regel 1: to felter, aldrig én streng.
      body: JSON.stringify({
        model: k.model,
        temperature: temperatur,
        max_tokens: maksTokens,
        messages: [
          { role: "system", content: systemprompt },
          { role: "user", content: String(tekst) },
        ],
      }),
      signal: afbryd.signal,
    });
  } catch (e) {
    clearTimeout(ur);
    throw kaldfejl(
      e.name === "AbortError"
        ? `referatet tog over ${Math.round(timeoutMs / 1000)} sekunder`
        : `kunne ikke naa leverandoeren (${e.message})`
    );
  }
  clearTimeout(ur);

  if (!svar.ok) {
    const tekstSvar = await svar.text().catch(() => "");
    throw kaldfejl(`leverandoeren svarede ${svar.status}`, svar.status, tekstSvar.slice(0, 300));
  }

  let raa;
  try { raa = await svar.json(); }
  catch { throw kaldfejl("leverandoeren svarede noget, der ikke er JSON"); }

  const valg = (raa.choices && raa.choices[0]) || {};
  const indhold = (valg.message && valg.message.content) || "";
  const tokensInd = (raa.usage && raa.usage.prompt_tokens) || 0;
  const tokensUd = (raa.usage && raa.usage.completion_tokens) || 0;

  // Regel 4: en raesonnerende model skal sige sit eget navn.
  if (!String(indhold).trim() && tokensUd > 0) {
    throw medPris(k, tokensInd, tokensUd, env, kaldfejl(
      `modellen svarede TOMT, men brugte ${tokensUd} tokens. Det er en raesonnerende model, ` +
      `og den er forkert vaerktoej her — den braender budgettet paa at taenke. Brug en ` +
      `instruct-model (J9, bevist 13/9).`,
      null, null, "raesonnerende"
    ));
  }

  const v = valider(indhold);
  if (!v.ok) {
    // Teksten kommer IKKE med i fejlen. Kun hvad der var galt med formen.
    throw medPris(k, tokensInd, tokensUd, env, formfejl(v.fejl));
  }

  return {
    overskrift: v.obj.overskrift.trim(),
    punkter: v.obj.punkter.map((p) => p.trim()),
    fritekst: v.obj.fritekst.trim(),
    tokensInd,
    tokensUd,
    leverandoer: k.navn,
    model: k.model,
    promptVersion: REFERAT_PROMPT_VERSION,
    prisOere: prisOere(tokensInd, tokensUd, env),
  };
}

function brugsfejl(besked) {
  const f = new Error("Referat: " + besked);
  f.kode = "referat_brug";
  return f;
}
function kaldfejl(besked, status, uddrag, slags) {
  const f = new Error("Referat: " + besked);
  f.kode = "referat_kald";
  if (status) f.status = status;
  if (uddrag) f.uddrag = uddrag;
  if (slags) f.slags = slags;
  return f;
}
// ⚠️ EN FEJL KAN VAERE BETALT. Svarede leverandoeren, er der brugt tokens —
// ogsaa naar svaret er ubrugeligt. Prisen er KENDT de to steder, hvor der
// kastes EFTER et svar, og den blev smidt vaek indtil 3/10-2026.
//
// Konsekvensen er ikke en manglende linje i et regnskab: det er et loft, der
// ikke holder. En model, der begynder at fejle formvalideringen, ville kunne
// braende en kundes kvote usynligt, netop fordi intet blev bogfoert.
//
// Fundet i proeveplanens trin 4: 59.000 gange bogstavet "a" gav 502
// referat_ubrugeligt — og kostede rigtige penge, som ingen saa.
//
// Derfor baerer fejlen prisen med sig. Den, der fanger den, kan bogfoere.
// Fejl kastet FOER et svar (timeout, 401, 403, netvaerk) baerer ingen pris, og
// saa er der heller ikke noget at bogfoere. Vi gaetter aldrig.
function medPris(k, tokensInd, tokensUd, env, fejl) {
  fejl.tokensInd = tokensInd;
  fejl.tokensUd = tokensUd;
  fejl.prisOere = prisOere(tokensInd, tokensUd, env);
  fejl.leverandoer = k.navn;
  fejl.model = k.model;
  return fejl;
}

function formfejl(fejl) {
  const f = new Error("Referat: svaret bestod ikke formvalideringen: " + fejl.join(" · "));
  f.kode = "referat_form";
  f.fejl = fejl;
  return f;
}

module.exports = {
  referer, prisenhed, prisOere, valider,
  // Eksporteret til test. Kald dem ikke fra produktionskode.
  _hentKonfig: hentKonfig,
  _LEVERANDOERER: LEVERANDOERER,
  _EUR_TIL_DKK: EUR_TIL_DKK,
};
