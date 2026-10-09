#!/usr/bin/env node
/**
 * vagt.js — loebende overvaagning af det, kerneflowet hviler paa (D3, D77)
 *
 * HVORFOR: DAWA lukkede 1/10-26 og svarede 410. Kundeformularen kunne ikke
 * sendes i tre dage, og INTET sagde fra — roegtesten koerer kun, naar nogen
 * starter den, og den kendte ikke de eksterne tjenester. Dette script koerer
 * hvert 15. minut som en Railway-cron-service og melder hvert tjek til
 * Healthchecks.io, som afgoer, hvornaar Ann skal have besked:
 *   - kun ved SKIFT (groen -> roed og roed -> groen), ikke ved hver koersel
 *   - og naar livstegnet "vagt-liv" udebliver, dvs. naar vagten SELV er doed.
 * Alarmen gaar dermed ikke via Scaleway eller Twilio — den kommer ogsaa, naar
 * det er dem, der er nede.
 *
 * BRUG:
 *   node vagt.js                 -> koer alle tjek og meld til Healthchecks.io
 *   node vagt.js --toer          -> koer alle tjek, skriv resultatet, meld INTET
 *   node vagt.js --kun adresse   -> kun ét tjek (kan kombineres med --toer)
 *
 * SIKKERHED (vaernene i registret, D3):
 *   1. HC_PING_KEY er en hemmelighed. Den, der har den, kan melde "ok" og
 *      skjule et nedbrud. Kun i Railway + Bitwarden; aldrig i log eller kode.
 *   2. Aarsagen, der sendes til Healthchecks.io, er ALTID vores egen faste
 *      tekst + en HTTP-status. Raa fejltekster fra eksterne API'er sendes
 *      aldrig videre — de kan baere konto-id'er, telefonnumre (S28) eller en
 *      URL med en token. Fra en undtagelse logges kun dens NAVN, ikke teksten.
 *   3. Ingen persondata: ingen numre, navne eller kundedata forlader scriptet.
 *   4. Ingen ny npm-pakke: kun Nodes indbyggede fetch og tls.
 *   5. Kun laesende kald.
 *
 * NYT TJEK? Byg det, saa det ville have fanget en fejl, vi rent faktisk har
 * haft — og braek det én gang med vilje paa staging, foer det kommer i drift.
 * Et tjek, du aldrig har set roedt, er dekoration (samme regel som smoke.js).
 *
 * MILJOE (fail-closed):
 *   Kraevet:  HC_PING_KEY, APPSIGNAL_APP_ENV (production|staging), BASE_URL
 *   Pr. tjek: se KONFIG i hvert tjek. Mangler et tjeks variabler, bliver
 *             netop det tjek roedt ("mangler konfiguration") — resten koerer.
 *   Valgfrit: VAGT_TWILIO_MIN_SALDO   (standard 10; saet 0 paa staging —
 *                                      subkontoen viser altid 0, den traekker
 *                                      paa hovedkontoen)
 *             VAGT_STEMME_MIN_TEGN    (standard 5000)
 *             VAGT_CERT_MIN_DAGE      (standard 14)
 *             VAGT_UDLOEB_MIN_DAGE    (standard 30)
 *             VAGT_UDLOEBSDATOER      fx "scaleway-genai=2027-10-03;adressevaelger=2026-12-31"
 *                                     (kun navne og datoer — ALDRIG noegler)
 *             VAGT_SPRING_OVER        fx "opkald" eller "opkald,stemme" — de
 *                                     navngivne tjek koeres IKKE og meldes
 *                                     ikke. Et ukendt navn stopper vagten
 *                                     (en stavefejl maa ikke ligne et slukket
 *                                     tjek). Brug det i stedet for pause i
 *                                     Healthchecks.io: et ping vaekker et
 *                                     pauset tjek igen.
 *             VAGT_TWILIO_KEY_SID / VAGT_TWILIO_KEY_SECRET
 *                                     egen API-noegle til vagten; ellers
 *                                     bruges TWILIO_ACCOUNT_SID/AUTH_TOKEN
 *             DOEDMANDS_TIMER, ARBEJDSTID_START, ARBEJDSTID_SLUT (som foer)
 */

"use strict";

require("dotenv").config({ quiet: true });
const tls = require("node:tls");

const TIMEOUT_MS = 10000;

