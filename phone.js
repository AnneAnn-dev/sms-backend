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

module.exports = { normalizePhone, maskerTlf, maskerMail };
