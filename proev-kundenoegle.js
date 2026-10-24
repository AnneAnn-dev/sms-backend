/**
 * proev-kundenoegle.js — tabeltest af kundeNoegle() i phone.js (D88, trin 1a).
 *
 * Kører uden netværk og uden .env. Hvert tilfælde er en regel fra D88 eller et
 * nummer, der faktisk forekommer: markøren på syntetiske opkald, Twilios
 * erstatningsnumre for skjult nummer, og de former, en håndværker taster.
 *
 *   node proev-kundenoegle.js
 */

'use strict';

const { kundeNoegle } = require('./phone');

const TILFAELDE = [
  // [input, forventet, hvorfor]
  ['+4512345678',        '+4512345678', 'Twilios form (E.164)'],
  ['12345678',           '+4512345678', 'bart 8-cifret = dansk'],
  ['12 34 56 78',        '+4512345678', 'med mellemrum'],
  ['+45 12 34 56 78',    '+4512345678', '+45 med mellemrum'],
  ['0045 12345678',      '+4512345678', '00-præfiks'],
  ['4512345678',         '+4512345678', '45 + 8 cifre uden +'],
  ['12-34-56-78',        '+4512345678', 'med bindestreger'],
  ['  12345678  ',       '+4512345678', 'med luft omkring'],
  ['+4915112345678',     '+4915112345678', 'tysk nummer er stadig en kunde'],
  ['+46701234567',       '+46701234567', 'svensk nummer'],

  ['Manuel oprettelse',  null, 'markøren på syntetiske opkald (/opret-opgave)'],
  ['anonymous',          null, 'Twilio ved skjult nummer siden 17/5-23'],
  ['Anonymous',          null, 'store bogstaver'],
  ['+266696687',         null, 'Twilio ANONYMOUS'],
  ['+7378742833',        null, 'Twilio RESTRICTED'],
  ['+2562533',           null, 'Twilio BLOCKED'],
  ['+8656696',           null, 'Twilio UNKNOWN'],
  ['+86282452253',       null, 'Twilio UNAVAILABLE'],
  ['+464',               null, 'Twilio intet nummer'],
  ['266696687',          null, 'ANONYMOUS uden +'],

  [null,                 null, 'null'],
  [undefined,            null, 'undefined'],
  ['',                   null, 'tom streng'],
  ['   ',                null, 'kun mellemrum'],
  ['1234567',            null, '7 cifre (for kort til dansk)'],
  ['+451234567',         null, '+45 med 7 cifre'],
  ['+45123456789',       null, '+45 med 9 cifre'],
  ['+0123456789',        null, 'landekode kan ikke begynde med 0'],
  ['+1234567890123456',  null, 'over 15 cifre'],
  ['12 34 56 78 ring',   null, 'tekst i feltet'],
  ['æøå',                null, 'danske bogstaver'],
];

let ok = 0, fejl = 0;
for (const [ind, forventet, hvorfor] of TILFAELDE) {
  const faktisk = kundeNoegle(ind);
  const vist = JSON.stringify(ind);
  if (faktisk === forventet) { ok++; console.log(`  ✅ ${vist} → ${faktisk}  (${hvorfor})`); }
  else { fejl++; console.log(`  ❌ ${vist} → ${faktisk}, forventet ${forventet}  (${hvorfor})`); }
}
console.log(`\n=== Resultat: ${ok} bestået, ${fejl} fejlet ===\n`);
process.exit(fejl ? 1 : 0);
