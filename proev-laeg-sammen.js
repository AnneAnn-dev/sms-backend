/**
 * proev-laeg-sammen.js — beviser D94 trin 4 (migration
 * 20261030100000_laeg_sammen_kunder.sql) mod STAGING.
 *
 * Databasefunktionerne laeg_sammen_oversigt() og laeg_sammen_kunder(),
 * loggen kunde_sammenlaegninger og rettighederne. Ruterne og knappen er bag
 * LAEG_SAMMEN_AKTIV og proeves i haanden. Laase og samtidige kald er bevist
 * mod lokal Postgres 16 foer levering.
 *
 * Opretter to testfirmaer (A og B) med hver sin bruger. Roerer aldrig andet;
 * alt ryddes op i finally. Telefonnumrene er opdigtede +4590…-numre med
 * koerslens cifre i.
 *
 *   node proev-laeg-sammen.js              # toerkoersel: viser maalet
 *   node proev-laeg-sammen.js --bekraeft   # koerer proeven
 *
 * Kraever i .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
 */

'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const URL      = process.env.SUPABASE_URL;
const SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON     = process.env.SUPABASE_ANON_KEY;
const BEKRAEFT = process.argv.includes('--bekraeft');

if (!URL || !SERVICE || !ANON) {
  console.error('FEJL: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY og SUPABASE_ANON_KEY skal være sat');
  process.exit(1);
}

const REF = (URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || '(ukendt)';
const kort = () => Math.random().toString(36).slice(2, 8);
const KOERSEL = kort();
const CIFRE = String(Math.floor(100000 + Math.random() * 900000));
const nr = (i) => `+4590${CIFRE.slice(0, 5)}${i}`;
const INGEN_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, INGEN_SESSION);
const dageSiden = (d) => new Date(Date.now() - d * 86400e3).toISOString();

let bestaaet = 0, fejlet = 0;
const ok   = (b) => { bestaaet++; console.log(`  ✅ ${b}`); };
const fejl = (b) => { fejlet++;   console.log(`  ❌ ${b}`); };
const tjek = (betingelse, godt, skidt) => (betingelse ? ok(godt) : fejl(skidt || godt));
const stop = (hvad, e) => { if (e) throw new Error(`${hvad}: ${e.code || ''} ${e.message}`); };

async function opretFirma(navn) {
  const email = `laegsammen-${navn}-${KOERSEL}@example.invalid`;
  const password = `Ls!${kort()}${kort()}`;
  const { data: b, error: bF } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  stop(`bruger ${navn}`, bF);
  const t = { navn, userId: b.user.id, leads: [] };
  const { data: f, error: fF } = await admin.from('firms').insert({
    name: `Læg-sammen-prøve ${navn} ${KOERSEL}`, slug: `laegsammen-${navn}-${KOERSEL}`, status: 'active', is_test: true
  }).select('id').single();
  stop(`firma ${navn}`, fF);
  t.firmId = f.id;
  stop(`firm_users ${navn}`, (await admin.from('firm_users').insert({ firm_id: t.firmId, user_id: t.userId })).error);
  t.klient = createClient(URL, ANON, INGEN_SESSION);
  stop(`login ${navn}`, (await t.klient.auth.signInWithPassword({ email, password })).error);
  return t;
}

async function kunde(firmId, telefon, navn) {
  const { data, error } = await admin.rpc('find_eller_opret_kunde', { p_firm: firmId, p_telefon: telefon, p_navn: navn, p_adresse: null });
  stop('find_eller_opret_kunde', error);
  return Array.isArray(data) ? data[0] : data;
}
async function opkald(firmId, fra, dage) {
  const { data, error } = await admin.from('calls').insert({ firm_id: firmId, from_number: fra, to_number: '+4599999999', created_at: dageSiden(dage) }).select('id').single();
  stop('calls', error); return data.id;
}
async function opgave(t, kundeId, callId, status) {
  const { data, error } = await admin.from('leads').insert({ firm_id: t.firmId, kunde_id: kundeId, call_id: callId,
    name: 'Prøve', address: 'Testvej 1, 8000 Aarhus C', task: 'Læg-sammen-prøve', status }).select('id').single();
  stop('leads', error); t.leads.push(data.id); return data.id;
}
async function laeg(firmId, behold, fjern) {
  const { data, error } = await admin.rpc('laeg_sammen_kunder', { p_firm: firmId, p_behold: behold, p_fjern: fjern });
  if (error) return { fejl: error.message };
  return Array.isArray(data) ? data[0] : data;
}
async function oversigt(firmId, behold, fjern) {
  const { data, error } = await admin.rpc('laeg_sammen_oversigt', { p_firm: firmId, p_behold: behold, p_fjern: fjern });
  stop('laeg_sammen_oversigt', error);
  return Array.isArray(data) ? data[0] : data;
}
const findes = async (tabel, id) => {
  const { data, error } = await admin.from(tabel).select('id').eq('id', id).maybeSingle();
  stop(`opslag ${tabel}`, error); return !!data;
};

