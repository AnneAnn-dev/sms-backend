/**
 * rls-isolation-test.js — RLS-isolationstest for Dit Digitale Kontor
 *
 * Opretter to firmaer med hver sin bruger, seeder en række i hver tabel,
 * og verificerer tre ting:
 *
 *   1. LÆKAGE   — firma A må IKKE kunne læse firma B's rækker.
 *   2. ADGANG   — firma A SKAL kunne læse sine egne rækker.
 *   3. SKRIVELÅS — authenticated må IKKE kunne insert/update/delete
 *                  på de seks nye tabeller (skrivning er server-side).
 *
 * Punkt 2 er ikke pynt. Uden den ville en politik, der nægter ALT, bestå
 * testen med glans — og fejlen ville først vise sig som et tomt dashboard
 * hos en kunde.
 *
 * SIKKERHED
 *   Scriptet rører aldrig en række, det ikke selv har oprettet. Alt ryddes
 *   op i en finally-blok. Det printer projekt-ref og kræver --bekraeft,
 *   så en fejlkørsel mod prod kræver en bevidst handling.
 *
 * BRUG (PowerShell, fra repo-roden)
 *   node rls-isolation-test.js              # tørkørsel: viser mål, gør intet
 *   node rls-isolation-test.js --bekraeft   # kører testen
 *
 * Kræver i .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 * (den lokale .env peger på STAGING pr. beslutning 5/7-26.)
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

// Projekt-ref udledes af URL'en (https://<ref>.supabase.co) — samme
// identifikator som supabase\.temp\project-ref og browserens dashboard-URL.
const REF = (URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || '(ukendt)';

const kort = () => Math.random().toString(36).slice(2, 8);
const KOERSEL = kort();

// De seks nye tabeller. Skrivelåsen gælder præcis disse.
const NYE_TABELLER = ['kunder', 'referater', 'tilbud', 'tilbud_linjer', 'firma_profil', 'standardfelter'];

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

let bestaaet = 0;
let fejlet = 0;

function ok(besked)   { bestaaet++; console.log(`  ✅ ${besked}`); }
function fejl(besked) { fejlet++;   console.log(`  ❌ ${besked}`); }


/* ------------------------------------------------------------------ */
/* Opsætning                                                          */
/* ------------------------------------------------------------------ */

async function opretTenant(navn) {
  const email = `rls-test-${navn}-${KOERSEL}@example.invalid`;
  const password = `Rls!${kort()}${kort()}`;

  const { data: bruger, error: bFejl } = await admin.auth.admin.createUser({
    email, password, email_confirm: true
  });
  if (bFejl) throw new Error(`kunne ikke oprette bruger ${navn}: ${bFejl.message}`);

  const { data: firma, error: fFejl } = await admin.from('firms').insert({
    name: `RLS-test ${navn} ${KOERSEL}`,
    slug: `rls-test-${navn}-${KOERSEL}`,
    status: 'active',
    is_test: true
  }).select().single();
  if (fFejl) throw new Error(`kunne ikke oprette firma ${navn}: ${fFejl.message}`);

  const { error: kFejl } = await admin.from('firm_users').insert({
    firm_id: firma.id, user_id: bruger.user.id
  });
  if (kFejl) throw new Error(`kunne ikke koble bruger til firma ${navn}: ${kFejl.message}`);

  return { navn, email, password, firmId: firma.id, userId: bruger.user.id };
}

