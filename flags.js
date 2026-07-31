// flags.js
// -----------------------------------------------------------------------------
// Feature flags: miljoevariable oversat til rigtige booleans ÉT sted.
//
// HVORFOR DENNE FIL: Railway (og .env) leverer altid TEKST. I JavaScript er en
// ikke-tom tekststreng SAND — saa `if (process.env.TILBUD_AKTIV)` ville vaere
// sand, selv naar der staar "false". Modulet ville staa taendt i prod uden at
// nogen havde besluttet det. Oversaettelsen skal derfor ske praecis ét sted.
//
// === "true" betyder: KUN ordet true taender. Glemt, tom, "True", "1", "ja"
// → SLUKKET. Det er fail-closed: en tastefejl i Railway slukker modulet,
// den taender det ikke.
//
// BRUG i server.js:  const { TILBUD_AKTIV } = require("./flags");
//
// Et flag har en levetid. Naar modulet har koert TAENDT i prod i nogle uger
// uden haendelser, fjernes flag'et og if-saetningen igen (se runbooken).
// Fjern ALDRIG et flag, mens det staar slukket i prod — saa taender du noget
// utestet med ét slag.
// -----------------------------------------------------------------------------

const flag = (navn) => process.env[navn] === "true";

module.exports = {
  // Tilbudsmodulet (referater + tilbud). true i staging, false i prod
  // indtil modulet er QA'et af Anne.
  TILBUD_AKTIV: flag("TILBUD_AKTIV"),
};
