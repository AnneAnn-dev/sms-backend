// ─────────────────────────────────────────────────────────────────────────────
// PHONE — normalisering af telefonnumre til pålidelig matching mod hvidlisten.
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

module.exports = { normalizePhone };
