/**
 * proev-tilbud-ruter.js — Fase 5 trin B: tilbuddets ruter (routes/tilbud/tilbud.js)
 * mod en KØRENDE server og STAGING-databasen.
 *
 * Beviser ejerskab (IDOR: fremmed id = 404), modulspærren, rev (409), at
 * serveren regner og gemmer tallene, og at databasens egen genregning i
 * godkend_tilbud() er enig til øren. Desuden, at en opgave oprettet gennem
 * /api/tilbud/opgaver får oprettet_via = 'tilbud'.
 *
 * Opretter to testfirmaer (is_test) med hver sin bruger. Rører intet andet;
 * alt ryddes op gennem slet_firma() i finally.
 *
 *   node proev-tilbud-ruter.js                          # tørkørsel: viser mål
 *   node proev-tilbud-ruter.js --bekraeft               # kører prøven
 *   node proev-tilbud-ruter.js --bekraeft --url=http://localhost:3000
 *
 * Serveren skal køre med TILBUD_AKTIV=true og TILBUDSDEL_AKTIV=true, mod
 * samme database som .env, og migrationen tilbud_fase5 skal være kørt dér.
 * Kræver i .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 * og BASE_URL (eller --url=).
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
const tjek = (b, tekst, info) => {
  if (b) { bestaaet++; console.log(`  ✅ ${tekst}`); }
  else { fejlet++; console.log(`  ❌ ${tekst}${info !== undefined ? '  ' + JSON.stringify(info).slice(0, 400) : ''}`); }
};

async function opretFirma(navn) {
  const email = `tilbud-${navn}-${KOERSEL}@example.invalid`;
  const password = `Ti!${kort()}${kort()}`;
  const { data: b, error: bF } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (bF) throw new Error(`bruger ${navn}: ${bF.message}`);
  const t = { navn, userId: b.user.id };
  const { data: f, error: fF } = await admin.from('firms').insert({
    name: `Tilbudsprøve ${navn} ${KOERSEL}`, slug: `tilbud-${navn}-${KOERSEL}`, status: 'active', is_test: true,
  }).select('id').single();
  if (fF) throw new Error(`firma ${navn}: ${fF.message}`);
  t.firmId = f.id;
  const { error: kF } = await admin.from('firm_users').insert({ firm_id: t.firmId, user_id: t.userId });
  if (kF) throw new Error(`firm_users ${navn}: ${kF.message}`);
  const { error: pF } = await admin.from('firma_profil').upsert({ firm_id: t.firmId, timepris: 475, koersel_km_sats_oere: 380, koersel_fast_oere: 25000 });
  if (pF) throw new Error(`firma_profil ${navn}: ${pF.message}`);
  const klient = createClient(URL, ANON, INGEN_SESSION);
  const { data: s, error: lF } = await klient.auth.signInWithPassword({ email, password });
  if (lF) throw new Error(`login ${navn}: ${lF.message}`);
  t.token = s.session.access_token;
  return t;
}

async function kald(t, metode, sti, body, hdr = {}) {
  const headers = { 'Content-Type': 'application/json', ...hdr };
  if (t) headers.Authorization = `Bearer ${t.token}`;
  const r = await fetch(SERVER + sti, { method: metode, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await r.json(); } catch (_) {}
  return { status: r.status, json };
}

async function opgave(t, navn) {
  const { data, error } = await admin.from('leads')
    .insert({ firm_id: t.firmId, name: navn, address: 'Prøvevej 1', task: 'Prøve', oprettet_via: 'tilbud' })
    .select('id').single();
  if (error) throw new Error(`opgave: ${error.message}`);
  return data.id;
}

(async () => {
  console.log('\n=== Prøve: tilbuddets ruter (Fase 5 trin B) ===');
  console.log(`Projekt-ref : ${REF}`);
  console.log(`Server      : ${SERVER}`);
  console.log(`Kørsels-id  : ${KOERSEL}\n`);
  if (!BEKRAEFT) {
    console.log('TØRKØRSEL — intet oprettet. Tjek at BEGGE mål er STAGING (eller din lokale server mod staging), og kør med --bekraeft.\n');
    process.exit(0);
  }

  let a = null, b = null;
  try {
    a = await opretFirma('a');
    b = await opretFirma('b');
    const leadA = await opgave(a, 'Kunde A');

    console.log('Flag og spærre:');
    let r = await kald(a, 'GET', '/api/tilbud/enheder');
    tjek(r.status === 200, `GET /api/tilbud/enheder svarer 200 (TILBUDSDEL_AKTIV er tændt): ${r.status}`, r.json);
    r = await kald(a, 'POST', '/api/tilbud', { lead_id: leadA });
    tjek(r.status === 403 && r.json && r.json.error === 'modul_mangler', 'uden modulet tilbud: 403 modul_mangler', r);
    for (const t of [a, b]) {
      const { error } = await admin.from('firma_moduler').insert({ firm_id: t.firmId, modul: 'tilbud', kilde: 'proeve' });
      if (error) throw new Error(`modul ${t.navn}: ${error.message}`);
    }

    console.log('\nOprettelse og ejerskab:');
    r = await kald(a, 'POST', '/api/tilbud', { lead_id: leadA });
    tjek(r.status === 201, `ny kladde: ${r.status}`, r.json);
    let t = r.json.tilbud;
    tjek(t.timepris_oere === 47500 && t.linjer.length === 1 && t.linjer[0].type === 'arbejde' && t.linjer[0].enhedspris_oere === 47500,
      'profilen kopieret (475 kr. = 47500 øre) og arbejdslinjen oprettet uden timer', t);
    r = await kald(a, 'POST', '/api/tilbud', { lead_id: leadA });
    tjek(r.status === 409 && r.json.error === 'kaede_findes', 'igen på samme opgave: 409 kaede_findes', r);
    r = await kald(b, 'GET', `/api/tilbud/${t.id}`);
    tjek(r.status === 404, `B læser A's tilbud: 404 (${r.status})`);
    r = await kald(b, 'PATCH', `/api/tilbud/${t.id}`, { rev: t.rev, titel: 'x' });
    tjek(r.status === 404, `B retter A's tilbud: 404 (${r.status})`);
    r = await kald(b, 'POST', '/api/tilbud', { lead_id: leadA });
    tjek(r.status === 404, `B opretter tilbud på A's opgave: 404 (${r.status})`);
    r = await kald(b, 'PATCH', `/api/tilbud/${t.id}/linjer/${t.linjer[0].id}`, { rev: t.rev, antal: '1' });
    tjek(r.status === 404, `B retter en linje på A's tilbud: 404 (${r.status})`);
    r = await kald(a, 'GET', '/api/tilbud/status');
    tjek(r.status === 200, `/api/tilbud/status rammes stadig: ${r.status}`);

    console.log('\nRev og regning:');
    r = await kald(a, 'PATCH', `/api/tilbud/${t.id}`, { titel: 'Prøve' });
    tjek(r.status === 422, `uden rev: 422 (${r.status})`);
    r = await kald(a, 'PATCH', `/api/tilbud/${t.id}`, { rev: t.rev + 3, titel: 'Prøve' });
    tjek(r.status === 409 && r.json.error === 'rev_passer_ikke', `forkert rev: 409 (${r.status})`);
    r = await kald(a, 'PATCH', `/api/tilbud/${t.id}/linjer/${t.linjer[0].id}`, { rev: t.rev, antal: '12', rabat: { form: 'kroner', beloeb_oere: 50000 } });
    t = r.json.tilbud;
    r = await kald(a, 'POST', `/api/tilbud/${t.id}/linjer`, { rev: t.rev, type: 'materiale', beskrivelse: 'Lærkebrædder', antal: '1', enhedspris_oere: 1500000 });
    t = r.json.tilbud;
    r = await kald(a, 'PATCH', `/api/tilbud/${t.id}`, { rev: t.rev, rabat: { form: 'procent', procent: '10' }, titel: 'Prøve', titel_bekraeftet: true }, { 'If-Match': String(t.rev) });
    t = r.json.tilbud;
    const s = t.summer;
    tjek(s.arbejde_oere === 520000 && s.materialer_oere === 1500000 && s.samlet_rabat_oere === 202000 && s.ex_moms_oere === 1818000 && s.moms_oere === 454500 && s.inkl_moms_oere === 2272500,
      'kontraktens eksempel: 5.200 + 15.000 − 10 % = 18.180 ex, 4.545 moms, 22.725 inkl.', s);
    r = await kald(a, 'POST', `/api/tilbud/${t.id}/linjer`, { rev: t.rev, type: 'andet', beskrivelse: 'Halv øre', antal: '1.5', enhedspris_oere: 1235 });
    t = r.json.tilbud;
    const halv = t.linjer.find((l) => l.beskrivelse === 'Halv øre');
    tjek(halv && halv.brutto_oere === 1853, `1,5 × 12,35 = 18,53 (halve øre væk fra nul): ${halv && halv.brutto_oere}`);
    r = await kald(a, 'PATCH', `/api/tilbud/${t.id}`, { rev: t.rev, rabat: { form: 'kroner', beloeb_oere: 999999999 } });
    tjek(r.status === 422 && r.json.kode === 'rabat_negativ', `rabat større end tilbuddet: 422 (${r.status})`);
    r = await kald(a, 'PATCH', `/api/tilbud/${t.id}`, { rev: t.rev, koersel: { form: 'km', km: '18' } });
    t = r.json.tilbud;
    tjek(t.summer.koersel_oere === 6840, `kørsel 18 km × 3,80 = 68,40: ${t.summer.koersel_oere}`);

    console.log('\nEnheder og typer:');
    r = await kald(a, 'POST', '/api/tilbud/enheder', { navn: 'kvm' });
    tjek(r.status === 200 && r.json.enhed.navn === 'm²', `"kvm" er grundlistens m² (${r.status})`, r.json);
    const m2 = r.json.enhed.id;
    r = await kald(a, 'POST', '/api/tilbud/enheder', { navn: `ruller ${KOERSEL}` });
    tjek(r.status === 201, `egen enhed oprettet: ${r.status}`);
    const egen = r.json.enhed.id;
    r = await kald(b, 'POST', '/api/tilbud/opgavetyper', { navn: 'Græs', enhed_id: egen });
    tjek(r.status === 404, `B bruger A's enhed: 404 (${r.status})`);
    r = await kald(a, 'PATCH', `/api/tilbud/${t.id}`, { rev: t.rev, opgavetype: { navn: 'Terrasse', enhed_id: m2 }, maengde: { faktorer: ['4.35', '6.2'] } });
    t = r.json.tilbud;
    tjek(t.opgavetype && t.opgavetype.ny && t.maengde && t.maengde.vaerdi === '26.97', `ny type og mængde 4,35 × 6,2 = 26,97 (${t.maengde && t.maengde.vaerdi})`);
    r = await kald(a, 'PATCH', `/api/tilbud/${t.id}`, { rev: t.rev, opgavetype_bekraeftet: true, maengde_bekraeftet: true });
    t = r.json.tilbud;
    tjek(t.opgavetype && t.opgavetype.id && t.opgavetype_bekraeftet, 'typen oprettet ved bekræftelsen');

    console.log('\nGodkendelse i databasen (genregningen):');
    await admin.from('firma_profil').update({ cvr: '12345678', bank_reg: '1234', bank_konto: '5678' }).eq('firm_id', a.firmId);
    r = await kald(a, 'POST', `/api/tilbud/${t.id}/hent-profil`, { rev: t.rev });
    t = r.json.tilbud;
    tjek(t.kan_godkendes, 'efter hent-profil: kan godkendes', t.mangler);
    const { data: g, error: gF } = await admin.rpc('godkend_tilbud', { p_tilbud: t.id, p_firm: a.firmId });
    tjek(!gF && g && g[0] && g[0].tilbudsnummer >= 1, `godkend_tilbud() er enig i de gemte tal${gF ? ': ' + gF.message : ''}`);
    r = await kald(a, 'PATCH', `/api/tilbud/${t.id}`, { rev: t.rev + 1, titel: 'efter' });
    tjek(r.status === 409 && r.json.error === 'tilbud_laast', `efter godkendelse: 409 tilbud_laast (${r.status})`);

    console.log('\nOpgavens oprindelse (A14):');
    r = await kald(a, 'POST', '/api/tilbud/opgaver', { name: 'Kunde C', address: 'Prøvevej 3', task: 'Prøve' });
    const { data: ny } = await admin.from('leads').select('oprettet_via').eq('id', r.json && r.json.opgave ? r.json.opgave.id : '00000000-0000-0000-0000-000000000000').maybeSingle();
    tjek(r.status === 201 && ny && ny.oprettet_via === 'tilbud', `POST /api/tilbud/opgaver giver oprettet_via = 'tilbud' (${ny && ny.oprettet_via})`);
  } catch (e) {
    fejlet++;
    console.log(`\n❌ AFBRUDT: ${e.message}`);
  } finally {
    console.log('\nOprydning:');
    for (const t of [a, b]) {
      if (!t) continue;
      const { error } = await admin.rpc('slet_firma', { p_firm: t.firmId });
      if (error) console.log(`  ⚠️ slet_firma ${t.navn}: ${error.message}`);
      if (t.userId) await admin.auth.admin.deleteUser(t.userId);
      console.log(`  🧹 ryddet: ${t.navn}`);
    }
  }

  console.log(`\n=== Resultat: ${bestaaet} bestået, ${fejlet} fejlet ===\n`);
  process.exit(fejlet ? 1 : 0);
})();
