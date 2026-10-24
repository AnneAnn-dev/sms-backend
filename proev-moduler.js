/**
 * proev-moduler.js — beviser moduler pr. firma (Fase 1b, migration
 * 20261013120000_firma_moduler.sql + moduler.js) mod STAGING.
 *
 * To dele:
 *   DATABASEN — trigger, låst tabel, CHECK-regel. Kører direkte mod Supabase.
 *   SERVEREN  — /api/moduler og spærren foran tilbudsruterne. Kører over HTTP
 *               mod den DEPLOYEDE staging-server, så den beviser koden, der
 *               faktisk kører, ikke koden på disken.
 *
 * Opretter to testfirmaer: A har kun Telefonpasser (fra triggeren), B får
 * også Referathjælper. Rører aldrig andet; alt ryddes op i finally.
 *
 *   node proev-moduler.js                          # tørkørsel: viser mål
 *   node proev-moduler.js --bekraeft               # kører prøven
 *   node proev-moduler.js --bekraeft --url=https://...   # anden server
 *
 * Kræver i .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
 * og BASE_URL (eller --url=) for serveren.
 */

'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const URL      = process.env.SUPABASE_URL;
const SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON     = process.env.SUPABASE_ANON_KEY;
const BEKRAEFT = process.argv.includes('--bekraeft');
const urlArg   = process.argv.find((a) => a.startsWith('--url='));
const SERVER   = ((urlArg ? urlArg.slice(6) : process.env.BASE_URL) || '').replace(/\/$/, '');

if (!URL || !SERVICE || !ANON || !SERVER) {
  console.error('FEJL: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY og BASE_URL (eller --url=) skal være sat');
  process.exit(1);
}

const REF = (URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || '(ukendt)';
const kort = () => Math.random().toString(36).slice(2, 8);
const KOERSEL = kort();
const INGEN_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, INGEN_SESSION);

let bestaaet = 0, fejlet = 0;
const ok   = (b) => { bestaaet++; console.log(`  ✅ ${b}`); };
const fejl = (b) => { fejlet++;   console.log(`  ❌ ${b}`); };

async function opretFirma(navn) {
  const email = `moduler-${navn}-${KOERSEL}@example.invalid`;
  const password = `Mo!${kort()}${kort()}`;
  const { data: b, error: bF } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (bF) throw new Error(`bruger ${navn}: ${bF.message}`);
  const t = { navn, userId: b.user.id };
  const { data: f, error: fF } = await admin.from('firms').insert({
    name: `Modulprøve ${navn} ${KOERSEL}`, slug: `moduler-${navn}-${KOERSEL}`, status: 'active', is_test: true
  }).select('id').single();
  if (fF) throw new Error(`firma ${navn}: ${fF.message}`);
  t.firmId = f.id;
  const { error: kF } = await admin.from('firm_users').insert({ firm_id: t.firmId, user_id: t.userId });
  if (kF) throw new Error(`firm_users ${navn}: ${kF.message}`);
  t.klient = createClient(URL, ANON, INGEN_SESSION);
  const { data: s, error: lF } = await t.klient.auth.signInWithPassword({ email, password });
  if (lF) throw new Error(`login ${navn}: ${lF.message}`);
  t.token = s.session.access_token;
  return t;
}