// Adressetjenesten testes gennem VORES eget endpoint (/api/adresse, adresse.js),
// ikke direkte. Saa tester vagten det, kunderne faktisk bruger — hele vejen
// gennem appen til Adressevaelgeren — og adressen paa tjenesten staar kun ét
// sted (8/10-26; foer var den kopieret hertil, D77).
const ADRESSE_PROEVE = "Rådhuspladsen 1";   // offentlig adresse, ingen persondata

const argv  = process.argv.slice(2);
const toer  = argv.includes("--toer");
const kunI  = argv.indexOf("--kun");
const kun   = kunI >= 0 ? argv[kunI + 1] : null;

// ─── Miljoe: fail-closed paa det, uden hvilket intet kan meldes ─────────────
function stop(besked) {
  console.error(`vagt: ${besked}`);
  process.exit(1);
}

const MILJOE = { production: "prod", staging: "staging" }[process.env.APPSIGNAL_APP_ENV];
if (!MILJOE) stop(`APPSIGNAL_APP_ENV er "${process.env.APPSIGNAL_APP_ENV || "(ikke sat)"}" — skal vaere production eller staging`);
if (!toer && !process.env.HC_PING_KEY) stop("HC_PING_KEY mangler (eller koer med --toer)");
const BASE_URL = (process.env.BASE_URL || "").trim().replace(/\/+$/, "");
if (!/^https:\/\/[^\s/]+$/.test(BASE_URL)) stop("BASE_URL mangler eller er ikke en https-adresse uden sti");

// ─── Hjaelpere ───────────────────────────────────────────────────────────────
class Fejl extends Error {}                    // en FORVENTET fejl med fast tekst
const fejl = (tekst) => { throw new Fejl(tekst); };

function kraev(...navne) {
  const mangler = navne.filter((n) => !process.env[n]);
  if (mangler.length) fejl(`mangler konfiguration (${mangler.join(", ")})`);
}

async function hent(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual" });
}

// Supabase-noeglerne (sb_publishable/sb_secret) sendes i apikey-headeren;
// nogle stier vil OGSAA se Bearer. Samme moenster som check-env.js.
async function supa(sti, noegle) {
  const url = process.env.SUPABASE_URL.replace(/\/+$/, "") + sti;
  let res = await hent(url, { headers: { apikey: noegle } });
  if (res.status === 401) res = await hent(url, { headers: { apikey: noegle, Authorization: `Bearer ${noegle}` } });
  return res;
}

function basic(bruger, kode) {
  return "Basic " + Buffer.from(`${bruger}:${kode}`).toString("base64");
}

function dageTil(dato) {
  return Math.floor((new Date(dato).getTime() - Date.now()) / 86_400_000);
}

// Lokal tid i Koebenhavn (samme metode som den gamle dodmandsknap.js:
// en-US giver stabile "Mon".."Sun" paa tvaers af Node/ICU-versioner).
function koebenhavnNu() {
  const dele = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Copenhagen", weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  return {
    ugedag: dele.find((d) => d.type === "weekday").value,
    time:   Number(dele.find((d) => d.type === "hour").value),
  };
}

