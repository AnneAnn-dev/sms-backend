/**
 * proev-tilbud-skema.js — beviser Fase 5's tilbudsmigration (tilbud_fase5) mod STAGING.
 *
 * Byggeplanens afsnit "Databasen" og kontrakten (udkast 9): firmabinding (A6),
 * historikken kun skrevet af serveren og append-only (A7), profilen uden
 * klientskriveret og med startnummer-vagt (A8), godkendelse med nummer og
 * samtidighed (A3), låsen og statusskiftene (A2), beregningen genregnet i
 * databasen (#14, B1), kildekopien (A5) og slettevejen (A1, #17).
 * Afprøvet mod lokal Postgres 16 før levering.
 *
 * Opretter to testfirmaer (A og B) med hver sin bruger. Rører aldrig andet;
 * firmaerne slettes til sidst gennem slet_firma() — det er selv en del af prøven.
 *
 *   node proev-tilbud-skema.js              # tørkørsel: viser målet
 *   node proev-tilbud-skema.js --bekraeft   # kører prøven
 *
 * Kræver i .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
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
const INGEN_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, INGEN_SESSION);

let bestaaet = 0, fejlet = 0;
const ok   = (b) => { bestaaet++; console.log(`  ✅ ${b}`); };
const fejl = (b) => { fejlet++;   console.log(`  ❌ ${b}`); };
const stop = (hvad, e) => { if (e) throw new Error(`${hvad}: ${e.code || ''} ${e.message}`); };

/** Forventer, at kaldet afvises, og at fejlen indeholder `tekst` (besked eller kode). */
async function afvist(beskrivelse, kald, tekst) {
  const { error } = await kald();
  if (!error) return fejl(`${beskrivelse}: IKKE AFVIST`);
  const hvad = `${error.code || ''} ${error.message || ''}`;
  if (tekst && !hvad.includes(tekst)) return fejl(`${beskrivelse}: afvist af forkert grund — ${hvad}`);
  ok(`${beskrivelse}: afvist (${error.code || 'fejl'})`);
}

async function opretFirma(navn) {
  const email = `tilbudskema-${navn}-${KOERSEL}@example.invalid`;
  const password = `Ts!${kort()}${kort()}`;
  const { data: b, error: bF } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  stop(`bruger ${navn}`, bF);
  const t = { navn, userId: b.user.id };
  const { data: f, error: fF } = await admin.from('firms').insert({
    name: `Tilbudsskema-prøve ${navn} ${KOERSEL}`, slug: `tilbudskema-${navn}-${KOERSEL}`, status: 'active', is_test: true
  }).select('id').single();
  stop(`firma ${navn}`, fF);
  t.firmId = f.id;
  stop(`firm_users ${navn}`, (await admin.from('firm_users').insert({ firm_id: t.firmId, user_id: t.userId })).error);
  // D68: firms-triggeren har oprettet profilen.
  stop(`profil ${navn}`, (await admin.from('firma_profil').update({ cvr: '12345678', timepris: 475 }).eq('firm_id', t.firmId)).error);
  t.klient = createClient(URL, ANON, INGEN_SESSION);
  stop(`login ${navn}`, (await t.klient.auth.signInWithPassword({ email, password })).error);
  return t;
}

async function opgave(t, navn) {
  const { data, error } = await admin.from('leads').insert({
    firm_id: t.firmId, name: navn, address: 'Søndergade 4, 8000 Aarhus C', task: 'Tilbudsskema-prøve', oprettet_via: 'tilbud'
  }).select('id').single();
  stop('leads', error); return data.id;
}

