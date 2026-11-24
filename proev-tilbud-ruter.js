/**
 * proev-tilbud-ruter.js — Fase 5 trin B, C og D: tilbuddets ruter (routes/tilbud/tilbud.js)
 * mod en KØRENDE server og STAGING-databasen.
 *
 * Beviser ejerskab (IDOR: fremmed id = 404), modulspærren, rev (409), at
 * serveren regner og gemmer tallene, og at databasens egen genregning i
 * godkend_tilbud() er enig til øren. Trin C: godkend gennem ruten, frysningen
 * (profilen ændres bagefter), sendt/accepteret/fortryd og en ny version, der
 * erstatter den gamle. Desuden, at en opgave oprettet gennem
 * /api/tilbud/opgaver får oprettet_via = 'tilbud'. Trin D: referencetallet
 * (gratis), og med --forslag ét rigtigt tilbudsforslag mod modellen (koster
 * få øre; kræver TILBUDSFORSLAG_AKTIV=true på serveren og migrationen
 * 20261122120000_tilbud_forslag_skriv på staging).
 *
 * Opretter to testfirmaer (is_test) med hver sin bruger. Rører intet andet;
 * alt ryddes op gennem slet_firma() i finally.
 *
 *   node proev-tilbud-ruter.js                          # tørkørsel: viser mål
 *   node proev-tilbud-ruter.js --bekraeft               # kører prøven
 *   node proev-tilbud-ruter.js --bekraeft --url=http://localhost:3000
 *   node proev-tilbud-ruter.js --bekraeft --forslag --url=...   # også ét rigtigt forslag
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
const FORSLAG  = process.argv.includes('--forslag');
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
  console.log('\n=== Prøve: tilbuddets ruter (Fase 5 trin B, C og D) ===');
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

    console.log('\nGodkendelse (trin C) — databasen regner igen:');
    r = await kald(a, 'POST', `/api/tilbud/${t.id}/godkend`, { rev: t.rev });
    tjek(r.status === 422 && r.json.error === 'kan_ikke_godkendes' && r.json.mangler.includes('CVR mangler (Profil)'), `med mangler: 422 med listen (${r.status})`, r.json);
    await admin.from('firma_profil').update({ cvr: '12345678', bank_reg: '1234', bank_konto: '5678' }).eq('firm_id', a.firmId);
    r = await kald(a, 'POST', `/api/tilbud/${t.id}/hent-profil`, { rev: t.rev });
    t = r.json.tilbud;
    tjek(t.kan_godkendes, 'efter hent-profil: kan godkendes', t.mangler);
    r = await kald(b, 'POST', `/api/tilbud/${t.id}/godkend`, { rev: t.rev });
    tjek(r.status === 404, `B godkender A's tilbud: 404 (${r.status})`);
    r = await kald(a, 'POST', `/api/tilbud/${t.id}/godkend`, { rev: t.rev });
    const g = r.json && r.json.tilbud;
    tjek(r.status === 200 && g.status === 'godkendt' && g.tilbudsnummer >= 1 && g.gyldig_til, `godkendt gennem ruten: nummer ${g && g.tilbudsnummer} (godkend_tilbud() var enig i de gemte tal)`, r.json);
    t = g;
    r = await kald(a, 'PATCH', `/api/tilbud/${t.id}`, { rev: t.rev, titel: 'efter' });
    tjek(r.status === 409 && r.json.error === 'tilbud_laast', `efter godkendelse: 409 tilbud_laast (${r.status})`);

    console.log('\nFrysningen (#13, A10):');
    await admin.from('firma_profil').update({ cvr: '87654321', timepris: 600 }).eq('firm_id', a.firmId);
    await admin.from('leads').update({ name: 'Ændret navn' }).eq('id', leadA);
    r = await kald(a, 'GET', `/api/tilbud/${t.id}`);
    tjek(r.json.tilbud.firma.cvr === '12345678' && r.json.tilbud.timepris_oere === 47500 && r.json.tilbud.kunde.navn === 'Kunde A' && JSON.stringify(r.json.tilbud.summer) === JSON.stringify(t.summer),
      'profil og kunde ændret bagefter: tilbuddet viser det, kunden fik', r.json.tilbud.firma);
    const { data: hist } = await admin.from('tilbud_historik').select('haendelse, kopi').eq('tilbud_id', t.id);
    tjek((hist || []).length === 1 && hist[0].kopi.tilbud.firma_cvr === '12345678', `historikken har en fuld kopi af det godkendte (${(hist || []).length} række)`);

    console.log('\nHændelser (#1, #2) og fortryd:');
    r = await kald(a, 'POST', `/api/tilbud/${t.id}/sendt`, { rev: t.rev }); t = r.json.tilbud;
    tjek(r.status === 200 && t.status === 'sendt' && t.sendt_at, `sendt (${r.status})`);
    r = await kald(a, 'POST', `/api/tilbud/${t.id}/accepteret`, { rev: t.rev }); t = r.json.tilbud;
    tjek(r.status === 200 && t.status === 'accepteret' && t.accepteret_at, `accepteret (${r.status})`);
    r = await kald(a, 'POST', `/api/tilbud/${t.id}/fortryd`, { rev: t.rev }); t = r.json.tilbud;
    tjek(r.status === 200 && t.status === 'sendt' && t.accepteret_at === null, `fortryd: tilbage til sendt (${r.status})`);
    r = await kald(a, 'POST', `/api/tilbud/${t.id}/sendt`, { rev: t.rev });
    tjek(r.status === 409 && r.json.error === 'haendelse_ikke_tilladt', `sendt igen: 409 (${r.status})`);

    console.log('\nNy version (#7, #15):');
    r = await kald(a, 'POST', `/api/tilbud/${t.id}/ny-version`, { rev: t.rev });
    let v2 = r.json && r.json.tilbud;
    tjek(r.status === 201 && v2.version === 2 && v2.status === 'kladde' && v2.firma.cvr === '87654321' && v2.timepris_oere === 60000,
      `version 2 som kladde med profilen, som den er nu (${r.status})`, r.json);
    r = await kald(a, 'POST', `/api/tilbud/${v2.id}/godkend`, { rev: v2.rev }); v2 = r.json.tilbud;
    tjek(r.status === 200 && v2.erstatter && v2.erstatter.tilbudsnummer === t.tilbudsnummer && v2.tilbudsnummer === t.tilbudsnummer + 1,
      `version 2 godkendt: nummer ${v2 && v2.tilbudsnummer}, erstatter nr. ${t.tilbudsnummer}`, r.json);
    r = await kald(a, 'GET', `/api/tilbud/${t.id}`);
    tjek(r.json.tilbud.status === 'erstattet', `version 1 er erstattet (${r.json.tilbud.status})`);

    console.log('\nReferencetal (trin D, #9, #16):');
    r = await kald(a, 'POST', `/api/tilbud/${v2.id}/accepteret`, { rev: v2.rev });
    r = await kald(a, 'GET', `/api/tilbud/referencetal?opgavetype_id=${v2.opgavetype.id}`);
    tjek(r.status === 200 && r.json.antal === 1 && r.json.opgavetype.enhed === 'm²' && r.json.arbejde_oere_pr_enhed && r.json.arbejde_oere_pr_enhed.median > 0,
      `egne accepterede tilbud: ${r.json && r.json.antal} (arbejde ${r.json && r.json.arbejde_oere_pr_enhed && r.json.arbejde_oere_pr_enhed.median} øre pr. m²)`, r.json);
    r = await kald(b, 'GET', `/api/tilbud/referencetal?opgavetype_id=${v2.opgavetype.id}`);
    tjek(r.status === 404, `B ser ikke A's referencetal: 404 (${r.status})`);

    if (FORSLAG) {
      console.log('\nTilbudsforslaget (trin D, kontrakt §4) — ét rigtigt kald:');
      const leadF = await opgave(a, 'Kunde F');
      await admin.from('leads').update({ task: 'Ny terrasse i lærk, ca. 40 m². Der skal bruges lærkebrædder 28x120 og en pakke skruer.' }).eq('id', leadF);
      const { data: ref, error: refF } = await admin.from('referater')
        .insert({ firm_id: a.firmId, lead_id: leadF, moede_dato: '2026-11-18', indhold: 'Vi målte terrassen op til 4,35 gange 6,2 meter.', kilde: 'manuel' })
        .select('id').single();
      if (refF) throw new Error(`referat: ${refF.message}`);
      r = await kald(a, 'POST', '/api/tilbud', { lead_id: leadF });
      const tf = r.json.tilbud;
      r = await kald(b, 'POST', '/api/tilbud/tilbudslinjer', { tilbud_id: tf.id, referat_ids: [ref.id] });
      tjek(r.status === 404, `B laver forslag på A's tilbud: 404 (${r.status})`);
      r = await kald(a, 'POST', '/api/tilbud/tilbudslinjer', { tilbud_id: tf.id, referat_ids: [ref.id] });
      const f = r.json && r.json.tilbud;
      tjek(r.status === 200 && f && f.titel && f.titel_kilde === 'model' && !f.titel_bekraeftet,
        `forslag skrevet (${r.status}): titel fra modellen, ikke bekræftet`, r.json);
      if (f) {
        const ml = f.linjer.filter((l) => l.kilde === 'model');
        tjek(ml.every((l) => !l.bekraeftet && l.enhedspris_oere === null && (l.antal === null || typeof l.antal === 'string')),
          `${ml.length} modellinjer: ingen priser, ikke bekræftet, antal som tekst`, ml);
        tjek(f.kilder.referat_ids.length === 1 && f.kilder.referat_ids[0] === ref.id, 'kilderne husker referatet');
        const { data: fl } = await admin.from('tilbud_forslag').select('model, prompt_version, retry').eq('tilbud_id', tf.id);
        const { data: brugt } = await admin.from('ai_forbrug').select('pris_oere').eq('firm_id', a.firmId).eq('formaal', 'tilbud');
        const oere = (brugt || []).reduce((s, x) => s + Number(x.pris_oere), 0);
        tjek((fl || []).length === 1 && (brugt || []).length >= 1,
          `tilbud_forslag: ${fl && fl[0] && fl[0].model} / ${fl && fl[0] && fl[0].prompt_version}${fl && fl[0] && fl[0].retry ? ' (nyt forsøg)' : ''}; bogført ${(brugt || []).length} kald, ${oere.toFixed(2)} øre`);
      }
    }

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
      // ai_forbrug først: tabellens forhold til firms er ikke prøvet her (forslaget bogfører).
      await admin.from('ai_forbrug').delete().eq('firm_id', t.firmId);
      const { error } = await admin.rpc('slet_firma', { p_firm: t.firmId });
      if (error) console.log(`  ⚠️ slet_firma ${t.navn}: ${error.message}`);
      if (t.userId) await admin.auth.admin.deleteUser(t.userId);
      console.log(`  🧹 ryddet: ${t.navn}`);
    }
  }

  console.log(`\n=== Resultat: ${bestaaet} bestået, ${fejlet} fejlet ===\n`);
  process.exit(fejlet ? 1 : 0);
})();