// ─── Tjekkene ────────────────────────────────────────────────────────────────
// Hvert tjek returnerer en kort, FAST tekst ved succes og kaster Fejl(tekst)
// ved fejl. Andre undtagelser (timeout, netvaerk) bliver til "<navn>: ingen
// forbindelse (<TypeNavn>)" — teksten fra undtagelsen bruges aldrig.
const TJEK = [
  {
    navn: "app",
    // Fanger: appen nede, forkert deploy, Railway-udfald.
    async koer() {
      const res = await hent(`${BASE_URL}/health`);
      if (res.status !== 200) fejl(`/health svarer ${res.status}`);
      return "svarer 200";
    },
  },
  {
    navn: "adresse",
    // Fanger: DAWA 1/10-26 (410), Adressevaelgeren nede, den faelles token
    // udloebet ved brugerstyringen, adresse.js ikke monteret (404).
    // Soeger og slaar det foerste fund op — samme to kald som formularen.
    async koer() {
      const s = await hent(`${BASE_URL}/api/adresse/soeg?q=${encodeURIComponent(ADRESSE_PROEVE)}`);
      if (s.status !== 200) fejl(`soegning svarer ${s.status}`);
      const sd = await s.json().catch(() => null);
      const hus = sd && Array.isArray(sd.forslag) ? sd.forslag.find((f) => f && f.id) : null;
      if (!hus) fejl("soegning gav intet husnummer");
      const o = await hent(`${BASE_URL}/api/adresse/${encodeURIComponent(hus.id)}`);
      if (o.status !== 200) fejl(`opslag svarer ${o.status}`);
      const od = await o.json().catch(() => null);
      if (!od || !/^\d{4}$/.test(String(od.postnr || ""))) fejl("opslag gav intet postnummer");
      return "soegning og opslag virker";
    },
  },
  {
    navn: "supabase",
    // Fanger: Supabase nede, anon-noeglen roteret uden at appen fulgte med.
    // KONFIG: SUPABASE_URL, SUPABASE_ANON_KEY
    async koer() {
      kraev("SUPABASE_URL", "SUPABASE_ANON_KEY");
      const res = await supa("/auth/v1/health", process.env.SUPABASE_ANON_KEY);
      if (res.status !== 200) fejl(`auth svarer ${res.status}`);
      return "svarer 200";
    },
  },
  {
    navn: "twilio",
    // Fanger: kontoen suspenderet/lukket, saldoen tom (D9 — auto-refill kan
    // fejle, fx paa et udloebet kort). KONFIG: TWILIO_ACCOUNT_SID +
    // (VAGT_TWILIO_KEY_SID/SECRET eller TWILIO_AUTH_TOKEN)
    async koer() {
      kraev("TWILIO_ACCOUNT_SID");
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const auth = process.env.VAGT_TWILIO_KEY_SID
        ? basic(process.env.VAGT_TWILIO_KEY_SID, process.env.VAGT_TWILIO_KEY_SECRET || "")
        : (kraev("TWILIO_AUTH_TOKEN"), basic(sid, process.env.TWILIO_AUTH_TOKEN));
      const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;

      const kontoRes = await hent(`${base}.json`, { headers: { Authorization: auth } });
      if (kontoRes.status !== 200) fejl(`konto svarer ${kontoRes.status}`);
      const konto = await kontoRes.json();
      if (konto.status !== "active") fejl(`kontoen er "${String(konto.status).slice(0, 20)}"`);

      const minSaldo = Number(process.env.VAGT_TWILIO_MIN_SALDO ?? 10);
      if (minSaldo <= 0) return "konto aktiv (saldo ikke tjekket)";
      const saldoRes = await hent(`${base}/Balance.json`, { headers: { Authorization: auth } });
      if (saldoRes.status !== 200) fejl(`saldo svarer ${saldoRes.status}`);
      const saldo = Number((await saldoRes.json()).balance);
      if (!Number.isFinite(saldo)) fejl("saldo kunne ikke laeses");
      if (saldo < minSaldo) fejl(`saldo under ${minSaldo}`);
      return "konto aktiv, saldo over graensen";
    },
  },
  {
    navn: "mail",
    // Fanger: afsenderdomaenet ikke laengere godkendt hos Scaleway TEM
    // (DNS/DKIM/SPF), Scaleway-noeglen ugyldig. KONFIG: SCW_SECRET_KEY,
    // SCW_PROJECT_ID, SMTP_FROM, (SCW_REGION)
    async koer() {
      kraev("SCW_SECRET_KEY", "SCW_PROJECT_ID", "SMTP_FROM");
      const region = process.env.SCW_REGION || "fr-par";
      const domaene = process.env.SMTP_FROM.split("@")[1];
      if (!domaene) fejl("SMTP_FROM er ikke en mailadresse");
      const url = `https://api.scaleway.com/transactional-email/v1alpha1/regions/${region}/domains`
        + `?project_id=${encodeURIComponent(process.env.SCW_PROJECT_ID)}&name=${encodeURIComponent(domaene)}`;
      const res = await hent(url, { headers: { "X-Auth-Token": process.env.SCW_SECRET_KEY } });
      if (res.status !== 200) fejl(`Scaleway svarer ${res.status}`);
      const liste = (await res.json()).domains || [];
      const d = liste.find((x) => x.name === domaene);
      if (!d) fejl("afsenderdomaenet findes ikke i projektet");
      if (d.status !== "checked") fejl(`afsenderdomaenet har status "${String(d.status).slice(0, 20)}"`);
      return "afsenderdomaenet godkendt";
    },
  },
  {
    navn: "stemme",
    // Fanger: ElevenLabs-kvoten brugt op — saa kan der ikke laves nye
    // telefonbeskeder. KONFIG: ELEVENLABS_API_KEY (kraever tilladelsen
    // "user_read"; mangler den, svarer ElevenLabs 401 — se registret).
    async koer() {
      kraev("ELEVENLABS_API_KEY");
      const res = await hent("https://api.elevenlabs.io/v1/user/subscription",
        { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } });
      if (res.status !== 200) fejl(`ElevenLabs svarer ${res.status}`);
      const s = await res.json();
      const tilbage = Number(s.character_limit) - Number(s.character_count);
      if (!Number.isFinite(tilbage)) fejl("kvoten kunne ikke laeses");
      const min = Number(process.env.VAGT_STEMME_MIN_TEGN ?? 5000);
      if (tilbage < min) fejl(`under ${min} tegn tilbage af kvoten`);
      return "kvote over graensen";
    },
  },
  {
    navn: "betaling",
    // Fanger: Frisbii-noeglen ugyldig/roteret, kontoen utilgaengelig.
    // KONFIG: FRISBII_PRIVATE_KEY
    async koer() {
      kraev("FRISBII_PRIVATE_KEY");
      const res = await hent("https://api.reepay.com/v1/account",
        { headers: { Authorization: basic(process.env.FRISBII_PRIVATE_KEY, "") } });
      if (res.status !== 200) fejl(`Frisbii svarer ${res.status}`);
      return "svarer 200";
    },
  },
  {
    navn: "udloeb",
    // Fanger: det, der udloeber en dag uden varsel — TLS-certifikatet paa
    // vores eget domaene og de datoer, der staar i VAGT_UDLOEBSDATOER.
    async koer() {
      const vaert = new URL(BASE_URL).hostname;
      const certDage = await new Promise((ok, nej) => {
        const s = tls.connect({ host: vaert, port: 443, servername: vaert, timeout: TIMEOUT_MS }, () => {
          const c = s.getPeerCertificate();
          s.end();
          c && c.valid_to ? ok(dageTil(c.valid_to)) : nej(new Fejl("certifikatet kunne ikke laeses"));
        });
        s.on("timeout", () => { s.destroy(); nej(new Fejl("ingen forbindelse til certifikatet")); });
        s.on("error", () => nej(new Fejl("ingen forbindelse til certifikatet")));
      });
      const certMin = Number(process.env.VAGT_CERT_MIN_DAGE ?? 14);
      if (certDage < certMin) fejl(`certifikatet udloeber om ${certDage} dage`);

      const min = Number(process.env.VAGT_UDLOEB_MIN_DAGE ?? 30);
      for (const par of String(process.env.VAGT_UDLOEBSDATOER || "").split(";").filter(Boolean)) {
        const [navn, dato] = par.split("=").map((x) => x.trim());
        if (!/^[a-z0-9-]{1,30}$/.test(navn || "") || !/^\d{4}-\d{2}-\d{2}$/.test(dato || "")) {
          fejl("VAGT_UDLOEBSDATOER har en linje i forkert format");
        }
        const dage = dageTil(dato);
        if (dage < min) fejl(`${navn} udloeber om ${dage} dage`);
      }
      return `certifikat ${certDage} dage`;
    },
  },
  {
    navn: "opkald",
    // Doedmandsknappen (D3), flyttet hertil fra dodmandsknap.js. Fanger:
    // Twilio-webhooken stopper, nummer-routing forkert, signaturafvisning
    // der blokerer aegte opkald — tavshed uden en eneste fejl.
    // Kun paa hverdage i arbejdstiden. Det tjekkede vindue begynder tidligst
    // ved arbejdstidens start, saa nattens naturlige stilhed ikke giver
    // alarm hver morgen kl. 7.
    // KONFIG: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    // UDEN TRAFIK (foer piloterne) er den roed — saet VAGT_SPRING_OVER=opkald,
    // og fjern det, naar den foerste pilot ringer. (Pause i Healthchecks.io
    // virker ikke: naeste ping vaekker tjekket igen — maalt 8/10-26.)
    async koer() {
      const start = Number(process.env.ARBEJDSTID_START ?? 7);
      const slut  = Number(process.env.ARBEJDSTID_SLUT ?? 17);
      const timer = Number(process.env.DOEDMANDS_TIMER ?? 4);
      const { ugedag, time } = koebenhavnNu();
      if (ugedag === "Sat" || ugedag === "Sun") return "weekend — ikke vurderet";
      if (time < start || time >= slut) return "uden for arbejdstid — ikke vurderet";
      if (time < start + timer) return "arbejdsdagen er under graensen gammel — ikke vurderet endnu";

      kraev("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
      const res = await supa("/rest/v1/calls?select=created_at&order=created_at.desc&limit=1",
        process.env.SUPABASE_SERVICE_ROLE_KEY);
      if (res.status !== 200) fejl(`calls kunne ikke laeses (${res.status})`);
      const raekker = await res.json();
      const sidste = raekker[0] ? new Date(raekker[0].created_at).getTime() : 0;
      const timerSiden = (Date.now() - sidste) / 3_600_000;
      if (timerSiden >= timer) fejl(`ingen opkald i ${timer} timer i arbejdstiden`);
      return "opkald inden for graensen";
    },
  },
];