async function kald(t, metode, sti, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (t) headers.Authorization = `Bearer ${t.token}`;
  const r = await fetch(SERVER + sti, { method: metode, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await r.json(); } catch (_) {}
  return { status: r.status, json };
}

const er403Modul = (r) => r.status === 403 && r.json && r.json.error === 'modul_mangler';
const forbi = (r) => r.status !== 401 && r.status !== 403 && r.status !== 503;

(async () => {
  console.log('\n=== Prøve: moduler pr. firma (Fase 1b) ===');
  console.log(`Projekt-ref : ${REF}`);
  console.log(`Server      : ${SERVER}`);
  console.log(`Kørsels-id  : ${KOERSEL}\n`);
  if (!BEKRAEFT) {
    console.log('TØRKØRSEL — intet oprettet. Tjek at BEGGE mål er STAGING, og kør med --bekraeft.\n');
    process.exit(0);
  }

  let a = null, b = null;
  try {
    a = await opretFirma('a');
    b = await opretFirma('b');
    const { error: gF } = await admin.from('firma_moduler').insert({ firm_id: b.firmId, modul: 'referat', kilde: 'proeve' });
    if (gF) throw new Error(`referat til B: ${gF.message}`);
    console.log('  ✅ to testfirmaer oprettet; B har fået Referathjælper\n');

    // --- Databasen --------------------------------------------------------------
    console.log('Databasen:');
    const { data: rA } = await admin.from('firma_moduler').select('modul, kilde').eq('firm_id', a.firmId);
    if ((rA || []).length === 1 && rA[0].modul === 'telefon' && rA[0].kilde === 'auto') ok('nyt firma fik Telefonpasser af triggeren (kilde auto)');
    else fejl(`nyt firma fik forkerte moduler: ${JSON.stringify(rA)}`);

    const { data: laest, error: lE } = await b.klient.from('firma_moduler').select('modul');
    if (lE || !(laest || []).length) ok(`authenticated kan ikke læse firma_moduler, heller ikke egne (${lE ? lE.code : '0 rækker'})`);
    else fejl(`authenticated kunne læse ${laest.length} rækker i firma_moduler`);

    const { error: sE } = await a.klient.from('firma_moduler').insert({ firm_id: a.firmId, modul: 'referat' });
    const { data: efterS } = await admin.from('firma_moduler').select('modul').eq('firm_id', a.firmId).eq('modul', 'referat');
    if (sE && !(efterS || []).length) ok(`et firma kan ikke give sig selv et modul (${sE.code || 'fejl'})`);
    else fejl('et firma kunne give sig selv Referathjælper');

    const { error: cE } = await admin.from('firma_moduler').insert({ firm_id: a.firmId, modul: 'kaffe' });
    if (cE && cE.code === '23514') ok('ukendt modulnavn afvist af CHECK (23514)');
    else fejl(`ukendt modulnavn ikke afvist: ${cE ? cE.code : 'ingen fejl'}`);

    // --- Serveren: /api/moduler ---------------------------------------------------
    console.log('\nServeren — /api/moduler:');
    let r = await kald(a, 'GET', '/api/moduler');
    if (r.status === 200 && JSON.stringify(r.json.moduler) === '["telefon"]') ok(`A: ["telefon"], tilbudAktiv=${r.json.tilbudAktiv}`);
    else fejl(`A: ${r.status} ${JSON.stringify(r.json)}`);
    r = await kald(b, 'GET', '/api/moduler');
    if (r.status === 200 && JSON.stringify(r.json.moduler) === '["referat","telefon"]') ok('B: ["referat","telefon"]');
    else fejl(`B: ${r.status} ${JSON.stringify(r.json)}`);
    r = await kald(null, 'GET', '/api/moduler');
    if (r.status === 401) ok('uden login: 401');
    else fejl(`uden login: ${r.status}`);

    // --- Serveren: spærren ---------------------------------------------------------
    console.log('\nServeren — spærren foran Referathjælperen:');
    r = await kald(a, 'GET', '/api/tilbud/kvote');
    if (er403Modul(r)) ok('A uden modul: kvote → 403 modul_mangler');
    else fejl(`A kvote: ${r.status} ${JSON.stringify(r.json)}`);
    r = await kald(a, 'POST', '/api/tilbud/transskriber');
    if (er403Modul(r)) ok('A uden modul: transskriber → 403 (før upload)');
    else fejl(`A transskriber: ${r.status} ${JSON.stringify(r.json)}`);
    r = await kald(a, 'POST', '/api/tilbud/referater', {});
    if (er403Modul(r)) ok('A uden modul: opret referat → 403');
    else fejl(`A opret referat: ${r.status} ${JSON.stringify(r.json)}`);

    r = await kald(b, 'GET', '/api/tilbud/kvote');
    if (forbi(r)) ok(`B med modul: kvote slipper forbi spærren (${r.status})`);
    else fejl(`B kvote: ${r.status} ${JSON.stringify(r.json)}`);
    r = await kald(b, 'POST', '/api/tilbud/referater', {});
    if (forbi(r)) ok(`B med modul: opret referat slipper forbi spærren (${r.status}, ruten afviser selv den tomme krop)`);
    else fejl(`B opret referat: ${r.status} ${JSON.stringify(r.json)}`);

    console.log('\nServeren — fundamentet og afmeldte moduler:');
    r = await kald(a, 'GET', '/api/tilbud/kunder');
    if (forbi(r)) ok(`A uden modul: kunder er fundamentet, ikke spærret (${r.status})`);
    else fejl(`A kunder: ${r.status} ${JSON.stringify(r.json)}`);
    r = await kald(a, 'GET', '/api/tilbud/referater/00000000-0000-0000-0000-000000000000');
    if (forbi(r)) ok(`A uden modul: LÆSE et referat er ikke spærret (${r.status})`);
    else fejl(`A læs referat: ${r.status} ${JSON.stringify(r.json)}`);

    // Afmeldt: til i fortiden. (fra flyttes også tilbage, så periodereglen holder.)
    await admin.from('firma_moduler')
      .update({ fra: new Date(Date.now() - 30 * 864e5).toISOString(), til: new Date(Date.now() - 864e5).toISOString() })
      .eq('firm_id', b.firmId).eq('modul', 'referat');
    r = await kald(b, 'GET', '/api/tilbud/kvote');
    const m = await kald(b, 'GET', '/api/moduler');
    if (er403Modul(r) && JSON.stringify(m.json && m.json.moduler) === '["telefon"]') ok('B afmeldt (til i går): kvote → 403, /api/moduler viser kun telefon');
    else fejl(`B afmeldt: kvote ${r.status}, moduler ${JSON.stringify(m.json)}`);

  } catch (e) {
    fejlet++;
    console.log(`\n❌ AFBRUDT: ${e.message}`);
  } finally {
    console.log('\nOprydning:');
    for (const t of [a, b]) {
      if (!t) continue;
      await admin.from('firm_users').delete().eq('firm_id', t.firmId);
      await admin.from('firms').delete().eq('id', t.firmId);
      if (t.userId) await admin.auth.admin.deleteUser(t.userId);
      console.log(`  🧹 ryddet: ${t.navn}`);
    }
  }

  console.log(`\n=== Resultat: ${bestaaet} bestået, ${fejlet} fejlet ===\n`);
  process.exit(fejlet ? 1 : 0);
})();
