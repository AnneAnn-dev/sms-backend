#!/usr/bin/env node
/**
 * afstem-railway-env.js — READ-ONLY afstemning mellem Railway og en lokal .env-fil.
 *
 * Skrevet 2/8-26 til D16. Forlæg: afstem-numre.js.
 *
 * FORMÅL
 *   Produktionsvariabler tastes i dag manuelt BÅDE i Railway og i .env.prod.
 *   To kilder, ingen afstemning. Railway er sandheden; .env.prod er en kopi af
 *   ukendt friskhed — og lokale scripts læser den, når de kører mod prod.
 *   Dette script finder afvigelserne.
 *
 * SIKKERHEDSREGEL — den vigtigste linje i filen
 *   Scriptet udskriver ALDRIG variabelværdier. Kun navne og et match/mismatch-flag.
 *   Det udskriver heller ikke hashes: en hash af en laventropi-værdi (fx
 *   NODE_ENV=production) kan gættes, og så er det en lækage ad bagvejen.
 *   Railways egen hjælpetekst advarer: både --json og --kv indeholder rå værdier.
 *   Derfor fanges kommandoens output i en pipe og forlader aldrig processen.
 *
 * SKRIVER INTET. Rører hverken Railway, .env-filer eller databasen.
 *
 * BRUG
 *   node afstem-railway-env.js --environment production
 *   node afstem-railway-env.js --environment production --file .env.prod
 *   node afstem-railway-env.js --environment staging --file .env.staging
 *
 * FAIL-CLOSED
 *   --environment har ingen standardværdi og SKAL angives. Railway CLI's link
 *   arves bevidst ikke: linket kan pege ét sted, mens du tror du er et andet.
 *   Ukendte argumenter afvises. Ingen positionelle argumenter tillades.
 *
 * EXIT-KODER
 *   0 = ingen afvigelser
 *   1 = afvigelser fundet
 *   2 = fejl (forkert brug, CLI fejlede, fil mangler)
 */

'use strict';

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Variabler Railway sætter selv. De findes ikke i .env-filen og er ikke afvigelser.
const SYSTEM_PRAEFIKSER = ['RAILWAY_'];
const SYSTEM_NAVNE = ['PORT'];

// Kun disse tegn tillades i miljø- og servicenavne. Lukker for kommandoindsprøjtning,
// fordi vi er nødt til at køre via shell på Windows (railway er ofte en .cmd-shim).
const SIKKERT_NAVN = /^[A-Za-z0-9_-]+$/;

function doed(besked, kode = 2) {
  console.error('\nFEJL: ' + besked + '\n');
  process.exit(kode);
}

// ---------------------------------------------------------------------------
// 1. Argumenter — fail-closed
// ---------------------------------------------------------------------------

function parseArgumenter(argv) {
  const kendte = new Set(['--environment', '--service', '--file']);
  const ud = { environment: null, service: null, file: null };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      doed('Uventet argument "' + a + '". Kun --environment, --service og --file er tilladt.');
    }
    if (!kendte.has(a)) {
      doed('Ukendt flag "' + a + '". Tilladt: --environment, --service, --file.');
    }
    const vaerdi = argv[i + 1];
    if (vaerdi === undefined || vaerdi.startsWith('--')) {
      doed('Flaget "' + a + '" mangler en værdi.');
    }
    ud[a.slice(2)] = vaerdi;
    i++;
  }

  if (!ud.environment) {
    doed(
      'Du skal angive --environment eksplicit.\n' +
      '  Der er med vilje ingen standardværdi: Railway CLI\'s link kan pege på et\n' +
      '  andet miljø, end du tror. Scriptet arver det ikke.\n\n' +
      '  Eksempel: node afstem-railway-env.js --environment production'
    );
  }
  if (!SIKKERT_NAVN.test(ud.environment)) {
    doed('Ugyldigt miljønavn "' + ud.environment + '". Kun bogstaver, tal, _ og - er tilladt.');
  }
  if (ud.service && !SIKKERT_NAVN.test(ud.service)) {
    doed('Ugyldigt servicenavn "' + ud.service + '". Kun bogstaver, tal, _ og - er tilladt.');
  }
  if (!ud.file) ud.file = '.env.prod';

  return ud;
}

// ---------------------------------------------------------------------------
// 2. Læs .env-filen
// ---------------------------------------------------------------------------

