/**
 * reset-test-data.js
 * -----------------------------------------------------------------------------
 * Rydder ALLE testdata i Supabase, så databasen er ren før en ny testkørsel.
 *
 * Sletter i korrekt FK-rækkefølge:
 *   messages → lead_images → leads → calls → firm_whitelist → firm_users
 *   → frisbii_webhook_events → firms
 * Frigør derefter ALLE pulje-numre (phone_numbers: firm_id = null, og nulstiller
 * karantæne-kolonnerne quarantined_until + last_firm_id fra Byggetrin 6) — men
 * BEHOLDER selve pulje-rækkerne, så numrene kan genbruges. Sletter til sidst de
 * Auth-brugere, der var koblet til firmaerne (firm_users.user_id).
 *
 * Rydder IKKE: hilsen-lydfiler i Storage (forældreløse filer er ufarlige) og
 * abonnementer i Frisbii — de lever videre dér, og deres fremtidige events
 * logges som "Intet firma ... ignorerer" (korrekt opførsel).
 *
 * Systemnummeret røres ALDRIG: det ligger ikke i phone_numbers-puljen, og scriptet
 * rører kun puljen + firma-tabellerne.
 *
 * BRUG ALTID --dry-run FØRST — så ser du, hvad der ville blive slettet, uden at
 * noget røres:
 *   node reset-test-data.js --dry-run
 *
 * Kør den for alvor (beder om bekræftelse):
 *   node reset-test-data.js
 *
 * Spring bekræftelsen over (fx i scripts):
 *   node reset-test-data.js --yes
 *
 * Påkrævede env vars (i .env):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * ⚠️  Dette er uigenkaldeligt. Beregnet til et testmiljø UDEN ægte firmaer.
 * -----------------------------------------------------------------------------
 */

require('dotenv').config();

const readline = require('readline');
const { createClient } = require('@supabase/supabase-js');

// Sletterækkefølge: børn før forældre (så fremmednøgler ikke spænder ben).
// Hvert trin har en kolonne, der altid findes på tabellen, til "match alle rækker".
const DELETE_STEPS = [
  { table: 'messages',      col: 'id' },  // SMS-historik — FK mod calls/firms, saa foerst
  { table: 'lead_images',   col: 'id' },
  { table: 'leads',         col: 'id' },
  { table: 'calls',         col: 'id' },
  { table: 'firm_whitelist',col: 'firm_id' },
  { table: 'firm_users',    col: 'firm_id' },
  { table: 'frisbii_webhook_events', col: 'id' },  // Byggetrin 6 — event-bogholderiet nulstilles ogsaa
];

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = true;
  }
  return args;
}

function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`\n❌ Manglende env vars: ${missing.join(', ')}\n`);
    process.exit(1);
  }
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^(j|ja|y|yes)$/i.test(answer.trim()));
    });
  });
}

