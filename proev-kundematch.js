/**
 * proev-kundematch.js — beviser kundematch.js (D88 trin 1b) mod STAGING-databasen.
 *
 * knytKunde() kaldes direkte, med flaget sat eksplicit, så prøven ikke afhænger
 * af Railway. Ruterne (/formular, /opret-opgave) bevises bagefter i hånden med
 * flaget tændt i Railway staging — se leveringsbeskeden.
 *
 * Opretter ét testfirma og rydder op i finally. Telefonnumrene er opdigtede
 * +4591…-numre med kørsels-id'et i.
 *
 *   node proev-kundematch.js              # tørkørsel: viser målet
 *   node proev-kundematch.js --bekraeft   # kører prøven
 *
 * Står i IKKE_I_CI i kor-proever.js: læser Supabase-nøgler fra .env.
 */

'use strict';

require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { knytKunde } = require('./kundematch');

const URL      = process.env.SUPABASE_URL;
const SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BEKRAEFT = process.argv.includes('--bekraeft');
if (!URL || !SERVICE) { console.error('FEJL: SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY skal være sat i .env'); process.exit(1); }

const REF = (URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || '(ukendt)';
if (REF === 'glymuxqtrbpeyzmflilf') { console.error('STOP: .env peger på PROD. Prøven kører kun mod staging.'); process.exit(1); }
const KOERSEL = Math.random().toString(36).slice(2, 8);
const CIFRE = String(Math.floor(10000 + Math.random() * 90000));
const nr = (i) => `+4591${CIFRE}${i}`;                     // +4591 + 5 + 1 = 8 cifre efter +45
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

let bestaaet = 0, fejlet = 0;
const tjek = (b, godt, skidt) => { if (b) { bestaaet++; console.log(`  ✅ ${godt}`); } else { fejlet++; console.log(`  ❌ ${skidt || godt}`); } };

async function nyOpgave(firmId, navn) {
  const { data, error } = await admin.from('leads').insert({ name: navn, address: 'Prøvevej 2, 3400 Hillerød', task: 'prøve', firm_id: firmId }).select('id').single();
  if (error) throw new Error(`opgave: ${error.message}`);
  return data.id;
}
const kundeAf = async (leadId) => (await admin.from('leads').select('kunde_id').eq('id', leadId).single()).data.kunde_id;

(async () => {
  console.log('\n=== Prøve: kundematch.js (D88 trin 1b) ===');
  console.log(`Projekt-ref : ${REF}`);
  console.log(`Kørsels-id  : ${KOERSEL}\n`);
  if (!BEKRAEFT) { console.log('TØRKØRSEL — intet oprettet. Tjek at målet er STAGING, og kør med --bekraeft.\n'); process.exit(0); }

  let firmId = null;
  try {
    const { data: f, error: fF } = await admin.from('firms').insert({
      name: `Kundematch-prøve ${KOERSEL}`, slug: `kundematch-${KOERSEL}`, status: 'active', is_test: true,
    }).select('id').single();
    if (fF) throw new Error(`firma: ${fF.message}`);
    firmId = f.id;

    // 1. Flaget slukket: intet sker
    const l1 = await nyOpgave(firmId, 'Slukket');
    const r1 = await knytKunde(admin, { firmId, leadId: l1, telefon: nr(1), navn: 'Slukket', adresse: null }, { aktiv: false });
    tjek(r1.status === 'slukket' && (await kundeAf(l1)) === null, 'flag slukket → ingen kunde, opgaven uændret');

    // 2. Tændt, ukendt nummer: ny kunde
    const l2 = await nyOpgave(firmId, 'Hanne Prøve');
    const r2 = await knytKunde(admin, { firmId, leadId: l2, telefon: nr(2), navn: 'Hanne Prøve', adresse: 'Prøvevej 2' }, { aktiv: true });
    tjek(r2.status === 'ny' && r2.medNummer && (await kundeAf(l2)) === r2.kundeId, 'ukendt nummer → ny kunde, opgaven knyttet');

    // 3. Samme nummer, tastet anderledes: samme kunde
    const l3 = await nyOpgave(firmId, 'Hanne igen');
    const tastet = nr(2).slice(3).replace(/(\d{2})/g, '$1 ').trim();   // "91 xx xx x2"
    const r3 = await knytKunde(admin, { firmId, leadId: l3, telefon: tastet, navn: 'Hanne igen', adresse: null }, { aktiv: true });
    tjek(r3.status === 'kendt' && r3.kundeId === r2.kundeId && (await kundeAf(l3)) === r2.kundeId,
      `samme nummer tastet som "${tastet}" → samme kunde`);
    const { data: k } = await admin.from('kunder').select('navn').eq('id', r2.kundeId).single();
    tjek(k && k.navn === 'Hanne Prøve', 'kundens navn er fra første henvendelse, ikke overskrevet');

    // 4. Markøren på syntetiske opkald: ny kunde UDEN nummer
    const l4 = await nyOpgave(firmId, 'Manuel');
    const r4 = await knytKunde(admin, { firmId, leadId: l4, telefon: 'Manuel oprettelse', navn: 'Manuel', adresse: null }, { aktiv: true });
    const { count: n4 } = await admin.from('kunde_telefoner').select('id', { count: 'exact', head: true }).eq('kunde_id', r4.kundeId || '00000000-0000-0000-0000-000000000000');
    tjek(r4.status === 'ny' && r4.medNummer === false && n4 === 0, '"Manuel oprettelse" → ny kunde uden nummer');

    // 5. Twilios skjulte nummer: ny kunde uden nummer (samles IKKE på én kunde)
    const l5a = await nyOpgave(firmId, 'Skjult A'), l5b = await nyOpgave(firmId, 'Skjult B');
    const r5a = await knytKunde(admin, { firmId, leadId: l5a, telefon: '+266696687', navn: 'Skjult A' }, { aktiv: true });
    const r5b = await knytKunde(admin, { firmId, leadId: l5b, telefon: '+266696687', navn: 'Skjult B' }, { aktiv: true });
    tjek(r5a.status === 'ny' && r5b.status === 'ny' && r5a.kundeId !== r5b.kundeId, 'to opkald med skjult nummer → to kunder, ikke én');

    // 6. Opgaven har allerede en kunde: overskrives ikke (scriptet kan køres igen)
    const r6 = await knytKunde(admin, { firmId, leadId: l2, telefon: nr(6), navn: 'Andet', adresse: null }, { aktiv: true });
    tjek(r6.status === 'uaendret' && (await kundeAf(l2)) === r2.kundeId, 'opgave med kunde → uændret');

    // 7. Databasen svarer med fejl: kaster IKKE, opgaven består uden kunde
    const l7 = await nyOpgave(firmId, 'Fejl');
    const falsk = { rpc: async () => ({ data: null, error: { code: 'XX000', message: 'kunstig fejl fra prøven' } }) };
    let kastede = false, r7;
    try { r7 = await knytKunde(falsk, { firmId, leadId: l7, telefon: nr(7), navn: 'Fejl' }, { aktiv: true }); } catch (_) { kastede = true; }
    tjek(!kastede && r7 && r7.status === 'fejl' && (await kundeAf(l7)) === null, 'fejl i matchningen → ingen undtagelse, opgaven findes uden kunde');

    // 8. Manglende id'er: kaster ikke
    const r8 = await knytKunde(admin, { firmId: null, leadId: null, telefon: nr(8) }, { aktiv: true });
    tjek(r8.status === 'fejl', 'manglende firmId/leadId → "fejl", ingen undtagelse');

  } catch (e) {
    fejlet++; console.log(`  ❌ prøven stoppede: ${e.message}`);
  } finally {
    if (firmId) {
      await admin.from('leads').delete().eq('firm_id', firmId);
      await admin.from('kunde_telefoner').delete().eq('firm_id', firmId);
      await admin.from('kunder').delete().eq('firm_id', firmId);
      await admin.from('firms').delete().eq('id', firmId);
      console.log('\n  🧹 testfirmaet ryddet');
    }
  }
  console.log(`\n=== Resultat: ${bestaaet} bestået, ${fejlet} fejlet ===\n`);
  process.exit(fejlet ? 1 : 0);
})();
