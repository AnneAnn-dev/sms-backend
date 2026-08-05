#!/usr/bin/env node
/**
 * smoke.js — roegtest af Dit Digitale Kontor
 *
 * BRUG:
 *   node smoke.js            -> staging (alle tjek)
 *   node smoke.js --prod     -> prod (KUN laesende tjek)
 *
 * Exit code 0 = groen, 1 = roed.
 *
 * REGEL: roed betyder stop. Enten fixer du koden, eller ogsaa fixer du tjekket.
 * Deployer du forbi en roed roegtest én gang, er den vejledende for altid.
 *
 * VEDLIGEHOLD: hver driftsfejl fremover faar et tjek, der ville have fanget den.
 */

"use strict";

// =====================================================================
// KONFIGURATION
// Saettes som env vars paa DIN maskine (fx i en .env.smoke du IKKE committer).
// Scriptet bruger kun anon-noegler — det skal aldrig have prod service role.
// =====================================================================

const MILJOER = {
  staging: {
    basisUrl:        process.env.SMOKE_STAGING_URL,
    supabaseUrl:     process.env.SMOKE_STAGING_SUPABASE_URL,
    supabaseAnon:    process.env.SMOKE_STAGING_SUPABASE_ANON,
    tilbudForventet: true,   // modulet SKAL vaere taendt i staging
  },
  prod: {
    basisUrl:        process.env.SMOKE_PROD_URL,
    supabaseUrl:     process.env.SMOKE_PROD_SUPABASE_URL,
    supabaseAnon:    process.env.SMOKE_PROD_SUPABASE_ANON,
    tilbudForventet: false,  // SLUKKET i prod indtil du selv taender det
  },
};

const KERNETABELLER = [
  "leads", "kunder", "referater", "tilbud",
  "tilbud_linjer", "firma_profil", "standardfelter",
];

const TIMEOUT_MS = 8000;

// =====================================================================
// RUTER DER SKAL VAERE MONTERET (D23)
//
// Fejlmaaden: et modul, der aldrig blev indlaest i server.js, giver 404.
// Intet crasher, intet logges, og knappen "lykkes" tavst. To forekomster:
// onboarding-link, og frisbii-checkout (fundet 4/8-26, monteret 5/8-26).
// En kommentar i kildekoden var forsvaret begge gange, og den virkede ikke.
//
// REGEL FOR LISTEN: kun ruter, der skal findes i BEGGE miljoeer. Ruter bag et
// feature flag hoerer ikke hjemme her — `TILBUD_AKTIV=false` giver 404 MED
// VILJE, og et permanent roedt tjek laerer dig at ignorere roedt. Tilbudsruterne
// tjekkes derfor betinget af tilstand.tilbud, ikke her.
//
// KRAV TIL HVERT KALD: bivirkningsfrit i prod. Kroppen skal falde paa den
// FOERSTE validering i handleren, saa kaldet aldrig naar hverken database
// eller ekstern tjeneste. Er du i tvivl om en rute, saa laes handleren, foer
// du foejer den til — et tjek, der skriver i prod, er vaerre end intet tjek.
// =====================================================================

const MONTEREDE_RUTER = [
  {
    navn: "POST /checkout/start",
    sti: "/checkout/start",
    metode: "POST",
    headers: { "Content-Type": "application/json" },
    krop: "{}",
    // Trygt: requireConfig() og looksLikeEmail() koerer BEGGE foer fetch mod
    // Frisbii. Tomt body stopper i e-mailtjekket -> 400 invalid_email. Der
    // oprettes aldrig en session og aldrig en kunde.
    // 500 server_misconfigured = monteret, men FRISBII_PLAN_HANDLE eller
    // SIMPLY_BASE_URL mangler i Railway. Faelden 5/8: staging var groen,
    // prod svarede 404, fordi commiten kun laa paa staging-branchen.
  },

  // TILFOEJ HER, naar du har laest handleren og bekraeftet, at et tomt/ugyldigt
  // kald falder paa foerste validering uden at skrive noget:
  //   POST /opret-opgave      (skriver leads — verificér FOERST)
  //   Frisbii-webhookens sti  (idempotens-guarden goer den formentlig tryg)
];

// =====================================================================
// HJAELPERE
// =====================================================================

// Nogle tjek maa gerne raabe uden at faelde koerslen: en midlertidig tilstand,
// du allerede kender til, skal ikke give ROED. Roed skal betyde roed - ellers
// laerer man sig selv at ignorere den.
class Advarsel extends Error {}

// Udfyldes af /health-tjekket og bruges af de senere tjek, saa de kan SPOERGE
// serveren om dens tilstand i stedet for at have en haardkodet forventning,
// nogen skal huske at rette.
const tilstand = { tilbud: null, opkaldSignatur: null };

