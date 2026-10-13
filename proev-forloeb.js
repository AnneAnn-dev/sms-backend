/**
 * proev-forloeb.js — beviser opgavens forløb (Fase 1a, migration
 * 20261013100000_leads_forloeb.sql) mod STAGING.
 *
 * Opretter ét testfirma med én bruger og fire opgaver uden opkald, sender dem
 * gennem overgangene og tjekker hver gang med service-nøglen, hvad der står
 * i databasen. Rører aldrig en række, den ikke selv har oprettet; alt ryddes
 * op i finally.
 *
 *   node proev-forloeb.js              # tørkørsel: viser mål, gør intet
 *   node proev-forloeb.js --bekraeft   # kører prøven
 *
 * Kræver i .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 */

'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const URL      = process.env.SUPABASE_URL;
const SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON     = process.env.SUPABASE_ANON_KEY;
const BEKRAEFT = process.argv.includes('--bekraeft');

if (!URL || !SERVICE || !ANON) {
  console.error('FEJL: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY og SUPABASE_ANON_KEY skal alle være sat i .env');
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

async function lead(id) {
  const { data, error } = await admin.from('leads')
    .select('status, startet_at, sidst_roert, seen_at').eq('id', id).single();
  if (error) throw new Error(`opslag af lead: ${error.message}`);
  return data;
}

async function nyOpgave(firmId, navn) {
  const { data, error } = await admin.from('leads').insert({
    firm_id: firmId, call_id: null, name: navn,
    address: 'Testvej 1, 8000 Aarhus C', task: 'Forløbsprøve', notes: 'start'
  }).select('id').single();
  if (error) throw new Error(`opret ${navn}: ${error.message}`);
  return data.id;
}

(async () => {
  console.log('\n=== Prøve: opgavens forløb (Fase 1a) ===');
  console.log(`Projekt-ref : ${REF}`);
  console.log(`Kørsels-id  : ${KOERSEL}\n`);
  if (!BEKRAEFT) {
    console.log('TØRKØRSEL — intet oprettet. Tjek at projekt-ref er STAGING, og kør med --bekraeft.\n');
    process.exit(0);
  }

  let firmId = null, userId = null;
  try {
    // --- Opsætning ----------------------------------------------------------
    const email = `forloeb-${KOERSEL}@example.invalid`;
    const password = `Fl!${kort()}${kort()}`;
    const { data: b, error: bF } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (bF) throw new Error(`bruger: ${bF.message}`);
    userId = b.user.id;
    const { data: f, error: fF } = await admin.from('firms').insert({
      name: `Forløbsprøve ${KOERSEL}`, slug: `forloeb-${KOERSEL}`, status: 'active', is_test: true
    }).select('id').single();
    if (fF) throw new Error(`firma: ${fF.message}`);
    firmId = f.id;
    const { error: kF } = await admin.from('firm_users').insert({ firm_id: firmId, user_id: userId });
    if (kF) throw new Error(`firm_users: ${kF.message}`);

    const L1 = await nyOpgave(firmId, 'L1 noter');
    const L2 = await nyOpgave(firmId, 'L2 referat');
    const L3 = await nyOpgave(firmId, 'L3 tilbud');
    const L4 = await nyOpgave(firmId, 'L4 flyt');

    const klient = createClient(URL, ANON, INGEN_SESSION);
    const { error: lF } = await klient.auth.signInWithPassword({ email, password });
    if (lF) throw new Error(`login: ${lF.message}`);
    const anon = createClient(URL, ANON, INGEN_SESSION);
    console.log('  ✅ testfirma, bruger og fire opgaver oprettet\n');

    // --- Ny ------------------------------------------------------------------
    console.log('Ny:');
    let s = await lead(L1);
    if (s.status === 'open' && !s.startet_at && s.sidst_roert) ok('ny opgave: open, ikke startet, sidst_roert sat');
    else fejl(`ny opgave forkert: ${JSON.stringify(s)}`);

    // --- Det, der IKKE er en handling -----------------------------------------
    console.log('\nIkke handlinger (som håndværkeren i dashboardet):');
    await klient.from('leads').update({ seen_at: new Date().toISOString() }).eq('id', L1);
    s = await lead(L1);
    if (s.seen_at && !s.startet_at) ok('åbnet (seen_at): stadig ny');
    else fejl(`åbning startede opgaven eller blev ikke gemt: ${JSON.stringify(s)}`);

    // Dashboardet sender notes med ved hver gemning, også når kun navnet rettes.
    await klient.from('leads').update({ name: 'L1 rettet navn', notes: 'start' }).eq('id', L1);
    s = await lead(L1);
    if (!s.startet_at) ok('navn rettet, notes sendt uændret med: stadig ny');
    else fejl('en navnerettelse startede opgaven — IS DISTINCT FROM virker ikke');

    // --- Handlinger ------------------------------------------------------------
    console.log('\nHandlinger:');
    const foer = (await lead(L1)).sidst_roert;
    await klient.from('leads').update({ notes: 'besigtiget, skal males' }).eq('id', L1);
    s = await lead(L1);
    if (s.startet_at && s.sidst_roert > foer) ok('note gemt: i gang, sidst_roert flyttet');
    else fejl(`note startede ikke opgaven: ${JSON.stringify(s)}`);

    const { error: rF } = await admin.from('referater').insert({ firm_id: firmId, lead_id: L2, indhold: 'Forløbsprøve' });
    s = await lead(L2);
    if (rF) fejl(`referat kunne ikke oprettes: ${rF.message}`);
    else if (s.startet_at) ok('referat oprettet: i gang');
    else fejl('referat oprettet, men opgaven er ikke startet');

    const { error: tF } = await admin.from('tilbud').insert({ firm_id: firmId, lead_id: L3, sum_ex_moms: 100 });
    s = await lead(L3);
    if (tF) fejl(`tilbud kunne ikke oprettes: ${tF.message}`);
    else if (s.startet_at) ok('tilbud oprettet: i gang');
    else fejl('tilbud oprettet, men opgaven er ikke startet');

    // "Flyt til i gang" og /send-sms bruger samme funktion.
    const { error: hF } = await klient.rpc('opgave_handling', { p_lead: L4 });
    s = await lead(L4);
    if (hF) fejl(`opgave_handling afvist for egen opgave: ${hF.message}`);
    else if (s.startet_at) ok('opgave_handling (Flyt til i gang / SMS): i gang');
    else fejl('opgave_handling kørte, men opgaven er ikke startet');

    // --- Sig nej og genåbn -------------------------------------------------------
    console.log('\nSig nej og genåbn:');
    const startet = (await lead(L1)).startet_at;
    await klient.from('leads').update({ status: 'rejected' }).eq('id', L1);
    s = await lead(L1);
    if (s.status === 'rejected') ok('sig nej: rejected (Lukkede)');
    else fejl(`sig nej virkede ikke: ${s.status}`);
    await klient.from('leads').update({ status: 'open' }).eq('id', L1);
    s = await lead(L1);
    if (s.status === 'open' && s.startet_at === startet) ok('genåbnet: open, startet_at bevaret (I gang)');
    else fejl(`genåbning forkert: ${JSON.stringify(s)}`);

    // --- Låsen på status -----------------------------------------------------------
    console.log('\nStatus låst:');
    const { error: cF } = await admin.from('leads').update({ status: 'faerdig' }).eq('id', L1);
    if (cF && cF.code === '23514') ok('ukendt status afvist af leads_status_gyldig (23514)');
    else fejl(`ukendt status blev ikke afvist: ${cF ? cF.code : 'ingen fejl'}`);

    // --- Lukning efter 3 måneder ---------------------------------------------------
    console.log('\nLukning efter 3 måneder:');
    const dage = (n) => new Date(Date.now() - n * 864e5).toISOString();
    await admin.from('leads').update({ sidst_roert: dage(100) }).eq('id', L2);
    await admin.from('leads').update({ sidst_roert: dage(60) }).eq('id', L3);
    const { data: n, error: iF } = await admin.rpc('luk_inaktive', { p_firm: firmId });
    const s2 = await lead(L2), s3 = await lead(L3);
    if (iF) fejl(`luk_inaktive fejlede: ${iF.message}`);
    else if (n === 1 && s2.status === 'inactive' && s3.status === 'open') ok('100 dage: inactive · 60 dage: stadig open · 1 lukket');
    else fejl(`luk_inaktive forkert: n=${n}, L2=${s2.status}, L3=${s3.status}`);

    // --- Hvem må kalde funktionerne ------------------------------------------------
    console.log('\nAdgang til funktionerne:');
    const { error: a1 } = await klient.rpc('luk_inaktive', { p_firm: firmId });
    if (a1) ok(`luk_inaktive afvist for authenticated (${a1.code || 'fejl'})`);
    else fejl('luk_inaktive kunne kaldes af authenticated');
    const { error: a2 } = await anon.rpc('opgave_handling', { p_lead: L3 });
    if (a2) ok(`opgave_handling afvist for anon (${a2.code || 'fejl'})`);
    else fejl('opgave_handling kunne kaldes af anon');

  } catch (e) {
    fejlet++;
    console.log(`\n❌ AFBRUDT: ${e.message}`);
  } finally {
    console.log('\nOprydning:');
    if (firmId) {
      await admin.from('leads').delete().eq('firm_id', firmId);
      await admin.from('firm_users').delete().eq('firm_id', firmId);
      await admin.from('firms').delete().eq('id', firmId);
    }
    if (userId) await admin.auth.admin.deleteUser(userId);
    console.log('  🧹 ryddet');
  }

  console.log(`\n=== Resultat: ${bestaaet} bestået, ${fejlet} fejlet ===\n`);
  process.exit(fejlet ? 1 : 0);
})();