/** Seeder én række i hver relevant tabel. Returnerer id'erne. */
async function seed(t) {
  const id = {};

  const { data: kunde, error: e1 } = await admin.from('kunder').insert({
    firm_id: t.firmId, navn: `Kunde ${t.navn}`, telefon: `+4590${Math.floor(100000 + Math.random() * 899999)}`
  }).select().single();
  if (e1) throw new Error(`kunder (${t.navn}): ${e1.message}`);
  id.kunde = kunde.id;

  // Et opkald, så både den gamle (via calls) og den nye (via firm_id)
  // RLS-sti på leads bliver dækket.
  // to_number er NOT NULL — det er systemnummeret, kalderen ramte.
  const { data: call, error: e2 } = await admin.from('calls').insert({
    firm_id: t.firmId,
    from_number: '+4512345678',
    to_number: '+4599999999'   // bevidst ugyldigt testnummer
  }).select().single();
  if (e2) throw new Error(`calls (${t.navn}): ${e2.message}`);
  id.call = call.id;

  const { data: lead, error: e3 } = await admin.from('leads').insert({
    firm_id: t.firmId, kunde_id: kunde.id, call_id: call.id,
    name: `Lead ${t.navn}`, address: 'Testvej 1, 8000 Aarhus C', task: 'RLS-test'
  }).select().single();
  if (e3) throw new Error(`leads (${t.navn}): ${e3.message}`);
  id.lead = lead.id;

  const { data: ref, error: e4 } = await admin.from('referater').insert({
    firm_id: t.firmId, lead_id: lead.id, indhold: `Fortroligt referat for ${t.navn}`
  }).select().single();
  if (e4) throw new Error(`referater (${t.navn}): ${e4.message}`);
  id.referat = ref.id;

  const { data: tilbud, error: e5 } = await admin.from('tilbud').insert({
    firm_id: t.firmId, lead_id: lead.id, referat_id: ref.id, sum_ex_moms: 12345.67
  }).select().single();
  if (e5) throw new Error(`tilbud (${t.navn}): ${e5.message}`);
  id.tilbud = tilbud.id;

  const { data: linje, error: e6 } = await admin.from('tilbud_linjer').insert({
    firm_id: t.firmId, tilbud_id: tilbud.id, beskrivelse: 'Arbejdstimer', antal: 10, enhedspris: 550
  }).select().single();
  if (e6) throw new Error(`tilbud_linjer (${t.navn}): ${e6.message}`);
  id.linje = linje.id;

  const { error: e7 } = await admin.from('firma_profil').insert({
    firm_id: t.firmId, cvr: '12345678', timepris: 550
  });
  if (e7) throw new Error(`firma_profil (${t.navn}): ${e7.message}`);

  const { data: felt, error: e8 } = await admin.from('standardfelter').insert({
    firm_id: t.firmId, navn: 'Antal m² gulv', felttype: 'tal'
  }).select().single();
  if (e8) throw new Error(`standardfelter (${t.navn}): ${e8.message}`);
  id.felt = felt.id;

  return id;
}

async function logInd(t) {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email: t.email, password: t.password });
  if (error) throw new Error(`login fejlede for ${t.navn}: ${error.message}`);
  return c;
}


/* ------------------------------------------------------------------ */
/* Testene                                                            */
/* ------------------------------------------------------------------ */

/** 1+2: A ser sine egne rækker, og ingen af B's. */
async function testLaesning(klient, egen, fremmed) {
  const tabeller = [...NYE_TABELLER, 'leads'];

  for (const tabel of tabeller) {
    // Fremmed firma — skal give NUL rækker.
    const { data: fremmede, error: fFejl } = await klient
      .from(tabel).select('firm_id').eq('firm_id', fremmed.firmId);

    if (fFejl)                          fejl(`${tabel}: uventet fejl ved fremmed-opslag — ${fFejl.message}`);
    else if ((fremmede || []).length)   fejl(`${tabel}: LÆKAGE — ${fremmede.length} af ${fremmed.navn}s rækker synlige for ${egen.navn}`);
    else                                ok(`${tabel}: ingen af ${fremmed.navn}s rækker synlige`);

    // Egne rækker — SKAL være synlige, ellers er politikken for stram.
    const { data: egne, error: eFejl } = await klient
      .from(tabel).select('firm_id').eq('firm_id', egen.firmId);

    if (eFejl)                        fejl(`${tabel}: kan ikke læse egne rækker — ${eFejl.message}`);
    else if (!(egne || []).length)    fejl(`${tabel}: FOR STRAM — ${egen.navn} kan ikke se sine EGNE rækker`);
    else                              ok(`${tabel}: egne rækker synlige (${egne.length})`);
  }

  // Kontrol uden filter: et bredt select må aldrig hive fremmede rækker med.
  const { data: alle } = await klient.from('kunder').select('firm_id');
  const fremmedeRaekker = (alle || []).filter(r => r.firm_id === fremmed.firmId);
  if (fremmedeRaekker.length) fejl(`kunder: LÆKAGE ved ufiltreret select — ${fremmedeRaekker.length} fremmede rækker`);
  else                        ok('kunder: ufiltreret select lækker ikke');
}