const erProd = process.argv.includes("--prod");
const miljo  = erProd ? "prod" : "staging";
const cfg    = MILJOER[miljo];

async function hent(url, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal, redirect: "manual" });
  } finally {
    clearTimeout(t);
  }
}

// Fanger tastefejl i .env.smoke FOER vi begynder at ringe. Uden den giver en
// forkert adresse bare "fetch failed" paa hvert eneste tjek — seks roede linjer
// der ikke peger paa aarsagen. Samme princip som fail-closed i app-config.js.
function normaliserUrl(raa, navn) {
  const u = String(raa).trim().replace(/\/+$/, "");        // fjern skraastreg til sidst
  if ((u.match(/:\/\//g) || []).length !== 1) {
    throw new Error(`${navn}: "${raa}" — skemaet (https://) staar ikke praecis én gang`);
  }
  if (!/^https?:\/\//.test(u)) {
    throw new Error(`${navn}: "${raa}" — skal begynde med https://`);
  }
  if (/\s/.test(u)) {
    throw new Error(`${navn}: "${raa}" — indeholder mellemrum`);
  }
  return u;
}

function projektRef(url) {
  const m = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url || "");
  return m ? m[1] : "(kunne ikke aflaeses)";
}

async function supa(sti) {
  return hent(`${cfg.supabaseUrl}/rest/v1/${sti}`, {
    headers: { apikey: cfg.supabaseAnon, Authorization: `Bearer ${cfg.supabaseAnon}` },
  });
}

// =====================================================================
// TJEKKENE
//   sikker: true  -> maa koere mod prod (laeser kun, skriver aldrig)
//   sikker: false -> kun staging
// =====================================================================

const TJEK = [

  {
    navn: "Appen svarer (/health)",
    sikker: true,
    async kor() {
      const r = await hent(`${cfg.basisUrl}/health`);
      if (r.status !== 200) throw new Error(`status ${r.status}, forventede 200`);
      const krop = await r.json().catch(() => ({}));
      tilstand.tilbud         = krop.tilbud ?? null;
      tilstand.opkaldSignatur = krop.opkaldSignatur ?? null;
      return `status 200 (tilbud: ${tilstand.tilbud === null ? "ukendt" : tilstand.tilbud ? "TAENDT" : "SLUKKET"}, signatur: ${tilstand.opkaldSignatur ?? "ukendt"})`;
    },
  },

  {
    // Fanger fejlen fra 10/7-26: staging-siderne talte med PROD-projektet,
    // og magic links blev afvist som "udloebet". Tjekker BAADE at configen
    // svarer, og at den peger paa det rigtige miljoe.
    navn: "/config.js peger paa det rigtige Supabase-projekt",
    sikker: true,
    async kor() {
      const r = await hent(`${cfg.basisUrl}/config.js`);
      if (r.status !== 200) throw new Error(`status ${r.status} — env vars mangler paa serveren?`);
      const tekst = await r.text();
      const ref = projektRef(cfg.supabaseUrl);
      if (!tekst.includes(ref)) {
        throw new Error(`configen peger IKKE paa ${ref} — forkert miljoe i browseren`);
      }
      if ((r.headers.get("cache-control") || "") !== "no-store") {
        throw new Error("mangler Cache-Control: no-store — configen kan overleve et noegleskift");
      }
      return `peger paa ${ref}, no-store`;
    },
  },

  {
    // Det vigtigste tjek i filen: det tester en AFVISNING. Et tjek der kun saa
    // "endpointet svarer" ville bestaa med glans, hvis signaturvalideringen
    // var fjernet — og saa kan hvem som helst skrive leads ind i databasen.
    //
    // Kroppen er bevidst ufuldstaendig, saa selv hvis valideringen ER braekket,
    // kan kaldet ikke naa at oprette en rigtig raekke. Ellers ville tjekket
    // vaere farligst netop den dag, det fejler.
    navn: "/opkald AFVISER ugyldig Twilio-signatur",
    sikker: true,
    async kor() {
      const r = await hent(`${cfg.basisUrl}/opkald`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Twilio-Signature": "ugyldig-signatur-fra-roegtesten",
        },
        body: "From=&To=&SmokeTest=1",
      });
      if (r.status >= 500) throw new Error(`serverfejl ${r.status} - afviste, men af den forkerte grund`);

      // Er serveren i "log"-tilstand, ER det meningen at den ikke afviser endnu.
      // Saa er det en ADVARSEL med en huskeseddel - ikke en fejl.
      if (tilstand.opkaldSignatur === "log") {
        if (r.status !== 200) return `afvist med ${r.status} (bedre end forventet i log-tilstand)`;
        throw new Advarsel("signaturkontrol koerer i LOG-tilstand - accepterer stadig. Saet OPKALD_SIGNATUR=haandhaev naar et rigtigt opkald er set godkendt i loggen");
      }

      if (r.status === 200) throw new Error("ACCEPTEREDE et kald med ugyldig signatur");
      return `afvist med ${r.status}`;
    },
  },

  {
    // Redningsvejen for glemt adgangskode. UDEN denne rute giver POST 404,
    // fetch kaster ikke, og knappen "lykkes" tavst uden at sende nogen mail.
    navn: "Redningsvejen findes (POST /onboarding/nyt-link)",
    sikker: true,
    async kor() {
      const r = await hent(`${cfg.basisUrl}/onboarding/nyt-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "roegtest-findes-ikke@example.invalid" }),
      });
      if (r.status === 404) throw new Error("ruten findes IKKE — knappen fejler tavst");
      if (r.status >= 500) throw new Error(`serverfejl ${r.status}`);
      return `svarer ${r.status}`;
    },
  },

  {
    navn: "Dashboardet serveres",
    sikker: true,
    async kor() {
      const r = await hent(`${cfg.basisUrl}/dashboard`);
      if (r.status >= 400) throw new Error(`status ${r.status}`);
      return `status ${r.status}`;
    },
  },

  {
    // Den negative kontrol, og den SKAL staa foer monteringstjekket herunder.
    // Uden den beviser et ≠404-tjek ingenting: svarede serveren 200 paa alt
    // (fejlkonfigureret proxy, en catch-all der kom til at fange for meget),
    // ville hver eneste rute se monteret ud, og suiten ville lyse groent, mens
    // ingenting virkede. Det her tjek er det, der goer det naeste sandt.
    navn: "Roegtesten kan skelne — ukendt rute giver 404",
    sikker: true,
    async kor() {
      const r = await hent(`${cfg.basisUrl}/roegtest/rute-der-ikke-findes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (r.status !== 404) {
        throw new Error(`ukendt rute svarede ${r.status} og ikke 404 — monteringstjekket herunder er dermed vaerdiloest`);
      }
      return "404 som forventet";
    },
  },

  {
    // D23. Koerer HELE listen igennem og samler fundene, i stedet for at stoppe
    // ved den foerste: er tre moduler faldet ud, vil du vide det i én koersel.
    navn: "Kritiske ruter er monteret (≠404)",
    sikker: true,
    async kor() {
      const umonterede = [];
      const serverfejl = [];
      const detaljer = [];

      for (const rute of MONTEREDE_RUTER) {
        const r = await hent(`${cfg.basisUrl}${rute.sti}`, {
          method: rute.metode || "GET",
          headers: rute.headers || {},
          body: rute.krop,
        });
        if (r.status === 404) umonterede.push(rute.navn);
        else if (r.status >= 500) serverfejl.push(`${rute.navn} (${r.status})`);
        else detaljer.push(`${rute.navn}: ${r.status}`);
      }

      if (umonterede.length) {
        throw new Error(`UMONTERET — modulet er ikke indlaest i server.js: ${umonterede.join(", ")}. Fejler tavst for kunden`);
      }
      if (serverfejl.length) {
        throw new Error(`monteret, men svarer serverfejl: ${serverfejl.join(", ")}. For /checkout/start betyder 500 typisk, at FRISBII_PLAN_HANDLE eller SIMPLY_BASE_URL mangler i dette miljoe — Railway-loggen navngiver den`);
      }
      return detaljer.join(" · ");
    },
  },

  {
    // Rodruten (Oe5 trin 3). Backendens domaene er ikke et sted et menneske
    // skal lande — uden ruten ser man Express' raa "Cannot GET /".
    // Tjekker ogsaa MAALET: en redirect til "undefined" er vaerre end en 404,
    // fordi den ser ud til at virke i loggen.
    navn: "Rodruten sender folk videre til sitet",
    sikker: true,
    async kor() {
      const r = await hent(`${cfg.basisUrl}/`);
      if (r.status === 404) throw new Error("rodruten findes ikke — besoegende ser Express' raa fejlside");
      if (r.status !== 302) throw new Error(`status ${r.status}, forventede 302`);
      const maal = r.headers.get("location") || "";
      if (!/^https:\/\/[^\s]+$/.test(maal)) {
        throw new Error(`redirecter til "${maal}" — ikke en gyldig absolut adresse`);
      }
      if (/undefined|\/\/$/.test(maal)) {
        throw new Error(`redirecter til "${maal}" — SIMPLY_BASE_URL mangler eller er tom`);
      }
      return `302 -> ${maal}`;
    },
  },

  {
    // Fanger "db push meldte Finished uden at have lavet noget".
    // 200 = tabellen findes (RLS giver blot 0 raekker til anon).
    // 404 = tabellen findes IKKE.
    navn: "Supabase svarer, og kernetabellerne findes",
    sikker: true,
    async kor() {
      const mangler = [];
      for (const tabel of KERNETABELLER) {
        const r = await supa(`${tabel}?select=*&limit=1`);
        if (r.status === 404) mangler.push(tabel);
        else if (r.status >= 500) throw new Error(`Supabase svarede ${r.status} paa ${tabel}`);
      }
      if (mangler.length) throw new Error(`tabeller mangler: ${mangler.join(", ")}`);
      return `${KERNETABELLER.length} tabeller til stede`;
    },
  },

  {
    // Grov-sigten. Den detaljerede isolation mellem to firmaer testes af
    // rls-isolation-test.js — denne fanger blot, hvis RLS blev slaaet FRA.
    navn: "Anonym bruger kan IKKE laese kundedata (RLS)",
    sikker: true,
    async kor() {
      const r = await supa("kunder?select=id&limit=5");
      if (r.status === 200) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length > 0) {
          throw new Error(`anon fik ${rows.length} raekker ud af kunder — RLS er slaaet fra`);
        }
      }
      return "anon faar ingen raekker";
    },
  },

  {
    // Sikkerhedsegenskaben er: PROD staar aldrig taendt ved et uheld. Den er haard.
    // Staging maa vaere hvad som helst - der er intet at beskytte, og et roedt
    // tjek af bogholderiaarsager laerer dig bare at ignorere roedt.
    navn: "Tilbudsmodulet staar ikke uventet taendt i prod",
    sikker: true,
    async kor() {
      if (tilstand.tilbud === null) throw new Advarsel("kunne ikke laese tilstand fra /health");
      if (erProd && tilstand.tilbud) {
        throw new Error("modulet er TAENDT i PROD - saet TILBUD_AKTIV=false i Railway, hvis det ikke var med vilje");
      }
      return erProd
        ? "prod er slukket"
        : `staging: ${tilstand.tilbud ? "taendt" : "slukket"} (oplysning, ikke krav)`;
    },
  },

];

