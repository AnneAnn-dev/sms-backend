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
 *   --onboarding           (opret i ONBOARDING-tilstand: brugeren gennemgår selv
 *                           opsætningen via linket — sæt kode, stemme/besked,
 *                           viderestilling, verificér via opkald. --phone bliver
 *                           valgfri, da brugeren indtaster nummeret i trin 1.
 *                           UDEN flaget oprettes et færdigt verified+active firma.)
 *   --dry-run              (vis planen og afslut UDEN at oprette/binde noget)
 *   --yes                  (spring bekræftelses-prompten over)
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

const readline = require('readline');
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

// Ja/nej-prompt i terminalen. Returnerer true kun ved j/ja/y/yes.
function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^(j|ja|y|yes)$/i.test(answer.trim()));
    });
  });
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

  // --onboarding: opret firmaet i ONBOARDING-tilstand (som et frisk Frisbii-firma),
  // så linket lander brugeren i den rigtige onboarding (sæt kode → stemme/besked →
  // viderestilling → verificér via opkald). Uden flaget oprettes et færdigt,
  // verificeret+aktivt firma (test af opkald/lead-flow), som springer onboarding over.
  const onboardingMode = !!args.onboarding;

  // I onboarding-mode indtaster brugeren selv sit nummer i trin 1, så --phone er valgfri der.
  if (!name || !email || (!phone && !onboardingMode)) {
    console.error(
      '\nBrug: node provision-test-firm.js --name "Firma" --email x@y.dk ' +
      '--phone +45... --voice male [--number +45...] [--onboarding]\n' +
      '(--phone er valgfri sammen med --onboarding — brugeren indtaster det i trin 1.)\n'
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

  // ── Plan + bekræftelse (intet er oprettet/bundet endnu) ──────────────────
  console.log('\n────────────────────────────────────────────────────────');
  console.log('PLAN — følgende vil blive oprettet:');
  console.log('────────────────────────────────────────────────────────');
  console.log(`Firma:        ${name}  (slug: ${slug})`);
  console.log(`Claimer nr.:  ${lommeNumber}   ← bindes til firmaet`);
  console.log(`Login-email:  ${email}`);
  console.log(`Ejer-tlf:     ${phone || '(indtastes i onboarding trin 1)'}`);
  console.log(`Stemme:       ${voice}`);
  console.log(`Tilstand:     ${onboardingMode
    ? 'onboarding — brugeren gennemgår opsætningen (status=onboarding, pending)'
    : 'active — færdigt, verificeret firma (springer onboarding over)'}`);
  console.log(`Markér test:  ${CONFIG.MARK_TEST ? 'ja (is_test=true)' : 'nej'}`);
  console.log('────────────────────────────────────────────────────────');

  if (args['dry-run']) {
    console.log('\n🔍 Tør kørsel (--dry-run) — INTET oprettet eller bundet. Afslutter.\n');
    process.exit(0);
  }

  if (!args.yes) {
    const ok = await confirm('\nFortsæt og bind nummeret? (j/N) ');
    if (!ok) {
      console.log('\n⏹  Afbrudt — intet oprettet eller bundet.\n');
      process.exit(0);
    }
  }
  console.log('');

  // 1. Opret firma. Onboarding-mode spejler et frisk Frisbii-firma (status
  //    'onboarding'/'pending', ingen ejer-tlf, ingen forud-renderet hilsen);
  //    standard-mode opretter et færdigt verificeret+aktivt firma.
  console.log('1) Opretter firma i Supabase …');
  let firmId;
  try {
    const row = {
      name,
      slug,
      email,
      phone_number: lommeNumber,
      voice_gender: voice,
      greeting_text: greetingText,
      status: onboardingMode ? 'onboarding' : CONFIG.FIRM_STATUS_VALUE,
      verification_status: onboardingMode ? 'pending' : CONFIG.FIRM_VERIFICATION_VALUE,
      billing_status: CONFIG.FIRM_BILLING_VALUE, // /opkald gater KUN på denne — også i onboarding-mode
    };
    // Ejer-tlf: i onboarding-mode indtaster brugeren den selv i trin 1 (lad være null,
    // som hos et rigtigt Frisbii-firma). Er --phone alligevel givet, sætter vi den.
    if (phone) row.owner_phone = phone;
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

  // 3. Render hilsen. I onboarding-mode SPRINGES dette over — onboarding trin 2
  //    renderer hilsenen, når brugeren gemmer (præcis som et rigtigt Frisbii-firma,
  //    der har greeting_audio_url = null indtil trin 2). Indtil da bruger /opkald Polly.
  if (onboardingMode) {
    console.log('3) Springer hilsen-render over (renderes i onboarding trin 2) …');
  } else {
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

  // 5b. Ryd brugerens GAMLE koblinger fra tidligere testkørsler.
  //     Ellers hober de sig op, og /api/mig (som vælger ét firma) ser flere
  //     firmaer for samme bruger. Vi frigør de gamle firmaers numre (så puljen
  //     ikke lækker), fjerner koblingerne, og forsøger at slette de nu forældreløse
  //     firmaer (best-effort — har de opkald/leads hængende, lader vi dem stå med
  //     phone_number = null; kør reset-test-data.js for en fuld oprydning).
  try {
    const { data: oldLinks } = await supabase
      .from(CONFIG.FIRM_USERS_TABLE)
      .select('firm_id')
      .eq('user_id', userId)
      .neq('firm_id', firmId);
    const oldFirmIds = [...new Set((oldLinks || []).map((l) => l.firm_id).filter(Boolean))];

    if (oldFirmIds.length) {
      // Frigør de gamle numre, så de kan genbruges
      await supabase.from(CONFIG.POOL_TABLE)
        .update({ [CONFIG.COL_POOL_FIRM_ID]: null }).in('firm_id', oldFirmIds);
      // Fjern de gamle koblinger (så /api/mig kun ser det nye firma)
      await supabase.from(CONFIG.FIRM_USERS_TABLE)
        .delete().eq('user_id', userId).neq('firm_id', firmId);
      // Forsøg at slette de forældreløse firmaer
      const { error: delErr } = await supabase
        .from(CONFIG.FIRMS_TABLE).delete().in('id', oldFirmIds);
      if (delErr) {
        // Kunne ikke slettes (fx FK fra calls/leads) — nulstil i det mindste deres
        // nummer, så to firmaer ikke ender på samme nummer.
        await supabase.from(CONFIG.FIRMS_TABLE)
          .update({ phone_number: null }).in('id', oldFirmIds);
        console.log(`   ↺ ${oldFirmIds.length} gammelt firma frakoblet (ikke slettet — kør reset-test-data.js for fuld oprydning)`);
      } else {
        console.log(`   ↺ Ryddede ${oldFirmIds.length} gammelt testfirma for brugeren`);
      }
    }
  } catch (err) {
    // Oprydning er best-effort — en fejl her må ikke vælte selve provisioneringen.
    console.log(`   ⚠️  Kunne ikke rydde gamle koblinger (${err.message}) — kør evt. reset-test-data.js`);
  }

  // 6. Magic link
  console.log('6) Genererer magic link …');
  let magicLink;
  try {
    const { data, error } = await supabase.auth.admin.generateLink({ type: 'magiclink', email });
    if (error) throw error;
    const tokenHash = data.properties.hashed_token;
    const appUrl = (process.env.DASHBOARD_URL || process.env.BASE_URL || '').replace(/\/$/, '');
    // VIGTIGT: type=email (ikke magiclink). Selvom tokenet genereres med
    // generateLink({ type: "magiclink" }), forventer onboardingens verifyOtp
    // type=email for token_hash-links — præcis som frisbii-webhook.js og
    // onboarding-link.js. Med magiclink fejler verifyOtp, og brugeren kommer
    // aldrig forbi første skærm.
    magicLink = `${appUrl}${CONFIG.VERIFY_PATH}?token_hash=${tokenHash}&type=email`;
  } catch (err) { fail('magic link', err); }

  // Opsummering
  console.log('\n────────────────────────────────────────────────────────');
  console.log(onboardingMode ? '✅ TESTFIRMA KLAR (onboarding-mode)' : '✅ TESTFIRMA KLAR');
  console.log('────────────────────────────────────────────────────────');
  console.log(`Firma:        ${name}`);
  console.log(`Slug:         ${slug}`);
  console.log(`Firma-id:     ${firmId}`);
  console.log(`Ring til:     ${lommeNumber}`);
  console.log(`Ejer-tlf:     ${phone || '(indtastes i onboarding trin 1)'}`);
  console.log(`Login-email:  ${email}`);
  console.log('');

  if (onboardingMode) {
    console.log('Onboarding-test: åbn linket → trin 1: sæt adgangskode + ejer-tlf →');
    console.log('trin 2: vælg stemme + besked (hilsenen renderes nu) → trin 3:');
    console.log('viderestilling → trin 4: ring til nummeret FRA ejer-telefonen for at');
    console.log('verificere. Derefter er firmaet verified + active.');
    console.log('');
    console.log('Vil du bagefter teste lead-flowet, så lad en BEKENDT ringe (ikke');
    console.log('ejer-tlf/whitelistet nummer), så opkaldet bliver til et ægte lead.');
  } else {
    console.log('Test-flow: lad en BEKENDT ringe til nummeret (ikke et whitelistet');
    console.log('nummer) → hilsen afspilles → kunde-SMS med opgave-link → udfyld →');
    console.log('leadet dukker op i dashboardet.');
  }
  console.log('');
  console.log(onboardingMode
    ? '🔑 Send denne magic link til testeren (starter onboardingen):'
    : '🔑 Send denne magic link til testeren (login til dashboard):');
  console.log(magicLink);
  console.log('────────────────────────────────────────────────────────\n');
}

main().catch((err) => fail('uventet', err));