/** 3: skrivning skal afvises for authenticated på de seks nye tabeller. */
async function testSkrivelaas(klient, egen, ider) {
  const forsoeg = [
    ['kunder',         () => klient.from('kunder').insert({ firm_id: egen.firmId, navn: 'Snydekunde' })],
    ['referater',      () => klient.from('referater').update({ indhold: 'ændret' }).eq('id', ider.referat)],
    ['tilbud',         () => klient.from('tilbud').update({ sum_ex_moms: 1 }).eq('id', ider.tilbud)],
    ['tilbud_linjer',  () => klient.from('tilbud_linjer').delete().eq('id', ider.linje)],
    ['firma_profil',   () => klient.from('firma_profil').update({ timepris: 1 }).eq('firm_id', egen.firmId)],
    ['standardfelter', () => klient.from('standardfelter').delete().eq('id', ider.felt)]
  ];

  for (const [tabel, kald] of forsoeg) {
    const { error } = await kald();
    if (error) ok(`${tabel}: skrivning afvist (${error.code || 'fejl'})`);
    else       fejl(`${tabel}: SKRIVNING TILLADT — authenticated kunne ændre data`);
  }

  // Efterkontrol: blev noget faktisk ændret? En stille no-op tæller også som bestået,
  // men en ændring uden fejlbesked er den værste variant.
  const { data: ref } = await admin.from('referater').select('indhold').eq('id', ider.referat).single();
  if (ref && ref.indhold === 'ændret') fejl('referater: rækken BLEV ændret — skrivelåsen holder ikke');
  else                                  ok('referater: indhold uændret efter forsøg');
}


/* ------------------------------------------------------------------ */
/* Oprydning                                                          */
/* ------------------------------------------------------------------ */

async function ryd(tenants) {
  for (const t of tenants) {
    if (!t) continue;
    // firms har ON DELETE CASCADE mod alle nye tabeller. calls ryddes
    // eksplicit, da dens kobling ikke er verificeret.
    await admin.from('calls').delete().eq('firm_id', t.firmId);
    await admin.from('firm_users').delete().eq('firm_id', t.firmId);
    await admin.from('firms').delete().eq('id', t.firmId);
    if (t.userId) await admin.auth.admin.deleteUser(t.userId);
    console.log(`  🧹 ryddet: ${t.navn}`);
  }
}


/* ------------------------------------------------------------------ */
/* Kørsel                                                             */
/* ------------------------------------------------------------------ */

(async () => {
  console.log('\n=== RLS-isolationstest ===');
  console.log(`Projekt-ref : ${REF}`);
  console.log(`URL         : ${URL}`);
  console.log(`Kørsels-id  : ${KOERSEL}\n`);

  if (!BEKRAEFT) {
    console.log('TØRKØRSEL — intet oprettet, intet slettet.');
    console.log('Tjek at projekt-ref ovenfor er STAGING (sammenlign med supabase\\.temp\\project-ref');
    console.log('og med dashboardets URL), og kør så igen med --bekraeft.\n');
    process.exit(0);
  }

  let a = null, b = null;
  try {
    console.log('Opsætning:');
    a = await opretTenant('a');
    b = await opretTenant('b');
    const iderA = await seed(a);
    await seed(b);
    console.log(`  ✅ to firmaer med data oprettet\n`);

    const klientA = await logInd(a);

    console.log(`Læsning — firma A mod firma B:`);
    await testLaesning(klientA, a, b);

    console.log(`\nSkrivelås — authenticated på de seks nye tabeller:`);
    await testSkrivelaas(klientA, a, iderA);

    // Omvendt retning: asymmetriske politikker er en klassisk fejl.
    const klientB = await logInd(b);
    console.log(`\nLæsning — firma B mod firma A (omvendt retning):`);
    await testLaesning(klientB, b, a);

  } catch (e) {
    fejlet++;
    console.log(`\n❌ AFBRUDT: ${e.message}`);
  } finally {
    console.log('\nOprydning:');
    await ryd([a, b]);
  }

  console.log(`\n=== Resultat: ${bestaaet} bestået, ${fejlet} fejlet ===\n`);
  process.exit(fejlet ? 1 : 0);
})();
