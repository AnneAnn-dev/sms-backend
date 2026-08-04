/**
 * dump-storage.js — henter ALLE filer ud af et Supabase Storage-projekt
 * og skriver et manifest, der gør gendannelsen verificerbar.
 *
 * Dit Digitale Kontor. Skrevet 4/8-26 til gendannelsesøvelsen (D1).
 *
 * PRINCIPPER (ændr dem ikke uden at skrive hvorfor i runbogen):
 *
 *   1. Scriptet læser ALDRIG .env. Nøgler kommer fra sessionens miljøvariabler.
 *      Grunden er D16: .env.prod har kendte fejl, og et script der læser den
 *      kan tale med det forkerte projekt uden at sige noget.
 *
 *   2. Fail-closed. Uden --ref og --out kører den ikke. --ref sammenlignes med
 *      ref'en i URL'en; passer de ikke, stopper den.
 *
 *   3. --out har ingen standardværdi. Kundebilleder skal aldrig kunne havne
 *      i repoet ved et uheld.
 *
 *   4. To gennemløb: først listes alt (ingen disk berøres), så downloades.
 *      --dry-run stopper efter første gennemløb.
 *
 * BRUG (PowerShell, i repo-roden):
 *
 *   $env:DDK_SOURCE_URL = 'https://<ref>.supabase.co'
 *   $env:DDK_SOURCE_SERVICE_KEY = 'sb_secret_...'
 *   node dump-storage.js --ref <ref> --out "C:\Users\Bruger\ddk-gendannelse-2026-08-04\storage-backup" --dry-run
 *   node dump-storage.js --ref <ref> --out "C:\Users\Bruger\ddk-gendannelse-2026-08-04\storage-backup"
 *
 * Exit-koder: 0 = alt hentet og verificeret. 1 = afbrudt eller uoverensstemmelser fundet.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SIDESTOERRELSE = 100; // Supabase list() returnerer højst 100 ad gangen

// Tegn der ikke kan indgå i et filnavn på Windows.
const ULOVLIGE_TEGN = /[<>:"|?*\u0000-\u001f]/;

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
  // https://abcdefghijklm.supabase.co  ->  abcdefghijklm
  const m = String(url).match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  return m ? m[1] : null;
}

function menneskeStoerrelse(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function stiHarUlovligeTegn(objektsti) {
  return objektsti.split('/').some((del) => ULOVLIGE_TEGN.test(del));
}

// ---------------------------------------------------------------------------
// Argumenter og miljø — alt valideres, før noget som helst sker
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

const KENDTE_FLAG = ['--ref', '--out', '--dry-run'];
for (const arg of argv) {
  if (arg.startsWith('--') && !KENDTE_FLAG.includes(arg)) {
    afbryd('Ukendt argument: ' + arg + '. Kendte: ' + KENDTE_FLAG.join(', '));
  }
}

const dryRun = argv.includes('--dry-run');
const refArg = hentFlag(argv, '--ref');
const outArg = hentFlag(argv, '--out');

if (!refArg) {
  afbryd(
    '--ref mangler. Angiv projekt-ref\'en eksplicit, så der ikke er tvivl om, ' +
    'hvilket projekt der læses fra.\n' +
    'Eksempel: node dump-storage.js --ref abcdefghijklm --out "C:\\sti\\storage-backup" --dry-run'
  );
}

if (!outArg) {
  afbryd(
    '--out mangler. Angiv målmappen eksplicit. Der er med vilje ingen ' +
    'standardværdi: filerne indeholder kundedata og må aldrig havne i repoet.'
  );
}

const url = process.env.DDK_SOURCE_URL;
const noegle = process.env.DDK_SOURCE_SERVICE_KEY;

if (!url) {
  afbryd(
    'Miljøvariablen DDK_SOURCE_URL er ikke sat i denne session.\n' +
    "  $env:DDK_SOURCE_URL = 'https://<ref>.supabase.co'"
  );
}
if (!noegle) {
  afbryd(
    'Miljøvariablen DDK_SOURCE_SERVICE_KEY er ikke sat i denne session.\n' +
    "  $env:DDK_SOURCE_SERVICE_KEY = 'sb_secret_...'   (service_role/secret — hentes i dashboardet)"
  );
}

const urlRef = refFraUrl(url);
if (!urlRef) {
  afbryd(
    'DDK_SOURCE_URL ser ikke ud som en Supabase-projekt-URL: ' + url + '\n' +
    'Forventet form: https://<ref>.supabase.co'
  );
}

if (urlRef !== refArg) {
  afbryd(
    'Ref-uoverensstemmelse — dette er spærren, der forhindrer et forkert projekt.\n' +
    '  --ref siger:           ' + refArg + '\n' +
    '  DDK_SOURCE_URL siger:  ' + urlRef + '\n' +
    'Ret den ene, så de er enige, og kør igen.'
  );
}

const outDir = path.resolve(outArg);
const manifestSti = path.join(outDir, 'storage-manifest.json');

// ---------------------------------------------------------------------------
// Ekko — hvad taler vi med, før vi rører noget
// ---------------------------------------------------------------------------

console.log('');
console.log('=========================================================');
console.log('  dump-storage.js — Dit Digitale Kontor');
console.log('=========================================================');
console.log('  KILDE-PROJEKT : ' + urlRef);
console.log('  URL           : ' + url);
console.log('  NØGLE         : ' + noegle.slice(0, 12) + '... (' + noegle.length + ' tegn)');
console.log('  MÅLMAPPE      : ' + outDir);
console.log('  TILSTAND      : ' + (dryRun ? 'DRY-RUN (ingen filer hentes)' : 'DOWNLOAD'));
console.log('=========================================================');
console.log('');

const supabase = createClient(url, noegle, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Gennemløb 1 — list alt. Rører ikke disken.
// ---------------------------------------------------------------------------

async function listMappe(bucket, praefiks) {
  const fundne = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(praefiks, {
      limit: SIDESTOERRELSE,
      offset: offset,
      sortBy: { column: 'name', order: 'asc' },
    });

    if (error) {
      afbryd('Kunne ikke liste "' + bucket + '/' + praefiks + '": ' + error.message);
    }
    if (!data || data.length === 0) break;

    for (const post of data) {
      const fuldSti = praefiks ? praefiks + '/' + post.name : post.name;

      // En post uden id er en mappe, ikke en fil.
      if (post.id === null || post.id === undefined) {
        const under = await listMappe(bucket, fuldSti);
        fundne.push(...under);
      } else {
        fundne.push({
          sti: fuldSti,
          stoerrelse: (post.metadata && post.metadata.size) || 0,
          mimetype: (post.metadata && post.metadata.mimetype) || null,
          sidst_aendret: post.updated_at || null,
        });
      }
    }

    if (data.length < SIDESTOERRELSE) break;
    offset += SIDESTOERRELSE;
  }

  return fundne;
}

async function gennemloeb1() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    afbryd(
      'Kunne ikke hente bucket-listen: ' + error.message + '\n' +
      'Er nøglen en service_role/secret-nøgle? En publishable-nøgle rækker ikke.'
    );
  }
  if (!buckets || buckets.length === 0) {
    afbryd('Der blev ikke fundet nogen buckets. Det er ikke forventet — stop og undersøg.');
  }

  console.log('Gennemløb 1 af 2 — lister indhold (ingen filer hentes endnu)');
  console.log('');

  const resultat = [];

  for (const b of buckets) {
    process.stdout.write('  ' + b.name + ' ... ');
    const filer = await listMappe(b.name, '');
    const bytes = filer.reduce((sum, f) => sum + f.stoerrelse, 0);
    console.log(filer.length + ' filer, ' + menneskeStoerrelse(bytes));

    resultat.push({
      navn: b.name,
      offentlig: b.public === true,
      fil_stoerrelsesgraense: b.file_size_limit === undefined ? null : b.file_size_limit,
      tilladte_mimetyper: b.allowed_mime_types === undefined ? null : b.allowed_mime_types,
      oprettet: b.created_at || null,
      antal_filer: filer.length,
      bytes_i_alt: bytes,
      filer: filer,
    });
  }

  return resultat;
}

// ---------------------------------------------------------------------------
// Gennemløb 2 — download og verificér hver fil
// ---------------------------------------------------------------------------

async function gennemloeb2(buckets) {
  console.log('');
  console.log('Gennemløb 2 af 2 — henter filer');
  console.log('');

  const afvigelser = [];
  let hentet = 0;

  for (const b of buckets) {
    if (b.filer.length === 0) {
      console.log('  ' + b.navn + ': tom, springes over');
      continue;
    }

    console.log('  ' + b.navn + ': ' + b.filer.length + ' filer');

    for (const f of b.filer) {
      const maalSti = path.join(outDir, b.navn, ...f.sti.split('/'));

      fs.mkdirSync(path.dirname(maalSti), { recursive: true });

      const { data, error } = await supabase.storage.from(b.navn).download(f.sti);
      if (error) {
        afvigelser.push({
          bucket: b.navn,
          sti: f.sti,
          problem: 'download fejlede: ' + error.message,
        });
        console.log('      FEJL  ' + f.sti + ' — ' + error.message);
        continue;
      }

      const buffer = Buffer.from(await data.arrayBuffer());
      fs.writeFileSync(maalSti, buffer);

      const paaDisk = fs.statSync(maalSti).size;
      if (f.stoerrelse > 0 && paaDisk !== f.stoerrelse) {
        afvigelser.push({
          bucket: b.navn,
          sti: f.sti,
          problem:
            'størrelse afviger — Storage siger ' + f.stoerrelse +
            ' bytes, disken har ' + paaDisk,
        });
        console.log('      AFVIG ' + f.sti);
      }

      f.bytes_paa_disk = paaDisk;
      hentet++;

      if (hentet % 25 === 0) {
        console.log('      ... ' + hentet + ' filer hentet');
      }
    }
  }

  return { hentet, afvigelser };
}

// ---------------------------------------------------------------------------
// Hovedforløb
// ---------------------------------------------------------------------------

(async function main() {
  const buckets = await gennemloeb1();

  const antalIAlt = buckets.reduce((s, b) => s + b.antal_filer, 0);
  const bytesIAlt = buckets.reduce((s, b) => s + b.bytes_i_alt, 0);

  console.log('');
  console.log('  I ALT: ' + antalIAlt + ' filer, ' + menneskeStoerrelse(bytesIAlt));
  console.log('');

  // Stier der ikke kan skrives på Windows — find dem før vi henter noget
  const problematiske = [];
  for (const b of buckets) {
    for (const f of b.filer) {
      if (stiHarUlovligeTegn(f.sti)) {
        problematiske.push(b.navn + '/' + f.sti);
      }
    }
  }
  if (problematiske.length > 0) {
    console.error('Følgende stier indeholder tegn, Windows ikke tillader i filnavne:');
    problematiske.forEach((p) => console.error('  ' + p));
    afbryd(
      problematiske.length + ' sti(er) kan ikke skrives til disk. ' +
      'Stop og afklar, hvordan de skal håndteres — de må ikke bare mangle.'
    );
  }

  if (antalIAlt === 0) {
    afbryd('Der blev ikke fundet en eneste fil. Det er ikke forventet — stop og undersøg.');
  }

  let hentet = 0;
  let afvigelser = [];

  if (!dryRun) {
    fs.mkdirSync(outDir, { recursive: true });
    const r = await gennemloeb2(buckets);
    hentet = r.hentet;
    afvigelser = r.afvigelser;
  }

  // Manifestet — beviset. Skrives i begge tilstande.
  const manifest = {
    skrevet: new Date().toISOString(),
    kilde_ref: urlRef,
    kilde_url: url,
    tilstand: dryRun ? 'dry-run' : 'download',
    antal_filer_i_alt: antalIAlt,
    bytes_i_alt: bytesIAlt,
    antal_hentet: dryRun ? null : hentet,
    afvigelser: afvigelser,
    buckets: buckets.map((b) => ({
      navn: b.navn,
      offentlig: b.offentlig,
      fil_stoerrelsesgraense: b.fil_stoerrelsesgraense,
      tilladte_mimetyper: b.tilladte_mimetyper,
      oprettet: b.oprettet,
      antal_filer: b.antal_filer,
      bytes_i_alt: b.bytes_i_alt,
      filer: b.filer,
    })),
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(manifestSti, JSON.stringify(manifest, null, 2), 'utf8');

  console.log('');
  console.log('=========================================================');
  console.log('  Manifest skrevet: ' + manifestSti);
  console.log('');
  buckets.forEach((b) => {
    console.log(
      '  ' + b.navn.padEnd(24) +
      String(b.antal_filer).padStart(5) + ' filer   ' +
      menneskeStoerrelse(b.bytes_i_alt) +
      (b.offentlig ? '   [OFFENTLIG]' : '   [privat]')
    );
  });
  console.log('  ' + '-'.repeat(53));
  console.log('  ' + 'I ALT'.padEnd(24) + String(antalIAlt).padStart(5) + ' filer   ' + menneskeStoerrelse(bytesIAlt));
  console.log('=========================================================');

  if (dryRun) {
    console.log('');
    console.log('  DRY-RUN: ingen filer er hentet. Kør uden --dry-run for at hente dem.');
    console.log('');
    process.exit(0);
  }

  if (afvigelser.length > 0) {
    console.error('');
    console.error('  ' + afvigelser.length + ' AFVIGELSE(R) — udtrækket er IKKE komplet:');
    afvigelser.forEach((a) => console.error('    ' + a.bucket + '/' + a.sti + ': ' + a.problem));
    console.error('');
    console.error('  Løs dem, før du går videre til restore-storage.js.');
    console.error('');
    process.exit(1);
  }

  console.log('');
  console.log('  ' + hentet + ' af ' + antalIAlt + ' filer hentet og størrelsesverificeret. Ingen afvigelser.');
  console.log('');
  process.exit(0);
})().catch((e) => {
  afbryd('Uventet fejl: ' + (e && e.stack ? e.stack : e));
});