function laesEnvFil(filsti) {
  if (!fs.existsSync(filsti)) {
    doed('Filen "' + filsti + '" findes ikke. Kørte du fra repo-roden?');
  }

  const raa = fs.readFileSync(filsti, 'utf8').replace(/^\uFEFF/, '');
  const linjer = raa.split(/\r?\n/);

  const vaerdier = new Map();
  const dubletter = [];
  const uparsede = [];
  const tomme = [];

  linjer.forEach((linje, idx) => {
    const linjenr = idx + 1;
    // Hele linjen trimmes — samme adfærd som dotenv. Foran-/efterstillede mellemrum
    // i filen forsvinder derfor også for appen, og tælles med rette IKKE som afvigelse.
    // "Afviger kun i mellemrum" fanger altså mellemrum på RAILWAY-siden.
    const trimmet = linje.trim();
    if (trimmet === '' || trimmet.startsWith('#')) return;

    const udenExport = trimmet.replace(/^export\s+/, '');
    const lighedstegn = udenExport.indexOf('=');
    if (lighedstegn < 1) {
      uparsede.push(linjenr);
      return;
    }

    const noegle = udenExport.slice(0, lighedstegn).trim();
    let vaerdi = udenExport.slice(lighedstegn + 1);

    // Fjern omsluttende anførselstegn, hvis de matcher
    const f = vaerdi[0];
    if ((f === '"' || f === "'") && vaerdi.length >= 2 && vaerdi[vaerdi.length - 1] === f) {
      vaerdi = vaerdi.slice(1, -1);
    }

    if (vaerdier.has(noegle)) dubletter.push({ noegle, linjenr });
    if (vaerdi.trim() === '') tomme.push(noegle);

    vaerdier.set(noegle, vaerdi);
  });

  return { vaerdier, dubletter, uparsede, tomme, antalLinjer: linjer.length };
}

// ---------------------------------------------------------------------------
// 3. Hent variabler fra Railway — output forlader aldrig processen
// ---------------------------------------------------------------------------

function hentFraRailway(environment, service) {
  const argumenter = ['variable', 'list', '--environment', environment, '--json'];
  if (service) argumenter.push('--service', service);

  const resultat = spawnSync('railway', argumenter, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    windowsHide: true,
  });

  if (resultat.error) {
    doed(
      'Kunne ikke køre "railway". Er CLI\'en installeret og på PATH?\n' +
      '  Tjek med: railway --version\n' +
      '  Detalje: ' + resultat.error.message
    );
  }
  if (resultat.status !== 0) {
    // stderr kan indeholde nyttige fejl, men aldrig værdier — status-fejl printer
    // ikke variabler. Vi viser den, men afkorter for en sikkerheds skyld.
    const fejl = (resultat.stderr || '').split(/\r?\n/).slice(0, 5).join('\n');
    doed(
      'railway variable list fejlede (exit ' + resultat.status + ').\n' +
      '  Tjek at miljønavnet "' + environment + '" findes, og at du er logget ind.\n' +
      '  CLI sagde:\n' + fejl
    );
  }

  const raa = resultat.stdout || '';

  // CLI'en skriver "New version available: ..." FØR JSON'en. Skær fra første { eller [.
  const startObjekt = raa.indexOf('{');
  const startArray = raa.indexOf('[');
  let start = -1;
  if (startObjekt === -1) start = startArray;
  else if (startArray === -1) start = startObjekt;
  else start = Math.min(startObjekt, startArray);

  if (start === -1) {
    doed('Fandt ingen JSON i svaret fra railway. Har din CLI-version --json?');
  }

  let data;
  try {
    data = JSON.parse(raa.slice(start));
  } catch (e) {
    doed('Kunne ikke fortolke JSON fra railway: ' + e.message);
  }

  // To mulige former: { NOEGLE: "vaerdi" } eller [ { name/key, value } ]
  const kort = new Map();
  if (Array.isArray(data)) {
    for (const post of data) {
      const noegle = post.name || post.key || post.Name;
      if (noegle) kort.set(String(noegle), String(post.value !== undefined ? post.value : ''));
    }
  } else if (data && typeof data === 'object') {
    for (const [noegle, vaerdi] of Object.entries(data)) {
      kort.set(noegle, vaerdi === null || vaerdi === undefined ? '' : String(vaerdi));
    }
  } else {
    doed('Uventet JSON-form fra railway.');
  }

  return kort;
}

// ---------------------------------------------------------------------------
// 4. Sammenlign — internt på hash, aldrig udskrevet
// ---------------------------------------------------------------------------