/** En kladde med én bekræftet linje og summer, der passer (12 t × 475 kr. = 5.700,00; moms 1.425,00). */
async function kladde(t, leadId, ekstra = {}) {
  const { data, error } = await admin.from('tilbud').insert({
    firm_id: t.firmId, lead_id: leadId, titel: 'Prøvetilbud', titel_bekraeftet: true,
    firma_navn: `Firma ${t.navn}`, firma_cvr: '12345678', gyldig_dage: 30, timepris_oere: 47500,
    arbejde_oere: 570000, foer_samlet_rabat_oere: 570000, ex_moms_oere: 570000, moms_oere: 142500, inkl_moms_oere: 712500,
    ...ekstra
  }).select('id, kaede_id').single();
  stop('tilbud', error);
  stop('linje', (await admin.from('tilbud_linjer').insert({
    tilbud_id: data.id, firm_id: t.firmId, type: 'arbejde', beskrivelse: 'Arbejde', antal: 12,
    enhedspris_oere: 47500, brutto_oere: 570000, rabat_oere: 0, linje_sum_oere: 570000, bekraeftet: true
  })).error);
  return data;
}

const godkend = (t, id) => admin.rpc('godkend_tilbud', { p_tilbud: id, p_firm: t.firmId, p_bruger: t.userId });
const haendelse = (t, id, h) => admin.rpc('tilbud_haendelse', { p_tilbud: id, p_firm: t.firmId, p_haendelse: h, p_bruger: t.userId });
const raekke = async (tabel, kol, val, felter = '*') => {
  const { data, error } = await admin.from(tabel).select(felter).eq(kol, val);
  stop(`opslag ${tabel}`, error); return data || [];
};

