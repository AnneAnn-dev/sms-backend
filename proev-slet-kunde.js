/**
 * proev-slet-kunde.js — beviser D94 trin 3b (migration
 * 20261029100000_slet_kunde.sql) mod STAGING.
 *
 * Databasefunktionerne slet_kunde_oversigt() og slet_kunde(), loggen
 * kunde_sletninger, rettighederne og billedoprydning.js mod den rigtige
 * Storage. Ruterne og knappen er bag SLET_KUNDE_AKTIV og proeves i haanden.
 * Laase og samtidige kald er bevist mod lokal Postgres 16 foer levering.
 *
 * Opretter to testfirmaer (A og B) med hver sin bruger. Roerer aldrig andet;
 * alt ryddes op i finally — ogsaa testbilledet i Storage. Telefonnumrene er
 * opdigtede +4590…-numre med koerslens cifre i.
 *
 *   node proev-slet-kunde.js              # toerkoersel: viser maalet
 *   node proev-slet-kunde.js --bekraeft   # koerer proeven
 *
 * Kraever i .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
 */

'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { sletOpgaveBilleder } = require('./billedoprydning');

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
// 1×1 gennemsigtig PNG — bucket'en tager kun billeder.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

let bestaaet = 0, fejlet = 0;
const ok   = (b) => { bestaaet++; console.log(`  ✅ ${b}`); };
const fejl = (b) => { fejlet++;   console.log(`  ❌ ${b}`); };
const tjek = (betingelse, godt, skidt) => (betingelse ? ok(godt) : fejl(skidt || godt));
const stop = (hvad, e) => { if (e) throw new Error(`${hvad}: ${e.code || ''} ${e.message}`); };

async function opretFirma(navn) {
  const email = `sletkunde-${navn}-${KOERSEL}@example.invalid`;
  const password = `Sk!${kort()}${kort()}`;
  const { data: b, error: bF } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  stop(`bruger ${navn}`, bF);
  const t = { navn, userId: b.user.id, leads: [] };
  const { data: f, error: fF } = await admin.from('firms').insert({
    name: `Slet-kunde-prøve ${navn} ${KOERSEL}`, slug: `sletkunde-${navn}-${KOERSEL}`, status: 'active', is_test: true
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
    name: 'Prøve', address: 'Testvej 1, 8000 Aarhus C', task: 'Slet-kunde-prøve', status }).select('id').single();
  stop('leads', error); t.leads.push(data.id); return data.id;
}
async function slet(firmId, kundeId) {
  const { data, error } = await admin.rpc('slet_kunde', { p_firm: firmId, p_kunde: kundeId });
  if (error) return { fejl: error.message };
  return Array.isArray(data) ? data[0] : data;
}
async function oversigt(firmId, kundeId) {
  const { data, error } = await admin.rpc('slet_kunde_oversigt', { p_firm: firmId, p_kunde: kundeId });
  stop('slet_kunde_oversigt', error);
  return Array.isArray(data) ? data[0] : data;
}
const findes = async (tabel, id) => {
  const { data, error } = await admin.from(tabel).select('id').eq('id', id).maybeSingle();
  stop(`opslag ${tabel}`, error); return !!data;
};

