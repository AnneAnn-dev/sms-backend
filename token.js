// ─────────────────────────────────────────────────────────────────────────────
// TOKEN — kort, kryptografisk sikkert lead_token til formular-URL'er
//
// 12 tegn fra et 36-tegns alfabet = ~4,7·10^18 kombinationer. Uforudsigeligt nok
// til at fungere som en capability-URL (den der har linket, kan se formularen).
//
// Brugt i onboarding.js når en call-række oprettes:
//   const { generateToken } = require("./token");
//   lead_token: generateToken()
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require("crypto");

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"; // 36 tegn (a-z, 0-9)

function generateToken(size = 12) {
  let out = "";
  while (out.length < size) {
    const byte = crypto.randomBytes(1)[0];
    // 252 = 36 * 7. Kasser bytes >= 252 for at undgå modulo-bias, så alle
    // 36 tegn er lige sandsynlige.
    if (byte < 252) out += ALPHABET[byte % 36];
  }
  return out;
}

module.exports = { generateToken };