// Antal rækker i en tabel (head=true henter ingen data, kun count).
async function countRows(supabase, table, filter) {
  let q = supabase.from(table).select('*', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count || 0;
}

async function main() {
  const args = parseArgs(process.argv);
  requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  console.log('\n🧹 Oprydning af testdata\n');

  // ── 1) Optælling FØR (så du ser præcis hvad der røres) ──────────────────────
  let firms, counts, claimedNumbers, totalNumbers, ownerUserIds;
  try {
    const { data: firmRows, error: firmErr } = await supabase
      .from('firms').select('id, name, email, status').order('name');
    if (firmErr) throw new Error(`firms: ${firmErr.message}`);
    firms = firmRows || [];

    counts = {};
    for (const step of DELETE_STEPS) counts[step.table] = await countRows(supabase, step.table);

    totalNumbers   = await countRows(supabase, 'phone_numbers');
    claimedNumbers = await countRows(supabase, 'phone_numbers', (q) => q.not('firm_id', 'is', null));

    // Auth-brugere koblet til firmaer (slettes til sidst).
    const { data: fu, error: fuErr } = await supabase.from('firm_users').select('user_id');
    if (fuErr) throw new Error(`firm_users: ${fuErr.message}`);
    ownerUserIds = [...new Set((fu || []).map((r) => r.user_id).filter(Boolean))];
  } catch (err) {
    console.error('❌ Kunne ikke læse status fra databasen:', err.message);
    process.exit(1);
  }

  console.log('────────────────────────────────────────────────────────');
  console.log('NUVÆRENDE TESTDATA:');
  console.log('────────────────────────────────────────────────────────');
  if (firms.length) {
    firms.forEach((f) => console.log(`  • ${f.name}  <${f.email}>  [${f.status}]`));
  } else {
    console.log('  (ingen firmaer)');
  }
  console.log('────────────────────────────────────────────────────────');
  for (const step of DELETE_STEPS) console.log(`  ${step.table.padEnd(16)} ${counts[step.table]} rækker`);
  console.log(`  firms            ${firms.length} rækker`);
  console.log(`  Auth-brugere     ${ownerUserIds.length} (koblet til firmaer)`);
  console.log(`  Pulje-numre      ${claimedNumbers} optaget / ${totalNumbers} i alt → alle frigøres`);
  console.log('────────────────────────────────────────────────────────');
  console.log('Systemnummeret ligger ikke i puljen og røres IKKE.');
  console.log('Pulje-rækkerne beholdes — kun firm_id nulstilles, så numrene kan genbruges.');
  console.log('────────────────────────────────────────────────────────');

  if (args['dry-run']) {
    console.log('\n🔍 Tør kørsel (--dry-run) — INTET slettet. Afslutter.\n');
    process.exit(0);
  }

  if (firms.length === 0 && Object.values(counts).every((c) => c === 0) && claimedNumbers === 0) {
    console.log('\n✓ Allerede rent — intet at gøre.\n');
    process.exit(0);
  }

  if (!args.yes) {
    const ok = await confirm('\n⚠️  Slet ALT ovenstående permanent? (j/N) ');
    if (!ok) {
      console.log('\n⏹  Afbrudt — intet slettet.\n');
      process.exit(0);
    }
  }
  console.log('');

  // ── 2) Slet i FK-rækkefølge ─────────────────────────────────────────────────
  for (const step of DELETE_STEPS) {
    process.stdout.write(`Sletter ${step.table} … `);
    const { error } = await supabase.from(step.table).delete().not(step.col, 'is', null);
    if (error) {
      console.log('❌');
      console.error(`\nFejl ved ${step.table}: ${error.message}`);
      console.error('Stopper her — ryd resten manuelt i SQL-editoren, så intet efterlades halvt.\n');
      process.exit(1);
    }
    console.log('✓');
  }

  // ── 3) Frigør alle pulje-numre (behold rækkerne) ────────────────────────────
  // Nulstiller ogsaa karantaene-kolonnerne (Byggetrin 6): et nummer i 30-dages
  // karantaene ville ellers FORBLIVE utilgaengeligt efter en "fuld" oprydning,
  // og last_firm_id ville pege paa firmaer, der slettes om et oejeblik.
  process.stdout.write('Frigør pulje-numre (inkl. karantæne) … ');
  {
    const { error } = await supabase
      .from('phone_numbers')
      .update({ firm_id: null, quarantined_until: null, last_firm_id: null })
      .or('firm_id.not.is.null,quarantined_until.not.is.null,last_firm_id.not.is.null');
    if (error) { console.log('❌'); console.error(`\nFejl: ${error.message}\n`); process.exit(1); }
    console.log('✓');
  }

  // ── 4) Slet firmaerne ───────────────────────────────────────────────────────
  process.stdout.write('Sletter firms … ');
  {
    const { error } = await supabase.from('firms').delete().not('id', 'is', null);
    if (error) { console.log('❌'); console.error(`\nFejl: ${error.message}\n`); process.exit(1); }
    console.log('✓');
  }

  // ── 5) Slet Auth-brugere koblet til firmaerne ───────────────────────────────
  let deletedUsers = 0;
  for (const uid of ownerUserIds) {
    const { error } = await supabase.auth.admin.deleteUser(uid);
    if (error) console.warn(`  ⚠️  Kunne ikke slette Auth-bruger ${uid}: ${error.message}`);
    else deletedUsers++;
  }

  console.log('\n────────────────────────────────────────────────────────');
  console.log('✅ OPRYDNING FÆRDIG');
  console.log('────────────────────────────────────────────────────────');
  console.log(`Auth-brugere slettet: ${deletedUsers}/${ownerUserIds.length}`);
  console.log(`Pulje-numre frigjort: ${claimedNumbers} (alle igen ledige)`);
  console.log('');
  console.log('Skulle der ligge forældreløse Auth-brugere tilbage (fx fra afbrudt');
  console.log('onboarding), så ryd dem i Supabase → Authentication → Users.');
  console.log('────────────────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('\n❌ Uventet fejl:', err.message, '\n');
  process.exit(1);
});