(async () => {
  console.log('\n=== Prøve: Slet kunde (D94 trin 3b) ===');
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
    const K = (await kunde(a.firmId, nr(1), 'Kunde K')).kunde_id;
    stop('nummer 2', (await admin.from('kunde_telefoner').insert({ firm_id: a.firmId, kunde_id: K, telefon: nr(2) })).error);
    const Y = (await kunde(a.firmId, nr(9), 'Kunde Y')).kunde_id;
    const KB = (await kunde(b.firmId, nr(1), 'Kunde hos B')).kunde_id;

    const C1 = await opkald(a.firmId, nr(1), 30);          // K's opgave kom herfra
    const C2 = await opkald(a.firmId, nr(1), 30);          // K ringede, ingen opgave (valg b)
    const C3 = await opkald(a.firmId, nr(2), 10);          // fra K's nummer — men Y's opgave
    const CB = await opkald(b.firmId, nr(1), 30);          // andet firma
    const L1 = await opgave(a, K, C1, 'completed');
    const LY = await opgave(a, Y, C3, 'open');
    const LB = await opgave(b, KB, CB, 'open');

    const sti = `${L1}/proeve-${KOERSEL}.png`;
    stop('upload', (await admin.storage.from('lead-images').upload(sti, PNG, { contentType: 'image/png', upsert: false })).error);
    stop('lead_images', (await admin.from('lead_images').insert({ lead_id: L1, image_url: `${URL}/storage/v1/object/public/lead-images/${sti}` })).error);
    stop('referater', (await admin.from('referater').insert({ firm_id: a.firmId, lead_id: L1, indhold: 'Prøvereferat' })).error);
    stop('messages', (await admin.from('messages').insert([
      { firm_id: a.firmId, lead_id: L1, to_number: nr(1), body: 'Prøve 1', direction: 'outbound' },
      { firm_id: a.firmId, lead_id: null, to_number: nr(2), body: 'Prøve 2', direction: 'outbound' },
      { firm_id: a.firmId, lead_id: LY, to_number: nr(2), body: 'Prøve Y', direction: 'outbound' },
    ])).error);
    console.log('  ✅ kunde K med 2 numre, 1 afsluttet opgave, billede, referat, 2 SMS og 2 opkald; Y med opgave på et opkald fra K\'s nummer; B med samme nummer\n');

    // ── Oversigt ───────────────────────────────────────────────────────────
    console.log('Oversigt:');
    const o = await oversigt(a.firmId, K);
    tjek(o.findes && o.opgaver === 1 && o.aabne === 0 && o.billeder === 1 && o.referater === 1 && o.sms === 2 && o.opkald === 2 && o.numre === 2 && o.nye_opkald === 0,
      'tallene passer (1 opgave, 1 billede, 1 referat, 2 SMS, 2 opkald, 2 numre)', `oversigt: ${JSON.stringify(o)}`);
    tjek(!(await oversigt(b.firmId, K)).findes, 'andet firma: findes ikke');

    // ── Rettigheder ────────────────────────────────────────────────────────
    console.log('\nRettigheder:');
    const { error: rpcA } = await a.klient.rpc('slet_kunde', { p_firm: a.firmId, p_kunde: K });
    tjek(!!rpcA && await findes('kunder', K), `en bruger kan ikke kalde slet_kunde (${rpcA ? rpcA.code : 'ingen fejl'})`);
    const { error: rpcO } = await a.klient.rpc('slet_kunde_oversigt', { p_firm: a.firmId, p_kunde: K });
    tjek(!!rpcO, `en bruger kan ikke kalde oversigten (${rpcO ? rpcO.code : 'ingen fejl'})`);
    const { data: seLog, error: logF } = await a.klient.from('kunde_sletninger').select('id');
    tjek(!!logF || !(seLog || []).length, `en bruger kan ikke læse loggen (${logF ? logF.code : '0 rækker'})`);

    // ── Spærringer ─────────────────────────────────────────────────────────
    console.log('\nSpærringer:');
    tjek((await slet(b.firmId, K)).fejl === 'ikke_fundet' && await findes('kunder', K), 'andet firmas kunde: ikke_fundet, intet slettet');
    const L2 = await opgave(a, K, null, 'open');
    tjek((await slet(a.firmId, K)).fejl === 'aaben_opgave' && await findes('leads', L1), 'åben opgave: aaben_opgave, intet slettet');
    stop('luk L2', (await admin.from('leads').update({ status: 'completed' }).eq('id', L2)).error);
    const C4 = await opkald(a.firmId, nr(2), 2);
    tjek((await slet(a.firmId, K)).fejl === 'nyt_opkald' && await findes('calls', C4), 'opkald uden opgave inden for 7 dage: nyt_opkald, intet slettet');
    stop('ældre C4', (await admin.from('calls').update({ created_at: dageSiden(8) }).eq('id', C4)).error);

    // ── Sletning ───────────────────────────────────────────────────────────
    console.log('\nSletning:');
    const r = await slet(a.firmId, K);
    tjek(!r.fejl && r.opgaver === 2 && r.billeder === 1 && r.referater === 1 && r.sms === 2 && r.opkald === 3 && r.numre === 2,
      'slet_kunde: 2 opgaver, 1 billede, 1 referat, 2 SMS, 3 opkald, 2 numre', `svar: ${JSON.stringify(r)}`);
    const bill = await sletOpgaveBilleder(admin, r.opgave_ider || []);
    tjek(bill.filer === 1 && bill.fejl.length === 0, `billedfilen slettet i Storage (${bill.filer} fil, ${bill.fejl.length} fejl)`);
    const { data: rest } = await admin.storage.from('lead-images').list(L1, { limit: 10 });
    tjek(!(rest || []).filter((f) => f.id).length, 'Storage-mappen er tom bagefter');

    tjek(!(await findes('kunder', K)), 'kunden er væk');
    const { count: numre } = await admin.from('kunde_telefoner').select('telefon', { count: 'exact', head: true }).eq('kunde_id', K);
    tjek(numre === 0, 'numrene er væk');
    tjek(!(await findes('leads', L1)) && !(await findes('leads', L2)), 'opgaverne er væk');
    tjek(!(await findes('calls', C1)) && !(await findes('calls', C2)) && !(await findes('calls', C4)), "K's opkald er væk (opgave, uden opgave, 8 dage)");
    tjek(await findes('calls', C3) && await findes('leads', LY), "opkaldet fra K's nummer med Y's opgave STÅR — og Y's opgave med");
    const { data: smsA } = await admin.from('messages').select('lead_id').eq('firm_id', a.firmId);
    tjek((smsA || []).length === 1 && smsA[0].lead_id === LY, "K's SMS'er væk, Y's står");
    tjek(await findes('kunder', KB) && await findes('calls', CB) && await findes('leads', LB), 'firma B er urørt (samme nummer, eget opkald og opgave)');
    const { data: log } = await admin.from('kunde_sletninger').select('kunde_id, opgaver, opkald, numre, opgave_ider').eq('firm_id', a.firmId);
    tjek((log || []).length === 1 && log[0].kunde_id === K && log[0].opgaver === 2 && log[0].opkald === 3 && log[0].opgave_ider.length === 2,
      'én lograkke med id\'er og antal', `log: ${JSON.stringify(log)}`);
    tjek((await slet(a.firmId, K)).fejl === 'ikke_fundet', 'slettet igen: ikke_fundet');

    const efter = await kunde(a.firmId, nr(1), 'Ringer igen');
    tjek(efter.ny === true && efter.kunde_id !== K, 'kundens nummer ringer igen: ny kunde');

  } catch (e) {
    fejl(`prøven stoppede: ${e.message}`);
  } finally {
    console.log('\nOprydning:');
    for (const t of [a, b]) {
      if (!t) continue;
      for (const id of t.leads) {
        const { data } = await admin.storage.from('lead-images').list(id, { limit: 100 });
        const stier = (data || []).filter((f) => f.id).map((f) => `${id}/${f.name}`);
        if (stier.length) await admin.storage.from('lead-images').remove(stier);
      }
      await admin.from('messages').delete().eq('firm_id', t.firmId);
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
