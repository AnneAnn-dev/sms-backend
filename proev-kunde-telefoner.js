/**
 * proev-kunde-telefoner.js — beviser D88 trin 1a (migration
 * 20261018120000_kunde_telefoner.sql) mod STAGING.
 *
 * Kun databasen (plus ét PostgREST-embed): tabellen `kunde_telefoner`, RLS, de sammensatte
 * fremmednøgler og funktionen find_eller_opret_kunde(). Intet i serveren
 * kalder funktionen endnu (det er trin 1b), så der er ingen HTTP-del.
 *
 * Opretter to testfirmaer (A og B) med hver sin bruger. Rører aldrig andet;
 * alt ryddes op i finally. Telefonnumrene er opdigtede +4590…-numre med
 * kørsels-id'et i, så to kørsler ikke rammer hinanden.
 *
 *   node proev-kunde-telefoner.js              # tørkørsel: viser målet
 *   node proev-kunde-telefoner.js --bekraeft   # kører prøven
 *
 * Kræver i .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
 */

'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { kundeNoegle } = require('./phone');

const URL      = process.env.SUPABASE_URL;
const SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON     = process.env.SUPABASE_ANON_KEY;
const BEKRAEFT = process.argv.includes('--bekraeft');
const SAMTIDIGE = 20;

if (!URL || !SERVICE || !ANON) {
  console.error('FEJL: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY og SUPABASE_ANON_KEY skal være sat');
  process.exit(1);
}

const REF = (URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || '(ukendt)';
const kort = () => Math.random().toString(36).slice(2, 8);
const KOERSEL = kort();
const CIFRE = String(Math.floor(100000 + Math.random() * 900000));   // 6 cifre pr. kørsel
const nr = (i) => `+4590${CIFRE.slice(0, 5)}${i}`;                  // +4590XXXXXi — 8 cifre efter +45
const INGEN_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, INGEN_SESSION);

let bestaaet = 0, fejlet = 0;
const ok   = (b) => { bestaaet++; console.log(`  ✅ ${b}`); };
const fejl = (b) => { fejlet++;   console.log(`  ❌ ${b}`); };
const tjek = (betingelse, godt, skidt) => (betingelse ? ok(godt) : fejl(skidt || godt));

async function opretFirma(navn) {
  const email = `kundetlf-${navn}-${KOERSEL}@example.invalid`;
  const password = `Kt!${kort()}${kort()}`;
  const { data: b, error: bF } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (bF) throw new Error(`bruger ${navn}: ${bF.message}`);
  const t = { navn, userId: b.user.id };
  const { data: f, error: fF } = await admin.from('firms').insert({
    name: `Kundetelefon-prøve ${navn} ${KOERSEL}`, slug: `kundetlf-${navn}-${KOERSEL}`, status: 'active', is_test: true
  }).select('id').single();
  if (fF) throw new Error(`firma ${navn}: ${fF.message}`);
  t.firmId = f.id;
  const { error: kF } = await admin.from('firm_users').insert({ firm_id: t.firmId, user_id: t.userId });
  if (kF) throw new Error(`firm_users ${navn}: ${kF.message}`);
  t.klient = createClient(URL, ANON, INGEN_SESSION);
  const { error: lF } = await t.klient.auth.signInWithPassword({ email, password });
  if (lF) throw new Error(`login ${navn}: ${lF.message}`);
  return t;
}

async function findEllerOpret(firmId, telefon, navn, adresse) {
  const { data, error } = await admin.rpc('find_eller_opret_kunde', {
    p_firm: firmId, p_telefon: telefon, p_navn: navn, p_adresse: adresse,
  });
  if (error) throw new Error(`find_eller_opret_kunde: ${error.code} ${error.message}`);
  const raekke = Array.isArray(data) ? data[0] : data;
  if (!raekke || !raekke.kunde_id) throw new Error(`find_eller_opret_kunde gav intet: ${JSON.stringify(data)}`);
  return raekke;
}

const antal = async (tabel, felter) => {
  let q = admin.from(tabel).select('id', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(felter)) q = q.eq(k, v);
  const { count, error } = await q;
  if (error) throw new Error(`optælling ${tabel}: ${error.message}`);
  return count;
};

