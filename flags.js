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

  // Kunder kendes paa telefonnummer (D88 trin 1b, 18/10-26): /formular og
  // /opret-opgave knytter opgaven til en kunde via kundematch.js. Slukket =
  // opgaver oprettes praecis som foer, uden kunde. Uafhaengig af TILBUD_AKTIV,
  // saa matchningen kan koere i prod, foer Kunder-fanen vises (D88 trin 1).
  KUNDE_MATCH_AKTIV: flag("KUNDE_MATCH_AKTIV"),

  // S34 (D88 trin 2, 19/10-26): kundeformularens link virker én gang.
  // Slukket = linket kan bruges igen som foer, men calls.formular_brugt_at
  // skrives stadig. Se formular-engangs.js.
  FORMULAR_ENGANGS_AKTIV: flag("FORMULAR_ENGANGS_AKTIV"),

  // Fase 3, T6 (29/10-26): webhooken synker Frisbii -> firma_moduler efter
  // hvert event med et abonnement, logger ukendte event-typer og alarmerer ved
  // ukendt produkt eller fejl (D92). Slukket = webhooken som foer T6.
  // Rollback-vejen for T6-T8. Se frisbii-webhook-synk.js.
  FASE3_SYNK: flag("FASE3_SYNK"),

  // D94 trin 3b (29/10-26): "Slet kunde" i Kunder-appen. Slukket = ruterne
  // svarer 404, og knappen vises ikke. Sletningen kan ikke fortrydes — derfor
  // eget flag, uafhaengigt af TILBUD_AKTIV. Se slet_kunde() i migrationen
  // 20261029100000_slet_kunde.sql.
  SLET_KUNDE_AKTIV: flag("SLET_KUNDE_AKTIV"),

  // D94 trin 4 (30/10-26): "Læg sammen med en anden kunde" i Kunder-appen.
  // Slukket = ruterne svarer 404, og knappen vises ikke. Kan ikke fortrydes —
  // derfor eget flag. Se laeg_sammen_kunder() i migrationen
  // 20261030100000_laeg_sammen_kunder.sql.
  LAEG_SAMMEN_AKTIV: flag("LAEG_SAMMEN_AKTIV"),
};
