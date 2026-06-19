/**
 * provision-test-firm.js
 * -----------------------------------------------------------------------------
 * Provisionerer et TESTFIRMA uden onboarding/Frisbii. Replikerer samme slutstand
 * som invoice_settled-webhooken + verifikation, så testfirmaet opfører sig som et
 * fuldt onboardet, verificeret og aktivt firma.
 *
 * Afstemt 1:1 mod onboarding.js:
 *   - claimer nummer fra phone_numbers-puljen (firm_id null = ledigt)
 *   - genbruger din egen ./tts renderGreeting (samme bucket/format som rigtige firmaer)
 *   - firm_users.role = "owner"
 *   - magic link → {BASE_URL}/onboarding (samme som onboarding-mailen)
 *
 * Sætter firmaet til verification_status "verified" + status "active" med det
 * samme, så ENHVER der ringer rammer det ægte kundeflow (form-SMS). /opkald gater
 * kun på billing_status, derfor sættes den til "active".
 *
 * Brug:
 *   node provision-test-firm.js \
 *     --name "Test VVS ApS" \
 *     --email tester@example.dk \
 *     --phone +4512345678 \
 *     --voice male
 *
 * Valgfrit:
 *   --number +4538000000   (claim et BESTEMT ledigt puljenummer; ellers første ledige)
 *   --greeting "Egen hilsentekst"
 *   --slug test-vvs
 *
 * Påkrævede env vars (i .env):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   + hvad ./tts og magic link kræver: ELEVENLABS_API_KEY, BASE_URL
 *
 * Forudsætning: mindst ét ledigt nummer i phone_numbers-puljen.
 * (Ellers kør buy-numbers.js / configure-number.js først.)
 *
 * BEMÆRK: ejerens nummer whitelistes IKKE — så testopkald bliver til ægte leads.
 * Lad en BEKENDT ringe (ikke et whitelistet nummer), ellers bypasses lead-flowet.
 * -----------------------------------------------------------------------------
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { renderGreeting } = require('./tts');

/* =============================================================================
 * CONFIG
 * =========================================================================== */
const CONFIG = {
  FIRMS_TABLE: 'firms',
  FIRM_USERS_TABLE: 'firm_users',

  // Pulje (jf. configure-number.js / onboarding.js)
  POOL_TABLE: 'phone_numbers',
  COL_POOL_NUMBER: 'number',
  COL_POOL_FIRM_ID: 'firm_id',

  // Slutstand — bekræftet mod onboarding.js
  FIRM_STATUS_VALUE: 'active',          // onboarding sætter "active" efter verifikation
  FIRM_VERIFICATION_VALUE: 'verified',  // "verified" => ægte kundeflow ved opkald
  FIRM_BILLING_VALUE: 'active',         // /opkald gater KUN på denne
  FU_ROLE_VALUE: 'owner',               // bekræftet: onboarding.js:142

  // Markér testdata. Sæt true EFTER:
  //   alter table public.firms add column is_test boolean not null default false;
  MARK_TEST: false,
  IS_TEST_COLUMN: 'is_test',

  // Magic link — bekræftet: onboarding redirecter til {BASE_URL}/onboarding
  VERIFY_PATH: '/onboarding',
};

/* =============================================================================
 * Hjælpere
 * =========================================================================== */

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i++; }
      else { args[key] = true; }
    }
  }
  return args;
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Samme ordlyd som onboarding.js (line 108), bare med firmanavnet indsat.
function defaultGreeting(firmName) {
  return `Hej, du har ringet til ${firmName}. Jeg har ikke mulighed for at ` +
    `tage telefonen lige nu, men jeg sender dig en SMS, så du kan beskrive din ` +
    `opgave. Jeg vender tilbage hurtigst muligt.`;
}

function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`\n❌ Manglende env vars: ${missing.join(', ')}\n`);
    process.exit(1);
  }
}

