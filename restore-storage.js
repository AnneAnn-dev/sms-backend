/**
 * restore-storage.js — gendanner Storage-filer fra et dump til et MÅLPROJEKT
 * og verificerer bagefter, at antal filer pr. bucket stemmer med manifestet.
 *
 * Dit Digitale Kontor. Skrevet 4/8-26 til gendannelsesøvelsen (D1).
 * Modstykket til dump-storage.js.
 *
 * RÆKKEFØLGE — dette script er SIDSTE trin:
 *   skema -> auth-brugere -> data -> storage-metadata.sql -> DETTE SCRIPT
 * Buckets og objekt-rækker skal findes i målet, før filerne kan uploades.
 *
 * SPÆRRER (dette script SKRIVER — derfor tre lag):
 *
 *   1. Det nægter at skrive til kilden. Manifestet husker, hvilket projekt
 *      dumpet kom fra. Er målet den samme ref, stopper scriptet.
 *
 *   2. FORBUDTE_REFS i koden. Prod står der. Tilføj flere efter behov.
 *
 *   3. Alle filer verificeres på disken, FØR den første upload sker.
 *      Ingen halvt gennemførte gendannelser.
 *
 *   Som i dump-storage.js: .env læses aldrig, --ref skal matche URL'en,
 *   og --in har ingen standardværdi.
 *
 * BRUG (PowerShell, i repo-roden):
 *
 *   $env:DDK_TARGET_URL = 'https://<mål-ref>.supabase.co'
 *   $env:DDK_TARGET_SERVICE_KEY = 'sb_secret_...'
 *   node restore-storage.js --ref <mål-ref> --in "C:\Users\Bruger\ddk-gendannelse-2026-08-04\storage-backup" --dry-run
 *   node restore-storage.js --ref <mål-ref> --in "C:\Users\Bruger\ddk-gendannelse-2026-08-04\storage-backup"
 *
 * Exit-koder: 0 = alt uploadet OG verificeret mod manifestet. 1 = afbrudt eller uoverensstemmelser.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Projekter der ALDRIG må være mål for en gendannelse.
// Tilføj stagings ref her, hvis du vil spærre den også.
const FORBUDTE_REFS = [
  'glymuxqtrbpeyzmflilf', // ditdigitalekontor-prod
];

const SIDESTOERRELSE = 100;

// ---------------------------------------------------------------------------
// Hjælpere
// ---------------------------------------------------------------------------

function afbryd(besked) {
  console.error('');
  console.error('AFBRUDT: ' + besked);
  console.error('');
  process.exit(1);
}

function hentFlag(argv, navn) {
  const i = argv.indexOf(navn);
  if (i === -1) return null;
  const vaerdi = argv[i + 1];
  if (!vaerdi || vaerdi.startsWith('--')) {
    afbryd(navn + ' mangler en værdi.');
  }
  return vaerdi;
}

function refFraUrl(url) {
  const m = String(url).match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  return m ? m[1] : null;
}

function menneskeStoerrelse(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ---------------------------------------------------------------------------
// Argumenter og miljø
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

const KENDTE_FLAG = ['--ref', '--in', '--dry-run'];
for (const arg of argv) {
  if (arg.startsWith('--') && !KENDTE_FLAG.includes(arg)) {
    afbryd('Ukendt argument: ' + arg + '. Kendte: ' + KENDTE_FLAG.join(', '));
  }
}

const dryRun = argv.includes('--dry-run');
const refArg = hentFlag(argv, '--ref');
const inArg = hentFlag(argv, '--in');

if (!refArg) {
  afbryd(
    '--ref mangler. Angiv MÅL-projektets ref eksplicit.\n' +
    'Eksempel: node restore-storage.js --ref abcdefghijklm --in "C:\\sti\\storage-backup" --dry-run'
  );
}
if (!inArg) {
  afbryd('--in mangler. Angiv mappen med dumpet (den der indeholder storage-manifest.json).');
}

const url = process.env.DDK_TARGET_URL;
const noegle = process.env.DDK_TARGET_SERVICE_KEY;

if (!url) {
  afbryd(
    'Miljøvariablen DDK_TARGET_URL er ikke sat i denne session.\n' +
    "  $env:DDK_TARGET_URL = 'https://<mål-ref>.supabase.co'"
  );
}
if (!noegle) {
  afbryd(
    'Miljøvariablen DDK_TARGET_SERVICE_KEY er ikke sat i denne session.\n' +
    "  $env:DDK_TARGET_SERVICE_KEY = 'sb_secret_...'"
  );
}

const urlRef = refFraUrl(url);
if (!urlRef) {
  afbryd(
    'DDK_TARGET_URL ser ikke ud som en Supabase-projekt-URL: ' + url + '\n' +
    'Forventet form: https://<ref>.supabase.co'
  );
}
if (urlRef !== refArg) {
  afbryd(
    'Ref-uoverensstemmelse — spærren, der forhindrer et forkert projekt.\n' +
    '  --ref siger:           ' + refArg + '\n' +
    '  DDK_TARGET_URL siger:  ' + urlRef + '\n' +
    'Ret den ene, så de er enige, og kør igen.'
  );
}

// SPÆRRE 2 — forbudte mål
if (FORBUDTE_REFS.includes(urlRef)) {
  afbryd(
    'MÅLET ER SPÆRRET. Ref ' + urlRef + ' står i FORBUDTE_REFS øverst i dette script.\n' +
    'Det er et produktionsprojekt. En gendannelse skal ske til et isoleret mål.\n' +
    'Er spærren forkert, så ret listen bevidst — ikke i farten.'
  );
}

const inDir = path.resolve(inArg);
const manifestSti = path.join(inDir, 'storage-manifest.json');

if (!fs.existsSync(manifestSti)) {
  afbryd(
    'Fandt ikke storage-manifest.json i ' + inDir + '\n' +
    'Uden manifest er der ingen gendannelse — det er beviset for, hvad der skal være der.'
  );
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestSti, 'utf8'));
} catch (e) {
  afbryd('Kunne ikke læse storage-manifest.json: ' + e.message);
}

if (manifest.tilstand === 'dry-run') {
  afbryd(
    'Manifestet er skrevet under en DRY-RUN. Så er filerne aldrig hentet ned, ' +
    'og der er intet at uploade. Kør dump-storage.js uden --dry-run først.'
  );
}

// SPÆRRE 1 — må aldrig skrive tilbage til kilden
if (manifest.kilde_ref === urlRef) {
  afbryd(
    'MÅLET ER KILDEN. Manifestet blev skrevet fra ' + manifest.kilde_ref +
    ', og det er også målet nu.\n' +
    'En gendannelse oven i kilden er meningsløs i bedste fald og destruktiv i værste.'
  );
}

// ---------------------------------------------------------------------------
// Ekko
// ---------------------------------------------------------------------------

const forventetIAlt = manifest.antal_filer_i_alt;

console.log('');
console.log('=========================================================');
console.log('  restore-storage.js — Dit Digitale Kontor');
console.log('=========================================================');
console.log('  MÅL-PROJEKT   : ' + urlRef);
console.log('  URL           : ' + url);
console.log('  NØGLE         : ' + noegle.slice(0, 12) + '... (' + noegle.length + ' tegn)');
console.log('  DUMP FRA      : ' + inDir);
console.log('  KILDE-PROJEKT : ' + manifest.kilde_ref + '  (dumpet ' + manifest.skrevet + ')');
console.log('  FORVENTET     : ' + forventetIAlt + ' filer, ' + menneskeStoerrelse(manifest.bytes_i_alt));
console.log('  TILSTAND      : ' + (dryRun ? 'DRY-RUN (intet uploades)' : 'UPLOAD'));
console.log('=========================================================');
console.log('');

const supabase = createClient(url, noegle, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Trin 1 — findes filerne på disken, og er de hele?
// ---------------------------------------------------------------------------

function tjekDisken() {
  console.log('Trin 1 af 4 — verificerer dumpet på disken');

  const problemer = [];
  let fundne = 0;

  for (const b of manifest.buckets) {
    for (const f of b.filer) {
      const filSti = path.join(inDir, b.navn, ...f.sti.split('/'));

      if (!fs.existsSync(filSti)) {
        problemer.push(b.navn + '/' + f.sti + ': findes ikke på disken');
        continue;
      }
      const paaDisk = fs.statSync(filSti).size;
      if (f.stoerrelse > 0 && paaDisk !== f.stoerrelse) {
        problemer.push(
          b.navn + '/' + f.sti + ': manifestet siger ' + f.stoerrelse +
          ' bytes, disken har ' + paaDisk
        );
        continue;
      }
      fundne++;
    }
  }

  if (problemer.length > 0) {
    console.error('');
    problemer.forEach((p) => console.error('  ' + p));
    afbryd(
      problemer.length + ' problem(er) i dumpet. Der uploades intet, ' +
      'før dumpet er helt — en halv gendannelse er værre end ingen.'
    );
  }

  console.log('  ' + fundne + ' af ' + forventetIAlt + ' filer fundet og størrelsesverificeret på disken');
  console.log('');
}

// ---------------------------------------------------------------------------
// Trin 2 — findes bucketsene i målet? (storage-metadata.sql skal være kørt)
// ---------------------------------------------------------------------------

async function tjekBuckets() {
  console.log('Trin 2 af 4 — tjekker buckets i målprojektet');

  const { data: maalBuckets, error } = await supabase.storage.listBuckets();
  if (error) {
    afbryd(
      'Kunne ikke hente bucket-listen fra målet: ' + error.message + '\n' +
      'Er nøglen en service_role/secret-nøgle?'
    );
  }

  const maalNavne = (maalBuckets || []).map((b) => b.name);
  const mangler = [];

  for (const b of manifest.buckets) {
    if (!maalNavne.includes(b.navn)) {
      mangler.push(b.navn);
      continue;
    }
    const maalB = maalBuckets.find((x) => x.name === b.navn);
    const maalOffentlig = maalB.public === true;
    console.log(
      '  ' + b.navn.padEnd(24) +
      'findes' +
      (maalOffentlig === b.offentlig
        ? ''
        : '   ADVARSEL: offentlig=' + maalOffentlig + ' i målet, ' + b.offentlig + ' i kilden')
    );
  }

  if (mangler.length > 0) {
    afbryd(
      'Disse buckets findes ikke i målprojektet: ' + mangler.join(', ') + '\n' +
      'Kør storage-metadata.sql ind i målet FØR dette script. Rækkefølgen er:\n' +
      '  skema -> auth-brugere -> data -> storage-metadata.sql -> restore-storage.js'
    );
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Trin 3 — upload
// ---------------------------------------------------------------------------

async function upload() {
  console.log('Trin 3 af 4 — uploader filer');
  console.log('');

  const fejl = [];
  let uploadet = 0;

  for (const b of manifest.buckets) {
    if (b.filer.length === 0) {
      console.log('  ' + b.navn + ': tom i manifestet, springes over');
      continue;
    }

    console.log('  ' + b.navn + ': ' + b.filer.length + ' filer');

    for (const f of b.filer) {
      const filSti = path.join(inDir, b.navn, ...f.sti.split('/'));
      const indhold = fs.readFileSync(filSti);

      const { error } = await supabase.storage.from(b.navn).upload(f.sti, indhold, {
        contentType: f.mimetype || 'application/octet-stream',
        upsert: true, // rækken findes allerede fra storage-metadata.sql
      });

      if (error) {
        fejl.push({ bucket: b.navn, sti: f.sti, besked: error.message });
        console.log('      FEJL  ' + f.sti + ' — ' + error.message);
        continue;
      }

      uploadet++;
      if (uploadet % 25 === 0) {
        console.log('      ... ' + uploadet + ' filer uploadet');
      }
    }
  }

  console.log('');
  return { uploadet, fejl };
}

// ---------------------------------------------------------------------------
// Trin 4 — verifikation: tæl i målet og sammenlign med manifestet
// ---------------------------------------------------------------------------

async function tælIMaal(bucket, praefiks) {
  let antal = 0;
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(praefiks, {
      limit: SIDESTOERRELSE,
      offset: offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) {
      afbryd('Kunne ikke liste "' + bucket + '/' + praefiks + '" i målet: ' + error.message);
    }
    if (!data || data.length === 0) break;

    for (const post of data) {
      const fuldSti = praefiks ? praefiks + '/' + post.name : post.name;
      if (post.id === null || post.id === undefined) {
        antal += await tælIMaal(bucket, fuldSti);
      } else {
        antal++;
      }
    }

    if (data.length < SIDESTOERRELSE) break;
    offset += SIDESTOERRELSE;
  }

  return antal;
}

async function verificer() {
  console.log('Trin 4 af 4 — tæller i målprojektet og sammenligner med manifestet');
  console.log('');
  console.log('  BUCKET                    MANIFEST      MÅL   RESULTAT');
  console.log('  ' + '-'.repeat(55));

  let alleStemmer = true;

  for (const b of manifest.buckets) {
    const iMaal = await tælIMaal(b.navn, '');
    const stemmer = iMaal === b.antal_filer;
    if (!stemmer) alleStemmer = false;

    console.log(
      '  ' + b.navn.padEnd(24) +
      String(b.antal_filer).padStart(8) +
      String(iMaal).padStart(9) + '   ' +
      (stemmer ? 'OK' : 'AFVIGER')
    );
  }

  console.log('  ' + '-'.repeat(55));
  return alleStemmer;
}

// ---------------------------------------------------------------------------
// Hovedforløb
// ---------------------------------------------------------------------------

(async function main() {
  tjekDisken();
  await tjekBuckets();

  if (dryRun) {
    console.log('  DRY-RUN: dumpet er helt, og alle buckets findes i målet.');
    console.log('  Intet er uploadet. Kør uden --dry-run for at gendanne.');
    console.log('');
    process.exit(0);
  }

  const { uploadet, fejl } = await upload();
  const alleStemmer = await verificer();

  console.log('');
  console.log('=========================================================');
  console.log('  Uploadet: ' + uploadet + ' af ' + forventetIAlt + ' filer');
  if (fejl.length > 0) {
    console.log('  Fejl:     ' + fejl.length);
    fejl.forEach((f) => console.log('    ' + f.bucket + '/' + f.sti + ': ' + f.besked));
  }
  console.log('=========================================================');
  console.log('');

  if (fejl.length > 0 || !alleStemmer) {
    console.error('  ØVELSEN ER IKKE BESTÅET. Tallene stemmer ikke, eller der var fejl.');
    console.error('  Løs dem, og kør igen — scriptet kan køres flere gange (upsert).');
    console.error('');
    process.exit(1);
  }

  console.log('  Antal filer pr. bucket stemmer med manifestet.');
  console.log('');
  console.log('  TILBAGE MANUELT, før øvelsen er bestået:');
  console.log('    - Hent én lead-billedfil ned fra målet og ÅBN den (skal kunne vises)');
  console.log('    - Hent én greeting-lydfil ned fra målet og AFSPIL den');
  console.log('    - Notér bucket-politikkerne i runbogen (de følger ikke med)');
  console.log('    - Skriv dato og filantal i runbogen');
  console.log('    - Slet det midlertidige målprojekt');
  console.log('');
  process.exit(0);
})().catch((e) => {
  afbryd('Uventet fejl: ' + (e && e.stack ? e.stack : e));
});