function hash(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function erSystemvariabel(noegle) {
  return SYSTEM_PRAEFIKSER.some((p) => noegle.startsWith(p)) || SYSTEM_NAVNE.includes(noegle);
}

function sammenlign(railway, fil) {
  const resultat = {
    ens: [],
    afviger: [],
    afvigerKunMellemrum: [],
    kunIRailway: [],
    kunIFil: [],
    system: [],
  };

  const alleNoegler = new Set([...railway.keys(), ...fil.keys()]);

  for (const noegle of [...alleNoegler].sort()) {
    if (erSystemvariabel(noegle)) {
      resultat.system.push(noegle);
      continue;
    }
    const iRailway = railway.has(noegle);
    const iFil = fil.has(noegle);

    if (iRailway && !iFil) {
      resultat.kunIRailway.push(noegle);
    } else if (!iRailway && iFil) {
      resultat.kunIFil.push(noegle);
    } else {
      const a = railway.get(noegle);
      const b = fil.get(noegle);
      if (hash(a) === hash(b)) {
        resultat.ens.push(noegle);
      } else if (hash(a.trim()) === hash(b.trim())) {
        resultat.afvigerKunMellemrum.push(noegle);
      } else {
        resultat.afviger.push(noegle);
      }
    }
  }

  return resultat;
}

// ---------------------------------------------------------------------------
// 5. Udskrift — navne og flag, aldrig værdier
// ---------------------------------------------------------------------------

function skrivListe(overskrift, noegler, forklaring) {
  if (noegler.length === 0) return;
  console.log('\n' + overskrift + ' (' + noegler.length + ')');
  if (forklaring) console.log('  ' + forklaring);
  for (const n of noegler) console.log('  - ' + n);
}

function main() {
  const args = parseArgumenter(process.argv.slice(2));
  const filsti = path.resolve(process.cwd(), args.file);

  console.log('');
  console.log('==========================================================');
  console.log('  AFSTEMNING RAILWAY <-> ' + args.file);
  console.log('  READ-ONLY. Skriver intet. Viser aldrig værdier.');
  console.log('==========================================================');
  console.log('  Miljø:      ' + args.environment + '   <-- LÆS DETTE');
  console.log('  Service:    ' + (args.service || '(linket service)'));
  console.log('  Fil:        ' + filsti);
  console.log('  Tidspunkt:  ' + new Date().toISOString());
  console.log('==========================================================');

  const fil = laesEnvFil(filsti);
  const railway = hentFraRailway(args.environment, args.service);
  const r = sammenlign(railway, fil.vaerdier);

  console.log('\nHENTET');
  console.log('  Railway:  ' + railway.size + ' variabler');
  console.log('  ' + args.file + ':  ' + fil.vaerdier.size + ' variabler');

  skrivListe(
    'AFVIGER — samme navn, forskellig værdi',
    r.afviger,
    'Railway er sandheden. Ret ' + args.file + ' til at matche.'
  );
  skrivListe(
    'AFVIGER KUN I MELLEMRUM',
    r.afvigerKunMellemrum,
    'Værdierne er ens bortset fra foran- eller efterstillede mellemrum.'
  );
  skrivListe(
    'KUN I RAILWAY',
    r.kunIRailway,
    'Mangler i ' + args.file + '. Lokale scripts vil køre uden dem.'
  );
  skrivListe(
    'KUN I ' + args.file.toUpperCase(),
    r.kunIFil,
    'Findes ikke i Railway. Efterladenskab, eller en variabel appen aldrig får.'
  );

  if (fil.dubletter.length) {
    console.log('\nDUBLETTER I ' + args.file + ' (' + fil.dubletter.length + ')');
    console.log('  Samme nøgle står flere gange. Den sidste vinder — det er sjældent med vilje.');
    for (const d of fil.dubletter) console.log('  - ' + d.noegle + ' (linje ' + d.linjenr + ')');
  }
  if (fil.tomme.length) {
    console.log('\nTOMME VÆRDIER I ' + args.file + ' (' + fil.tomme.length + ')');
    for (const n of fil.tomme) console.log('  - ' + n);
  }
  if (fil.uparsede.length) {
    console.log('\nLINJER DER IKKE KUNNE LÆSES (' + fil.uparsede.length + ')');
    console.log('  Linjenumre: ' + fil.uparsede.join(', '));
  }

  console.log('\n----------------------------------------------------------');
  console.log('  Ens:                  ' + r.ens.length);
  console.log('  Afviger:              ' + r.afviger.length);
  console.log('  Kun mellemrum:        ' + r.afvigerKunMellemrum.length);
  console.log('  Kun i Railway:        ' + r.kunIRailway.length);
  console.log('  Kun i filen:          ' + r.kunIFil.length);
  console.log('  Systemvariabler:      ' + r.system.length + ' (ignoreret)');
  console.log('----------------------------------------------------------');

  const antalProblemer =
    r.afviger.length + r.afvigerKunMellemrum.length + r.kunIRailway.length + r.kunIFil.length;

  if (antalProblemer === 0) {
    console.log('\nRESULTAT: ingen afvigelser. De to kilder er enige.\n');
    process.exit(0);
  }
  console.log('\nRESULTAT: ' + antalProblemer + ' afvigelser. Se listerne ovenfor.\n');
  process.exit(1);
}

main();