// =====================================================================
// KOERSEL
// =====================================================================

async function main() {
  const manglerCfg = ["basisUrl", "supabaseUrl", "supabaseAnon"].filter((k) => !cfg[k]);
  if (manglerCfg.length) {
    console.error(`\nSTOP: mangler konfiguration for ${miljo}: ${manglerCfg.join(", ")}\n`);
    process.exit(1);
  }

  // Valider og normaliser adresserne FOER foerste kald.
  try {
    cfg.basisUrl    = normaliserUrl(cfg.basisUrl, `SMOKE_${miljo.toUpperCase()}_URL`);
    cfg.supabaseUrl = normaliserUrl(cfg.supabaseUrl, `SMOKE_${miljo.toUpperCase()}_SUPABASE_URL`);
  } catch (err) {
    console.error(`\nSTOP: fejl i .env.smoke\n  ${err.message}\n`);
    process.exit(1);
  }

  // Fail-closed: staging-tilstand maa ALDRIG ramme prod ved et uheld.
  if (!erProd && MILJOER.prod.basisUrl && cfg.basisUrl === MILJOER.prod.basisUrl) {
    console.error("\nSTOP: staging-URL peger paa prod. Tjek dine env-variable.\n");
    process.exit(1);
  }

  console.log(`\nRoegtest — miljoe: ${miljo.toUpperCase()}`);
  console.log(`URL:          ${cfg.basisUrl}`);
  console.log(`Supabase-ref: ${projektRef(cfg.supabaseUrl)}`);
  if (erProd) console.log("Kun laesende tjek koeres.");
  console.log("");

  const start = Date.now();
  let fejlet = 0, sprunget = 0, advarsler = 0;

  for (const t of TJEK) {
    if (erProd && !t.sikker) {
      console.log(`  -    ${t.navn} (springes over i prod)`);
      sprunget++;
      continue;
    }
    try {
      const detalje = await t.kor();
      console.log(`  OK   ${t.navn} — ${detalje}`);
    } catch (err) {
      if (err instanceof Advarsel) {
        console.log(`  ADV  ${t.navn} - ${err.message}`);
        advarsler++;
        continue;
      }
      console.log(`  FEJL ${t.navn} - ${err.message}`);
      fejlet++;
    }
  }

  const sek  = ((Date.now() - start) / 1000).toFixed(1);
  const kort = TJEK.length - sprunget;
  console.log("");
  if (fejlet === 0) {
    console.log(`GROEN - ${kort - advarsler}/${kort} tjek bestaaet paa ${sek} sek.` +
      (advarsler ? ` (${advarsler} advarsel/advarsler - se ovenfor)` : "") + "\n");
    process.exit(0);
  }
  console.log(`ROED — ${fejlet} af ${kort} tjek fejlede (${sek} sek.). Deploy IKKE.\n`);
  process.exit(1);
}

main().catch((err) => {
  console.error("\nROED — roegtesten crashede:", err.message, "\n");
  process.exit(1);
});