// ─── Melding til Healthchecks.io ─────────────────────────────────────────────
// Slug = "<miljoe>-<navn>", fx "prod-adresse". ?create=1 opretter tjekket
// automatisk ved foerste melding, saa der ikke skal oprettes noget i haanden.
async function meld(navn, ok, tekst) {
  if (toer) return;
  const slug = `${MILJOE}-${navn}`;
  const url  = `https://hc-ping.com/${process.env.HC_PING_KEY}/${slug}${ok ? "" : "/fail"}?create=1`;
  try {
    const res = await hent(url, { method: "POST", body: tekst.slice(0, 200) });
    if (res.status !== 200 && res.status !== 201) console.error(`  (melding om ${slug} gav ${res.status})`);
  } catch (e) {
    // URL'en indeholder noeglen — den maa ALDRIG staa i loggen. Kun typen.
    console.error(`  (melding om ${slug} naaede ikke frem: ${e.name})`);
  }
}

(async () => {
  const kendte = TJEK.map((t) => t.navn);
  const springOver = String(process.env.VAGT_SPRING_OVER || "")
    .split(",").map((x) => x.trim()).filter(Boolean);
  const ukendte = springOver.filter((n) => !kendte.includes(n));
  if (ukendte.length) stop(`VAGT_SPRING_OVER naevner ukendt tjek "${ukendte.join(", ")}" — kendte: ${kendte.join(", ")}`);

  // --kun vinder over VAGT_SPRING_OVER: et tjek, man beder om, koeres.
  const valgte = kun ? TJEK.filter((t) => t.navn === kun) : TJEK.filter((t) => !springOver.includes(t.navn));
  if (kun && !valgte.length) stop(`ukendt tjek "${kun}" — kendte: ${kendte.join(", ")}`);

  console.log(`vagt — miljoe: ${MILJOE}${toer ? " (toerloeb: intet meldes)" : ""}`);
  if (!kun && springOver.length) console.log(`  sprunget over (VAGT_SPRING_OVER): ${springOver.join(", ")}`);
  let roede = 0;

  for (const t of valgte) {
    let ok, tekst;
    try {
      let svar;
      try {
        svar = await t.koer();
      } catch (e) {
        // Timeout/netvaerk (ikke en Fejl med fast tekst): proev én gang til
        // efter 5 sek., foer der meldes roedt. 8/10-26 15:32 faldt app og
        // adresse i én enkelt koersel uden genstart eller hul i appens
        // metrikker — et netvaerksblink, ikke et nedbrud. En rigtig fejl
        // (forkert status/indhold) er en Fejl og meldes stadig med det samme.
        if (e instanceof Fejl) throw e;
        console.log(`  ...   ${t.navn}: ${e.name} — proever igen om 5 sek.`);
        await new Promise((r) => setTimeout(r, 5000));
        svar = await t.koer();
      }
      tekst = `${t.navn}: ${svar}`;
      ok = true;
    } catch (e) {
      ok = false;
      roede++;
      tekst = e instanceof Fejl
        ? `${t.navn}: ${e.message}`
        : `${t.navn}: ingen forbindelse (${e.name})`;   // aldrig e.message
    }
    console.log(`  ${ok ? "OK  " : "ROED"}  ${tekst}`);
    await meld(t.navn, ok, tekst);
  }

  // Livstegnet: meldes til sidst og KUN ved en hel koersel, ogsaa naar
  // tjek er roede. Udebliver det, er vagten selv doed — det tjek er det
  // eneste, der skal have kort periode i Healthchecks.io (15 min + 20 min).
  if (!kun) await meld("vagt-liv", true, `vagt-liv: ${valgte.length} tjek koert, ${roede} roede`);

  console.log(`${roede === 0 ? "GROEN" : "ROED"} — ${valgte.length - roede}/${valgte.length} tjek bestaaet`);
  process.exit(0);   // altid 0: alarmen er Healthchecks.io's opgave, ikke exit-koden
})();