(async () => {
  console.log('\n=== Prøve: Læg sammen (D94 trin 4) ===');
  console.log(`Projekt-ref : ${REF}`);
  console.log(`Kørsels-id  : ${KOERSEL}\n`);
  if (!BEKRAEFT) {
    console.log('TØRKØRSEL — intet oprettet. Tjek at målet er STAGING, og kør med --bekraeft.\n');
    process.exit(0);
  }

  let a = null, b = null;
  try {
    a = await opretFirma('a');
    b = await opretFirma('b');
    console.log('  ✅ to testfirmaer oprettet\n');

    // ── Opsætning ──────────────────────────────────────────────────────────
    const KB = (await kunde(a.firmId, nr(1), 'Behold')).kunde_id;
    const KF = (await kunde(a.firmId, nr(2), 'Fjern')).kunde_id;
    stop('nummer 3', (await admin.from('kunde_telefoner').insert({ firm_id: a.firmId, kunde_id: KF, telefon: nr(3) })).error);
    stop('stamdata B', (await admin.from('kunder').update({ adresse: 'Bvej 1', postnr: '3400', by: 'Hillerød' }).eq('id', KB)).error);
    stop('stamdata F', (await admin.from('kunder').update({ adresse: 'Fvej 9', postnr: '8000', by: 'Aarhus', email: `f-${KOERSEL}@example.invalid`,
      cvr: '12345678', er_erhverv: true, arkiveret_at: new Date().toISOString() }).eq('id', KF)).error);
    const KX = (await kunde(b.firmId, nr(2), 'Hos B')).kunde_id;
    const C1 = await opkald(a.firmId, nr(2), 3);
    const L1 = await opgave(a, KF, C1, 'open');
    const L2 = await opgave(a, KF, null, 'completed');
    const LB = await opgave(a, KB, null, 'open');
    const LX = await opgave(b, KX, null, 'open');
    console.log('  ✅ Behold (1 nummer, 1 opgave) og Fjern (2 numre, 2 opgaver, e-mail, CVR, inaktiv); B med samme nummer\n');

    console.log('Oversigt:');
    const o = await oversigt(a.firmId, KB, KF);
    tjek(o.findes && o.numre === 2 && o.opgaver === 2 && o.aabne === 1 && JSON.stringify(o.felter) === '["email","cvr"]' && o.fjern_inaktiv === true,
      'tallene passer (2 numre, 2 opgaver, 1 åben, felter e-mail og CVR, Fjern inaktiv)', `oversigt: ${JSON.stringify(o)}`);
    tjek(!(await oversigt(a.firmId, KB, KX)).findes, 'andet firmas kunde: findes ikke');
    tjek(!(await oversigt(b.firmId, KB, KF)).findes, 'kaldt fra andet firma: findes ikke');

    console.log('\nRettigheder:');
    const { error: rpcA } = await a.klient.rpc('laeg_sammen_kunder', { p_firm: a.firmId, p_behold: KB, p_fjern: KF });
    tjek(!!rpcA && await findes('kunder', KF), `en bruger kan ikke kalde laeg_sammen_kunder (${rpcA ? rpcA.code : 'ingen fejl'})`);
    const { error: rpcO } = await a.klient.rpc('laeg_sammen_oversigt', { p_firm: a.firmId, p_behold: KB, p_fjern: KF });
    tjek(!!rpcO, `en bruger kan ikke kalde oversigten (${rpcO ? rpcO.code : 'ingen fejl'})`);
    const { data: seLog, error: logF } = await a.klient.from('kunde_sammenlaegninger').select('id');
    tjek(!!logF || !(seLog || []).length, `en bruger kan ikke læse loggen (${logF ? logF.code : '0 rækker'})`);

    console.log('\nAfvisninger:');
    tjek((await laeg(a.firmId, KB, KB)).fejl === 'samme_kunde', 'samme kunde: samme_kunde');
    tjek((await laeg(a.firmId, KB, KX)).fejl === 'ikke_fundet' && await findes('kunder', KX), 'andet firmas kunde: ikke_fundet, intet ændret');
    tjek((await laeg(b.firmId, KB, KF)).fejl === 'ikke_fundet' && await findes('kunder', KF), 'kaldt fra andet firma: ikke_fundet, intet ændret');

    console.log('\nSammenlægning:');
    const r = await laeg(a.firmId, KB, KF);
    tjek(!r.fejl && r.numre === 2 && r.opgaver === 2 && JSON.stringify(r.felter) === '["email","cvr"]',
      'laeg_sammen_kunder: 2 numre, 2 opgaver, felter e-mail og CVR', `svar: ${JSON.stringify(r)}`);
    tjek(!(await findes('kunder', KF)), 'Fjern er væk');
    const { data: numre } = await admin.from('kunde_telefoner').select('telefon').eq('kunde_id', KB);
    tjek((numre || []).length === 3, `numrene ligger hos Behold (${(numre || []).length})`);
    const { data: opg } = await admin.from('leads').select('id, status').eq('kunde_id', KB);
    tjek((opg || []).length === 3 && (opg || []).find((x) => x.id === L2).status === 'completed', 'opgaverne ligger hos Behold (3), status urørt');
    const { data: kb } = await admin.from('kunder').select('navn, adresse, postnr, by, email, cvr, er_erhverv, arkiveret_at').eq('id', KB).single();
    tjek(kb.navn === 'Behold' && kb.adresse === 'Bvej 1' && kb.postnr === '3400' && kb.by === 'Hillerød', 'navn og adresse urørt');
    tjek(kb.email === `f-${KOERSEL}@example.invalid` && kb.cvr === '12345678' && kb.er_erhverv === true, 'tom e-mail og tomt CVR fyldt (og erhverv med)');
    tjek(kb.arkiveret_at === null, 'Behold forbliver aktiv');
    tjek(await findes('calls', C1), 'opkaldet er urørt');
    tjek(await findes('kunder', KX) && await findes('leads', LX), 'firma B er urørt (samme nummer)');
    const { data: log } = await admin.from('kunde_sammenlaegninger').select('behold_id, fjern_id, numre, opgaver, felter').eq('firm_id', a.firmId);
    tjek((log || []).length === 1 && log[0].behold_id === KB && log[0].fjern_id === KF && log[0].numre === 2 && log[0].opgaver === 2,
      'én lograkke med id\'er og antal', `log: ${JSON.stringify(log)}`);
    tjek((await laeg(a.firmId, KB, KF)).fejl === 'ikke_fundet', 'igen: ikke_fundet');
    const efter = await kunde(a.firmId, nr(3), 'Ringer');
    tjek(efter.ny === false && efter.kunde_id === KB, 'Fjerns gamle nummer ringer: finder Behold');
    void L1; void LB;

  } catch (e) {
    fejl(`prøven stoppede: ${e.message}`);
  } finally {
    console.log('\nOprydning:');
    for (const t of [a, b]) {
      if (!t) continue;
      await admin.from('leads').delete().eq('firm_id', t.firmId);
      await admin.from('calls').delete().eq('firm_id', t.firmId);
      await admin.from('kunde_telefoner').delete().eq('firm_id', t.firmId);
      await admin.from('kunder').delete().eq('firm_id', t.firmId);
      await admin.from('firm_users').delete().eq('firm_id', t.firmId);
      await admin.from('firms').delete().eq('id', t.firmId);
      if (t.userId) await admin.auth.admin.deleteUser(t.userId);
      console.log(`  🧹 ryddet: ${t.navn}`);
    }
  }

  console.log(`\n=== Resultat: ${bestaaet} bestået, ${fejlet} fejlet ===\n`);
  process.exit(fejlet ? 1 : 0);
})();