(async () => {
  console.log('\n=== Prøve: kunder kendes på telefonnummer (D88, trin 1a) ===');
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

    // --- Find eller opret ---------------------------------------------------
    console.log('Find eller opret:');
    const n1 = kundeNoegle(nr(1).replace('+45', '').replace(/(\d{2})/g, '$1 ').trim());  // tastet som "90 12 34 51"
    tjek(n1 === nr(1), `kundeNoegle bruges som nøgle: tastet form → ${n1}`);

    const r1 = await findEllerOpret(a.firmId, n1, 'Jens Prøve', 'Prøvevej 1, 3400 Hillerød');
    tjek(r1.ny === true, 'ukendt nummer → ny kunde (ny = true)');

    const r2 = await findEllerOpret(a.firmId, n1, 'En anden', 'Fremmedvej 9');
    tjek(r2.ny === false && r2.kunde_id === r1.kunde_id, 'kendt nummer → samme kunde (ny = false)');

    const { data: k1 } = await admin.from('kunder').select('navn, adresse').eq('id', r1.kunde_id).single();
    tjek(k1 && k1.navn === 'Jens Prøve' && k1.adresse === 'Prøvevej 1, 3400 Hillerød',
      'formulardata overskriver ikke kundens navn og adresse', `stamdata ændret: ${JSON.stringify(k1)}`);

    const rB = await findEllerOpret(b.firmId, n1, 'Jens hos B', null);
    tjek(rB.ny === true && rB.kunde_id !== r1.kunde_id, 'samme nummer i et ANDET firma → egen kunde');

    const u1 = await findEllerOpret(a.firmId, null, '', null);
    const u2 = await findEllerOpret(a.firmId, null, null, null);
    tjek(u1.ny && u2.ny && u1.kunde_id !== u2.kunde_id, 'intet nummer → ny kunde hver gang');
    const { data: uk } = await admin.from('kunder').select('navn').eq('id', u1.kunde_id).single();
    tjek(uk && uk.navn === 'Ukendt kunde', 'tomt navn bliver "Ukendt kunde"', `navn: ${JSON.stringify(uk)}`);

    await admin.from('kunder').update({ arkiveret_at: new Date().toISOString() }).eq('id', r1.kunde_id);
    const r3 = await findEllerOpret(a.firmId, n1, 'Jens igen', null);
    const { data: ejer } = await admin.from('kunde_telefoner').select('kunde_id').eq('firm_id', a.firmId).eq('telefon', n1);
    tjek(r3.ny && r3.kunde_id !== r1.kunde_id && ejer.length === 1 && ejer[0].kunde_id === r3.kunde_id,
      'nummer hos en ARKIVERET kunde → ny kunde, nummeret flyttet');

    // --- Samtidighed ---------------------------------------------------------
    console.log('\nSamtidighed:');
    const n9 = nr(9);
    const svar = await Promise.allSettled(
      Array.from({ length: SAMTIDIGE }, (_, i) => findEllerOpret(a.firmId, n9, `Samtidig ${i}`, null))
    );
    const afvist = svar.filter((s) => s.status === 'rejected');
    const ider = new Set(svar.filter((s) => s.status === 'fulfilled').map((s) => s.value.kunde_id));
    const nye = svar.filter((s) => s.status === 'fulfilled' && s.value.ny).length;
    const numre = await antal('kunde_telefoner', { firm_id: a.firmId, telefon: n9 });
    tjek(!afvist.length && ider.size === 1 && nye === 1 && numre === 1,
      `${SAMTIDIGE} samtidige kald med samme nye nummer → præcis én kunde og ét nummer`,
      `samtidighed: ${afvist.length} afvist, ${ider.size} kunde-id'er, ${nye} "ny", ${numre} nummerrækker` +
        (afvist.length ? ` — første fejl: ${afvist[0].reason.message}` : ''));

    // --- Databasens regler ---------------------------------------------------
    console.log('\nDatabasens regler:');
    const { error: fmt } = await admin.from('kunde_telefoner').insert({ firm_id: a.firmId, kunde_id: r3.kunde_id, telefon: 'Manuel oprettelse' });
    tjek(fmt && fmt.code === '23514', `"Manuel oprettelse" afvist af CHECK (${fmt ? fmt.code : 'ingen fejl'})`);

    const { error: dub } = await admin.from('kunde_telefoner').insert({ firm_id: a.firmId, kunde_id: u1.kunde_id, telefon: n1 });
    tjek(dub && dub.code === '23505', `samme nummer på to kunder i samme firma afvist (${dub ? dub.code : 'ingen fejl'})`);

    const { error: kryds1 } = await admin.from('kunde_telefoner').insert({ firm_id: b.firmId, kunde_id: r3.kunde_id, telefon: nr(7) });
    tjek(kryds1 && kryds1.code === '23503', `nummer på en kunde i et andet firma afvist (${kryds1 ? kryds1.code : 'ingen fejl'})`);

    const { error: kryds2 } = await admin.from('leads').insert({ name: 'x', address: 'y', task: 'z', firm_id: b.firmId, kunde_id: r3.kunde_id });
    tjek(kryds2 && kryds2.code === '23503', `opgave hos B med en kunde fra A afvist (${kryds2 ? kryds2.code : 'ingen fejl'})`);

    const { data: lead, error: lE } = await admin.from('leads')
      .insert({ name: 'Prøveopgave', address: 'Prøvevej 1', task: 'prøve', firm_id: a.firmId, kunde_id: r3.kunde_id })
      .select('id').single();
    if (lE) throw new Error(`opgave til sletteprøven: ${lE.message}`);
    await admin.from('kunder').delete().eq('id', r3.kunde_id);
    const { data: efter } = await admin.from('leads').select('firm_id, kunde_id').eq('id', lead.id).single();
    tjek(efter && efter.firm_id === a.firmId && efter.kunde_id === null,
      'kunde slettet → opgaven mister kunden, men beholder sit firma', `opgave efter sletning: ${JSON.stringify(efter)}`);
    tjek(await antal('kunde_telefoner', { kunde_id: r3.kunde_id }) === 0, 'kunde slettet → dens numre er væk');

    // --- PostgREST kan stadig embedde kunden fra en opgave -----------------------
    // 19/10: to fremmednøgler fra leads til kunder gjorde `kunder(navn)` tvetydigt,
    // og Kunder-fanen fejlede. Rettet i 20261019060000; dette tjek fanger det igen.
    console.log('\nPostgREST:');
    const { error: emb } = await admin.from('leads').select('id, kunder(navn)').eq('firm_id', a.firmId).limit(1);
    tjek(!emb, 'opgaver kan hente kundens navn med kunder(navn)', `kunder(navn) fejler: ${emb ? emb.code + ' ' + emb.message : ''}`);

    // --- Adgang (RLS og rettigheder) ------------------------------------------
    console.log('\nAdgang:');
    const { data: seA } = await a.klient.from('kunde_telefoner').select('firm_id, telefon');
    tjek((seA || []).length > 0 && seA.every((r) => r.firm_id === a.firmId),
      `A ser kun sine egne numre (${(seA || []).length} rækker)`, `A så: ${JSON.stringify(seA)}`);
    const { data: seB } = await b.klient.from('kunde_telefoner').select('firm_id');
    tjek((seB || []).every((r) => r.firm_id === b.firmId), `B ser ikke A's numre (${(seB || []).length} rækker)`);

    const { error: skriv } = await a.klient.from('kunde_telefoner').insert({ firm_id: a.firmId, kunde_id: u1.kunde_id, telefon: nr(8) });
    tjek(!!skriv && (await antal('kunde_telefoner', { firm_id: a.firmId, telefon: nr(8) })) === 0,
      `en bruger kan ikke selv skrive numre (${skriv ? skriv.code : 'ingen fejl'})`);

    const { error: rpcA } = await a.klient.rpc('find_eller_opret_kunde', { p_firm: a.firmId, p_telefon: nr(6), p_navn: 'x', p_adresse: null });
    tjek(!!rpcA && (await antal('kunde_telefoner', { firm_id: a.firmId, telefon: nr(6) })) === 0,
      `en bruger kan ikke kalde find_eller_opret_kunde (${rpcA ? rpcA.code : 'ingen fejl'})`);

    const anon = createClient(URL, ANON, INGEN_SESSION);
    const { data: seAnon } = await anon.from('kunde_telefoner').select('id');
    tjek(!(seAnon || []).length, 'anonym ser ingen numre');

  } catch (e) {
    fejl(`prøven stoppede: ${e.message}`);
  } finally {
    console.log('\nOprydning:');
    for (const t of [a, b]) {
      if (!t) continue;
      await admin.from('leads').delete().eq('firm_id', t.firmId);
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