function fail(step, err) {
  console.error(`\n❌ Fejlede ved trin: ${step}`);
  console.error(err && err.message ? err.message : err);
  console.error(
    '\n⚠️  Provisionering ufuldstændig. Tjek hvad der nåede at blive oprettet ' +
    '(firma/pulje-claim/bruger) og ryd op før du kører igen.\n'
  );
  process.exit(1);
}

async function findUserByEmail(supabase, email) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  return data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}

async function findAvailableNumber(supabase, specificNumber) {
  let q = supabase
    .from(CONFIG.POOL_TABLE)
    .select(`id, ${CONFIG.COL_POOL_NUMBER}`)
    .is(CONFIG.COL_POOL_FIRM_ID, null);
  if (specificNumber) q = q.eq(CONFIG.COL_POOL_NUMBER, specificNumber);
  const { data, error } = await q.limit(1);
  if (error) throw error;
  if (!data || !data.length) {
    throw new Error(
      specificNumber
        ? `Nummeret ${specificNumber} er ikke ledigt i puljen.`
        : 'Ingen ledige numre i phone_numbers-puljen. Kør buy-numbers.js / configure-number.js først.'
    );
  }
  return data[0];
}

async function claimNumber(supabase, poolId, firmId) {
  const { data, error } = await supabase
    .from(CONFIG.POOL_TABLE)
    .update({ [CONFIG.COL_POOL_FIRM_ID]: firmId })
    .eq('id', poolId)
    .is(CONFIG.COL_POOL_FIRM_ID, null) // stadig ledigt?
    .select('id');
  if (error) throw error;
  if (!data || !data.length) throw new Error('Nummeret blev taget samtidig — prøv igen.');
}

/* =============================================================================
 * Main
 * =========================================================================== */