(async () => {
  console.log('\n=== Prøve: tilbudsskemaet (Fase 5, trin A) ===');
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
    const LA1 = await opgave(a, 'Kunde A1');
    const LA2 = await opgave(a, 'Kunde A2');
    const LA3 = await opgave(a, 'Kunde A3');
    const LB1 = await opgave(b, 'Kunde B1');

    console.log('Opgavens oprindelse (A14):');
    {
      const { count, error } = await admin.from('leads').select('id', { count: 'exact', head: true }).is('oprettet_via', null);
      stop('oprettet_via', error);
      if (count === 0) ok('ingen opgaver uden oprettet_via efter migrationen');
      else fejl(`${count} opgaver uden oprettet_via`);
    }

    console.log('\nFirmabinding (A6):');
    await afvist('tilbud med A\'s opgave og B\'s firm_id',
      () => admin.from('tilbud').insert({ firm_id: b.firmId, lead_id: LA1 }), '23503');
    const T1 = await kladde(a, LA1);
    await afvist('linje med A\'s tilbud og B\'s firm_id',
      () => admin.from('tilbud_linjer').insert({ tilbud_id: T1.id, firm_id: b.firmId, beskrivelse: 'x' }), '23503');
    const { data: enhedB } = await admin.from('enheder').insert({ firm_id: b.firmId, navn: `rulle-${KOERSEL}` }).select('id').single();
    await afvist('linje i A\'s tilbud med B\'s egen enhed',
      () => admin.from('tilbud_linjer').insert({ tilbud_id: T1.id, firm_id: a.firmId, beskrivelse: 'x', enhed_id: enhedB.id }), 'enhed_ikke_firmaets');
    await afvist('godkend A\'s tilbud med B\'s firm_id', () => godkend(b, T1.id), 'tilbud_findes_ikke');

    console.log('\nEnheder og typer (A9):');
    await afvist('samme enhed med andre bogstaver og mellemrum',
      () => admin.from('enheder').insert({ firm_id: b.firmId, navn: `  RULLE-${KOERSEL} ` }), '23505');
    {
      const { data } = await admin.from('enheder').select('id').is('firm_id', null);
      if ((data || []).length === 9) ok('grundlisten har 9 enheder'); else fejl(`grundlisten har ${(data || []).length} enheder`);
    }

    console.log('\nKæde og kladde (A3, #15):');
    await afvist('en anden kæde på samme opgave',
      () => admin.from('tilbud').insert({ firm_id: a.firmId, lead_id: LA1 }), '23505');
    await afvist('en anden kladde i samme kæde',
      () => admin.from('tilbud').insert({ firm_id: a.firmId, lead_id: LA1, kaede_id: T1.kaede_id, version: 2 }), '23505');

    console.log('\nBeregningen genregnes i databasen (#14, B1):');
    {
      const T2 = await kladde(a, LA2, { moms_oere: 142501, inkl_moms_oere: 712501 });
      await afvist('godkend med en moms, der er én øre forkert', () => godkend(a, T2.id), 'summer_passer_ikke');
      // 1,5 × 12,35 = 18,525 -> 18,53; 10 % rabat 1,853 -> 1,85; netto 16,68
      stop('afrundingslinje', (await admin.from('tilbud_linjer').insert({
        tilbud_id: T2.id, firm_id: a.firmId, sortering: 2, type: 'materiale', beskrivelse: 'Liste', antal: 1.5,
        enhedspris_oere: 1235, rabat_form: 'procent', rabat_procent: 10, brutto_oere: 1853, rabat_oere: 185,
        linje_sum_oere: 1668, bekraeftet: true
      })).error);
      // 570.000 + 1.668 = 571.668; moms 25 % = 142.917
      stop('summer', (await admin.from('tilbud').update({ materialer_oere: 1668, foer_samlet_rabat_oere: 571668,
        ex_moms_oere: 571668, moms_oere: 142917, inkl_moms_oere: 714585 }).eq('id', T2.id)).error);
      const { data: afv, error } = await admin.rpc('tilbud_genregn', { p_tilbud: T2.id });
      if (error) fejl(`tilbud_genregn: ${error.message}`);
      else if ((afv || []).length === 0) ok('18,525 → 18,53, rabat 1,85, netto 16,68, moms på summen: databasen er enig');
      else fejl(`databasen er uenig: ${JSON.stringify(afv)}`);
      a.T2 = T2;
    }

    console.log('\nGodkendelse og samtidighed (A3, #7):');
    {
      const [r1, r2] = await Promise.all([godkend(a, T1.id), godkend(a, a.T2.id)]);
      if (r1.error || r2.error) fejl(`samtidig godkendelse fejlede: ${(r1.error || r2.error).message}`);
      else {
        const n = [r1.data[0].tilbudsnummer, r2.data[0].tilbudsnummer].sort();
        if (n[0] === 1 && n[1] === 2) ok('to samtidige godkendelser fik nummer 1 og 2');
        else fejl(`samtidige godkendelser fik ${JSON.stringify(n)}`);
      }
      await afvist('godkend samme tilbud igen', () => godkend(a, T1.id), 'tilbud_ikke_kladde');
      const [t] = await raekke('tilbud', 'id', T1.id, 'status, kunde_navn, kunde_arbejdssted, gyldig_til');
      if (t.status === 'godkendt' && t.kunde_navn === 'Kunde A1' && t.kunde_arbejdssted && t.gyldig_til)
        ok('godkendt: kunde, arbejdssted og gyldig_til frosset');
      else fejl(`godkendt tilbud: ${JSON.stringify(t)}`);
    }

    console.log('\nLåsen (A2):');
    await afvist('ret timeprisen på et godkendt tilbud',
      () => admin.from('tilbud').update({ timepris_oere: 1 }).eq('id', T1.id), 'tilbud_laast');
    await afvist('sæt status direkte (uden om tilbud_haendelse)',
      () => admin.from('tilbud').update({ status: 'sendt' }).eq('id', T1.id), 'tilbud_statusskift');
    await afvist('ret en linje på et godkendt tilbud',
      () => admin.from('tilbud_linjer').update({ antal: 13 }).eq('tilbud_id', T1.id), 'tilbud_laast');
    await afvist('tilføj en kilde til et godkendt tilbud',
      () => admin.from('tilbud_kilder').insert({ tilbud_id: T1.id, firm_id: a.firmId, lead_id: LA1, nr: 1, tekst_kopi: 'x' }), 'tilbud_laast');
    await afvist('slet et godkendt tilbud',
      () => admin.from('tilbud').delete().eq('id', T1.id), 'tilbud_laast');

    console.log('\nHistorikken (A7):');
    {
      const h = await raekke('tilbud_historik', 'tilbud_id', T1.id);
      if (h.length === 1 && h[0].haendelse === 'godkendt' && (h[0].kopi.linjer || []).length === 1) ok('én godkendt-post med fuld kopi');
      else fejl(`historik: ${JSON.stringify(h.map(x => x.haendelse))}`);
      await afvist('serveren retter en historikpost',
        () => admin.from('tilbud_historik').update({ haendelse: 'accepteret' }).eq('tilbud_id', T1.id), 'append-only');
      await afvist('serveren sletter en historikpost',
        () => admin.from('tilbud_historik').delete().eq('tilbud_id', T1.id), 'append-only');
      await afvist('serveren indsætter en historikpost uden om funktionerne',
        () => admin.from('tilbud_historik').insert({ tilbud_id: T1.id, firm_id: a.firmId, haendelse: 'accepteret', fra_status: 'godkendt', til_status: 'accepteret', kopi: {} }), 'skrives kun af');
    }

    console.log('\nHændelser og fortrydelse (#1, #2, A2):');
    {
      const s1 = await haendelse(a, T1.id, 'sendt');
      const s2 = await haendelse(a, T1.id, 'accepteret');
      const s3 = await haendelse(a, T1.id, 'fortrudt');
      if (!s1.error && !s2.error && s3.data === 'sendt') ok('sendt → accepteret → fortrudt tilbage til sendt');
      else fejl(`hændelser: ${JSON.stringify([s1, s2, s3].map(r => r.error ? r.error.message : r.data))}`);
      await afvist('sendt igen, når tilbuddet allerede er sendt', () => haendelse(a, T1.id, 'sendt'), 'haendelse_ikke_tilladt');
    }

    console.log('\nNy version (#7, #15, B16):');
    {
      const { data: v2, error } = await admin.from('tilbud').insert({
        firm_id: a.firmId, lead_id: LA1, kaede_id: T1.kaede_id, version: 2, titel: 'Prøvetilbud v2', titel_bekraeftet: true,
        firma_navn: 'Firma a', firma_cvr: '12345678', gyldig_dage: 14, timepris_oere: 47500,
        arbejde_oere: 570000, foer_samlet_rabat_oere: 570000, ex_moms_oere: 570000, moms_oere: 142500, inkl_moms_oere: 712500
      }).select('id').single();
      stop('version 2', error);
      stop('linje v2', (await admin.from('tilbud_linjer').insert({ tilbud_id: v2.id, firm_id: a.firmId, type: 'arbejde',
        beskrivelse: 'Arbejde', antal: 12, enhedspris_oere: 47500, brutto_oere: 570000, rabat_oere: 0, linje_sum_oere: 570000, bekraeftet: true })).error);
      const g = await godkend(a, v2.id);
      const [gl] = await raekke('tilbud', 'id', T1.id, 'status, tilbudsnummer');
      const [ny] = await raekke('tilbud', 'id', v2.id, 'tilbudsnummer, erstatter_tilbudsnummer');
      if (!g.error && gl.status === 'erstattet' && ny.tilbudsnummer === 3 && ny.erstatter_tilbudsnummer === gl.tilbudsnummer)
        ok('version 2 fik nyt nummer (3) og erstatter version 1');
      else fejl(`ny version: ${JSON.stringify({ g: g.error && g.error.message, gl, ny })}`);
    }

    console.log('\nStartnummer (#7, A8):');
    await afvist('startnummer under det højeste brugte',
      () => admin.from('firma_profil').update({ tilbud_naeste_nummer: 2 }).eq('firm_id', a.firmId), 'startnummer_for_lavt');
    {
      const { error } = await admin.from('firma_profil').update({ tilbud_naeste_nummer: 1001 }).eq('firm_id', a.firmId);
      if (error) fejl(`startnummer 1001 afvist: ${error.message}`); else ok('startnummer 1001 accepteret');
    }

    console.log('\nKildekopien (A5):');
    {
      const T3 = await kladde(a, LA3);
      const { data: ref } = await admin.from('referater').insert({ firm_id: a.firmId, lead_id: LA3, indhold: 'Vi målte 45 m²' }).select('id').single();
      stop('kilde', (await admin.from('tilbud_kilder').insert({ tilbud_id: T3.id, firm_id: a.firmId, lead_id: LA3,
        referat_id: ref.id, nr: 1, kilde: 'optagelse', tekst_kopi: 'Vi målte 45 m²' })).error);
      stop('slet referat', (await admin.from('referater').delete().eq('id', ref.id)).error);
      const [k] = await raekke('tilbud_kilder', 'tilbud_id', T3.id, 'referat_id, lead_id, tekst_kopi');
      if (k && k.referat_id === null && k.lead_id === LA3 && k.tekst_kopi === 'Vi målte 45 m²') ok('slettet referat: koblingen nulstillet, kopien bevaret');
      else fejl(`kilde efter sletning: ${JSON.stringify(k)}`);
    }

    console.log('\nKlienten (authenticated):');
    {
      const { data: egne } = await a.klient.from('tilbud').select('id');
      const { data: fremmede } = await a.klient.from('tilbud').select('id').eq('firm_id', b.firmId);
      if ((egne || []).length >= 1 && (fremmede || []).length === 0) ok('A ser egne tilbud og ingen af B\'s');
      else fejl(`A ser ${JSON.stringify({ egne: (egne || []).length, fremmede: (fremmede || []).length })}`);
      const { data: hist } = await a.klient.from('tilbud_historik').select('id');
      if ((hist || []).length >= 1) ok('A kan læse sin egen historik'); else fejl('A kan ikke læse sin egen historik');
      await afvist('klienten indsætter en falsk historikpost',
        () => a.klient.from('tilbud_historik').insert({ tilbud_id: T1.id, firm_id: a.firmId, haendelse: 'accepteret', fra_status: 'godkendt', til_status: 'accepteret', kopi: {} }), '42501');
      await afvist('klienten læser tilbud_forslag', () => a.klient.from('tilbud_forslag').select('id'), '42501');
      await afvist('klienten sætter sit eget AI-loft',
        () => a.klient.from('firma_profil').update({ ai_maanedsloft_dkk: 99999 }).eq('firm_id', a.firmId), '42501');
      await afvist('klienten retter et tilbud', () => a.klient.from('tilbud').update({ titel: 'x' }).eq('id', T1.id), '42501');
      await afvist('klienten kalder godkend_tilbud', () => a.klient.rpc('godkend_tilbud', { p_tilbud: T1.id, p_firm: a.firmId }), '42501');
      await afvist('klienten kalder slet_firma', () => a.klient.rpc('slet_firma', { p_firm: b.firmId }), '42501');
      const { data: enh } = await a.klient.from('enheder').select('firm_id');
      if ((enh || []).every(e => e.firm_id === null || e.firm_id === a.firmId)) ok('A ser grundlisten og kun egne enheder');
      else fejl('A ser en anden virksomheds enheder');
    }

    console.log('\nSlettevejen (A1, #17):');
    await afvist('slet firma A direkte (godkendt tilbud og historik)',
      () => admin.from('firms').delete().eq('id', a.firmId), 'tilbud_laast');
  } catch (e) {
    fejl(`opsætningen stoppede: ${e.message}`);
  } finally {
    for (const t of [a, b]) {
      if (!t) continue;
      const { data, error } = await admin.rpc('slet_firma', { p_firm: t.firmId });
      if (error) fejl(`slet_firma(${t.navn}): ${error.message}`);
      else {
        const rest = (await raekke('tilbud', 'firm_id', t.firmId, 'id')).length + (await raekke('tilbud_historik', 'firm_id', t.firmId, 'id')).length;
        if (data === 1 && rest === 0) ok(`slet_firma(${t.navn}): firmaet, tilbud og historik er væk`);
        else fejl(`slet_firma(${t.navn}) gav ${data}, ${rest} rækker tilbage`);
      }
      await admin.auth.admin.deleteUser(t.userId);
    }
    console.log(`\n${bestaaet} bestået, ${fejlet} fejlet\n`);
    process.exit(fejlet ? 1 : 0);
  }
})();
