// ─────────────────────────────────────────────────────────────────────────────
// PHONE — normalisering og log-maskering af telefonnumre og mailadresser.
//
// Twilio leverer From som E.164 (+4512345678), men håndværkeren taster numre i
// alle mulige former ("12 34 56 78", "+45 12 34 56 78", "0045 12345678").
// normalizePhone() bringer begge sider til samme kanoniske E.164-form, så
// sammenligningen altid er æbler-mod-æbler.
//
//   const { normalizePhone } = require("./phone");
//   normalizePhone("12 34 56 78")  // → "+4512345678"
//
// BEMÆRK: et bart 8-cifret nummer antages dansk (+45). Udenlandske numre SKAL
// tastes med landekode (+49…, +46…), ellers gættes der forkert på +45.
//
// maskerTlf()/maskerMail() hører hjemme her og IKKE i det enkelte modul: da
// maskerTlf lå lokalt i onboarding.js, kunne frisbii-webhook.js ikke bruge den
// og loggede numre råt. Ét sted at rette, alle kaldere følger med.
// ─────────────────────────────────────────────────────────────────────────────

function normalizePhone(input) {
  if (input == null) return null;

  const raw     = String(input).trim();
  const hadPlus = raw.startsWith("+");
  let digits    = raw.replace(/\D/g, ""); // fjern alt der ikke er cifre

  if (!digits) return null;

  // 0045… → 45…  (international prefiks skrevet med 00)
  if (digits.startsWith("00")) digits = digits.slice(2);

  // Bart 8-cifret nummer uden + → antag dansk
  if (!hadPlus && digits.length === 8) return "+45" + digits;

  // 45XXXXXXXX (10 cifre) → +45XXXXXXXX
  if (digits.startsWith("45") && digits.length === 10) return "+" + digits;

  // Ellers: antag at cifrene allerede inkluderer landekode
  return "+" + digits;
}

// ─── LOG-HYGIEJNE ────────────────────────────────────────────────────────────
// Telefonnumre og mailadresser på kundens kunder er PERSONOPLYSNINGER. De havnede
// før i Railways log med en opbevaringstid, vi ikke selv styrer, uden for RLS og
// uden for enhver slettepolitik. Maskering bevarer fejlsøgningsværdien og fjerner
// problemet.
//
// SYNLIGT BUDGET: fem tegn. For et dansk nummer er det "+45" + de to første
// cifre — nok til at se land og operatørserie, og til at se at nummeret
// overhovedet har den rigtige form. De resterende cifre er dem, der udpeger en
// person, og de forsvinder.
//
//   +4530518313  →  +4530******
//
// Antal stjerner følger nummerets længde med vilje: en forkert formateret værdi
// skal kunne ses i loggen uden at afsløre indholdet.
const SYNLIGE_TEGN = 5;

function maskerTlf(input) {
  const t = String(input ?? "").trim();
  if (!t) return "(tomt)";
  if (t.length <= SYNLIGE_TEGN + 3) return "***";   // for kort til at maskere meningsfuldt
  return t.slice(0, SYNLIGE_TEGN) + "*".repeat(t.length - SYNLIGE_TEGN);
}

// Domænet bevares: det er dét, der fortæller hvilken kunde en fejl hører til,
// og det er sjældent i sig selv identificerende for en person. Lokaldelen
// reduceres til to tegn.
//
//   mail@magnoramarketing.dk  →  ma**@magnoramarketing.dk
function maskerMail(input) {
  const t = String(input ?? "").trim();
  if (!t) return "(tomt)";

  const at = t.lastIndexOf("@");
  if (at < 1 || at === t.length - 1) return "***";  // ikke en brugbar adresse

  const lokal   = t.slice(0, at);
  const domaene = t.slice(at);                      // inkl. @
  const synlige = Math.min(2, lokal.length - 1);

  return lokal.slice(0, synlige) + "*".repeat(lokal.length - synlige) + domaene;
}

// ─── PULJEUDVAELGELSE MED VERIFIKATION HOS TWILIO ──────────────────────────
// Baggrund (4/9-26): puljen indeholdt to numre, som Twilio ikke ejede. De var
// frigivet i konsollen (RUNBOOK-numre afsnit 5, trin 2), uden at raekken blev
// slettet (trin 3). Provisioneringen stolede blindt paa tabellen og tildelte en
// kunde et DOEDT nummer: ingen webhook, ingen rutning, intet opkald naaede frem.
// Verifikationsopkaldet i onboarding kunne aldrig lykkes, og intet i loggen sagde
// fra — nummeret findes jo i vores egen database.
//
// PRINCIP: spoerg leverandoeren, stol ikke paa vores egen tabel. Samme laerdom
// som Frisbii-noeglen samme dag (D39 i registret).
//
// Hjaelperne bor HER, fordi phone.js allerede ejer nummer-reglerne og er delt
// mellem onboarding.js, frisbii-webhook.js og onboarding-link.js. En hjaelper,
// der ikke kan deles, bliver ikke delt (laerdom 19/8-26).
// Klienterne sendes ind som argumenter, saa phone.js forbliver afhaengighedsfri.

// Twilios faktiske beholdning som et Set af normaliserede numre.
// KASTER ved API-fejl — med vilje: kan vi ikke spoerge Twilio, udleverer vi
// ikke et uverificeret nummer. I webhook-stien betyder det dead-letter og
// genbehandling ved Frisbiis retry. Samme fail-loud-princip som trial-opslaget.
async function hentEjedeNumre(twilioClient) {
  const liste = await twilioClient.incomingPhoneNumbers.list({ limit: 1000 });
  return new Set(liste.map((n) => normalizePhone(n.phoneNumber)).filter(Boolean));
}

// Vaelger det foerste ledige puljenummer, som Twilio-kontoen FAKTISK ejer.
// Returnerer ogsaa de spoegelser, der blev sprunget over, og hvor mange
// verificerede ledige der var — saa kalderen kan alarmere paa begge dele.
//
// SKRIVER INTET. Spoegelsesraekker slettes ikke automatisk: oprydning i prod
// sker med aabne oejne, jf. RUNBOOK-numre. Vi springer dem over og raaber op.
//
// `maxKandidater` er et loft paa, hvor mange raekker vi henter — er alle de
// foerste 20 spoegelser, er situationen alligevel en alarm og ikke et
// gennemloeb. Bemaerk at `ledigeVerificeret` derfor er "mindst dette antal",
// ikke en eksakt total; det er rigeligt til en lav-pulje-graense paa 3.
async function vaelgLedigtNummer({ supabase, twilioClient, maxKandidater = 20 }) {
  const nowIso = new Date().toISOString();

  const { data: kandidater, error } = await supabase
    .from("phone_numbers")
    .select("id, number")
    .is("firm_id", null)
    .or(`quarantined_until.is.null,quarantined_until.lt.${nowIso}`)
    .order("number")
    .limit(maxKandidater);
  if (error) throw error;

  const ejede = await hentEjedeNumre(twilioClient);

  const spoegelser = [];
  let valgt = null;
  for (const k of kandidater || []) {
    if (ejede.has(normalizePhone(k.number))) {
      if (!valgt) valgt = k;
    } else {
      spoegelser.push(k.number);
    }
  }
  const ledigeVerificeret = (kandidater || []).length - spoegelser.length;

  return { valgt, spoegelser, ledigeVerificeret };
}

module.exports = {
  normalizePhone,
  maskerTlf,
  maskerMail,
  hentEjedeNumre,
  vaelgLedigtNummer,
};