async function main() {
  const args = parseArgs(process.argv);

  requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);

  const name = args.name;
  const email = args.email;
  const phone = args.phone;
  const voice = (args.voice || 'female').toLowerCase();
  const specificNumber = typeof args.number === 'string' ? args.number : undefined;

  if (!name || !email || !phone) {
    console.error(
      '\nBrug: node provision-test-firm.js --name "Firma" --email x@y.dk ' +
      '--phone +45... --voice male [--number +45...]\n'
    );
    process.exit(1);
  }
  if (!['male', 'female'].includes(voice)) {
    fail('input', new Error('--voice skal være "male" eller "female".'));
  }

  const slug = args.slug ? slugify(args.slug) : slugify(name);
  const greetingText = args.greeting || defaultGreeting(name);

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  console.log(`\n🏗️  Provisionerer testfirma: ${name} (slug: ${slug})\n`);

  // 0a. Dublet-slug?
  {
    const { data: existing } = await supabase
      .from(CONFIG.FIRMS_TABLE).select('id').eq('slug', slug).maybeSingle();
    if (existing) fail('slug-tjek', new Error(`Firma med slug "${slug}" findes allerede.`));
  }

  // 0b. Ledigt nummer i puljen? (læs FØR vi opretter noget)
  console.log('0) Tjekker puljen for ledigt nummer …');
  let poolPick;
  try { poolPick = await findAvailableNumber(supabase, specificNumber); }
  catch (err) { fail('pulje-tjek', err); }
  const lommeNumber = poolPick[CONFIG.COL_POOL_NUMBER];
  console.log(`   ✓ Ledigt: ${lommeNumber}`);

  // 1. Opret firma (med nummer + verificeret/aktiv slutstand)
  console.log('1) Opretter firma i Supabase …');
  let firmId;
  try {
    const row = {
      name,
      slug,
      email,
      phone_number: lommeNumber,
      owner_phone: phone,
      voice_gender: voice,
      greeting_text: greetingText,
      status: CONFIG.FIRM_STATUS_VALUE,
      verification_status: CONFIG.FIRM_VERIFICATION_VALUE,
      billing_status: CONFIG.FIRM_BILLING_VALUE,
    };
    if (CONFIG.MARK_TEST) row[CONFIG.IS_TEST_COLUMN] = true;

    const { data, error } = await supabase
      .from(CONFIG.FIRMS_TABLE).insert(row).select('id').single();
    if (error) throw error;
    firmId = data.id;
  } catch (err) { fail('firma-oprettelse', err); }
  console.log(`   ✓ Firma-id: ${firmId}`);

  // 2. Claim nummeret fra puljen (sæt firm_id)
  console.log('2) Claimer nummer fra puljen …');
  try { await claimNumber(supabase, poolPick.id, firmId); }
  catch (err) { fail('pulje-claim', err); }
  console.log(`   ✓ ${lommeNumber} tildelt firmaet`);

  // 3. Render hilsen via din egen ./tts (best-effort; ellers Polly-fallback i /opkald)
  console.log('3) Renderer hilsen (./tts renderGreeting) …');
  try {
    const { url } = await renderGreeting(supabase, {
      firmId,
      text: greetingText,
      voiceGender: voice,
    });
    await supabase.from(CONFIG.FIRMS_TABLE)
      .update({ greeting_audio_url: url }).eq('id', firmId);
    console.log(`   ✓ Hilsen: ${url}`);
  } catch (err) {
    console.log(`   ⚠️  TTS fejlede (${err.message}) — firmaet bruger live Polly-fallback.`);
  }

  // 4. Auth-bruger (genbruger hvis e-mailen findes)
  console.log('4) Opretter/finder Supabase Auth-bruger …');
  let userId;
  try {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email, email_confirm: true, user_metadata: { firm_id: firmId, firm_name: name },
    });
    if (createErr) {
      const existing = await findUserByEmail(supabase, email);
      if (!existing) throw createErr;
      userId = existing.id;
      console.log('   ↺ Bruger fandtes allerede — genbruger');
    } else {
      userId = created.user.id;
    }
  } catch (err) { fail('auth-bruger', err); }
  console.log(`   ✓ Bruger-id: ${userId}`);

  // 5. firm_users-kobling (role "owner")
  console.log('5) Knytter bruger til firma …');
  try {
    const { error } = await supabase.from(CONFIG.FIRM_USERS_TABLE).insert({
      firm_id: firmId, user_id: userId, role: CONFIG.FU_ROLE_VALUE,
    });
    if (error) throw error;
  } catch (err) { fail('firm_users-kobling', err); }
  console.log('   ✓ Koblet');

  // 6. Magic link
  console.log('6) Genererer magic link …');
  let magicLink;
  try {
    const { data, error } = await supabase.auth.admin.generateLink({ type: 'magiclink', email });
    if (error) throw error;
    const tokenHash = data.properties.hashed_token;
    const appUrl = (process.env.DASHBOARD_URL || process.env.BASE_URL || '').replace(/\/$/, '');
    magicLink = `${appUrl}${CONFIG.VERIFY_PATH}?token_hash=${tokenHash}&type=magiclink`;
  } catch (err) { fail('magic link', err); }

  // Opsummering
  console.log('\n────────────────────────────────────────────────────────');
  console.log('✅ TESTFIRMA KLAR');
  console.log('────────────────────────────────────────────────────────');
  console.log(`Firma:        ${name}`);
  console.log(`Slug:         ${slug}`);
  console.log(`Firma-id:     ${firmId}`);
  console.log(`Ring til:     ${lommeNumber}`);
  console.log(`Ejer-tlf:     ${phone}`);
  console.log(`Login-email:  ${email}`);
  console.log('');
  console.log('Test-flow: lad en BEKENDT ringe til nummeret (ikke et whitelistet');
  console.log('nummer) → hilsen afspilles → kunde-SMS med opgave-link → udfyld →');
  console.log('leadet dukker op i dashboardet.');
  console.log('');
  console.log('🔑 Send denne magic link til testeren (login til dashboard):');
  console.log(magicLink);
  console.log('────────────────────────────────────────────────────────\n');
}

main().catch((err) => fail('uventet', err));
