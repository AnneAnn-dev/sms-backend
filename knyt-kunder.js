/**
 * knyt-kunder.js — engangsscript: knyt eksisterende opgaver til kunder (D88 trin 1b).
 *
 * To trin, i denne rækkefølge:
 *   1. NUMRE: kunder oprettet i Kunder-fanen har deres nummer i `kunder.telefon`
 *      (tastet råt). Det lægges i `kunde_telefoner` gennem kundeNoegle() —
 *      samme normalisering som alt andet. Så finder trin 2 dem.
 *   2. OPGAVER: hver opgave uden kunde knyttes gennem knytKunde() i
 *      kundematch.js — samme funktion som /formular og /opret-opgave
 *      (betingelse 8). Nummeret er det indtastede (`leads.telefon`), ellers
 *      opkaldets (`calls.from_number`). Ældste opgave først, så kundens navn
 *      kommer fra den første henvendelse.
 *
 *   node knyt-kunder.js                       # TØRKØRSEL: tæller pr. regel, skriver intet
 *   node knyt-kunder.js --bekraeft            # skriver, og logger hver ændring
 *   node knyt-kunder.js --fortryd=<logfil>    # ruller en kørsel tilbage ud fra dens log
 *   ... --prod                                # KRÆVES, når .env peger på prod
 *
 * Kan køres igen: en opgave, der har en kunde, røres ikke, og et nummer, der
 * allerede ligger i `kunde_telefoner`, lægges ikke ind igen.
 *
 * LOGGEN (knyt-kunder-<ref>-<kørsels-id>.log, én JSON-linje pr. ændring)
 * indeholder kun id'er — ingen navne, numre eller adresser.
 *
 * Kræver i .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

'use strict';

require('dotenv').config({ quiet: true });
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { kundeNoegle } = require('./phone');
const { knytKunde } = require('./kundematch');

const PROD_REF = 'glymuxqtrbpeyzmflilf';
const URL      = process.env.SUPABASE_URL;
const SERVICE  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const args     = process.argv.slice(2);
const KENDTE   = ['--bekraeft', '--prod'];
const fortrydArg = args.find((a) => a.startsWith('--fortryd='));
const ukendte  = args.filter((a) => !KENDTE.includes(a) && a !== fortrydArg);
if (ukendte.length) {                                   // fail-closed: ingen tavse argumenter
  console.error(`FEJL: ukendt argument: ${ukendte.join(' ')}`);
  process.exit(1);
}
const BEKRAEFT = args.includes('--bekraeft');
const PROD_OK  = args.includes('--prod');
if (!URL || !SERVICE) {
  console.error('FEJL: SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY skal være sat i .env');
  process.exit(1);
}
const REF = (URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || '(ukendt)';
if (REF === PROD_REF && !PROD_OK) {
  console.error(`STOP: .env peger på PROD (${REF}). Tilføj --prod, hvis det er meningen.`);
  process.exit(1);
}
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

async function alle(byg) {                              // henter alle rækker, 1000 ad gangen
  const ud = [];
  for (let fra = 0; ; fra += 1000) {
    const { data, error } = await byg().range(fra, fra + 999);
    if (error) throw new Error(error.message);
    ud.push(...data);
    if (data.length < 1000) return ud;
  }
}

async function fortryd(fil) {
  const linjer = fs.readFileSync(fil, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  console.log(`Fortryder ${linjer.length} ændringer fra ${fil} (projekt ${REF})`);
  if (!BEKRAEFT) { console.log('TØRKØRSEL — tilføj --bekraeft for at rulle tilbage.'); return; }
  let opg = 0, kunder = 0, numre = 0;
  for (const l of linjer.filter((x) => x.type === 'opgave')) {
    const { data } = await admin.from('leads').update({ kunde_id: null }).eq('id', l.lead_id).eq('kunde_id', l.kunde_id).select('id');
    opg += (data || []).length;
  }
  for (const l of linjer.filter((x) => x.type === 'opgave' && x.ny)) {
    const { count } = await admin.from('leads').select('id', { count: 'exact', head: true }).eq('kunde_id', l.kunde_id);
    if (count === 0) {
      const { data } = await admin.from('kunder').delete().eq('id', l.kunde_id).select('id');
      kunder += (data || []).length;
    }
  }
  for (const l of linjer.filter((x) => x.type === 'nummer')) {
    const { data } = await admin.from('kunde_telefoner').delete().eq('id', l.id).select('id');
    numre += (data || []).length;
  }
  console.log(`Rullet tilbage: ${opg} opgaver uden kunde igen, ${kunder} kunder slettet, ${numre} numre fjernet.`);
}

(async () => {
  if (fortrydArg) { await fortryd(fortrydArg.slice('--fortryd='.length)); return; }

  const KOERSEL = Math.random().toString(36).slice(2, 8);
  const logfil = `knyt-kunder-${REF}-${KOERSEL}.log`;
  const log = (o) => { if (BEKRAEFT) fs.appendFileSync(logfil, JSON.stringify(o) + '\n'); };

  console.log('\n=== Knyt opgaver til kunder (D88 trin 1b) ===');
  console.log(`Projekt-ref : ${REF}${REF === PROD_REF ? '  ⚠️  PROD' : ''}`);
  console.log(`Tilstand    : ${BEKRAEFT ? 'SKRIVER — log: ' + logfil : 'TØRKØRSEL — intet skrives'}\n`);

  // Hvad findes allerede: firma|nummer → kunde
  const kendt = new Map();
  for (const r of await alle(() => admin.from('kunde_telefoner').select('firm_id, telefon, kunde_id'))) {
    kendt.set(`${r.firm_id}|${r.telefon}`, r.kunde_id);
  }

  // --- 1. Numre fra kunder.telefon ---------------------------------------------
  const t1 = { lagt_ind: 0, allerede: 0, ikke_nummer: 0, kollision: 0 };
  const kunder = await alle(() => admin.from('kunder').select('id, firm_id, telefon').not('telefon', 'is', null).is('arkiveret_at', null));
  for (const k of kunder) {
    const n = kundeNoegle(k.telefon);
    if (!n) { t1.ikke_nummer++; continue; }
    const ejer = kendt.get(`${k.firm_id}|${n}`);
    if (ejer === k.id) { t1.allerede++; continue; }
    if (ejer) { t1.kollision++; console.log(`  ⚠️  kollision: kunde ${k.id} har et nummer, kunde ${ejer} allerede har i samme firma — springes over`); continue; }
    kendt.set(`${k.firm_id}|${n}`, k.id);
    t1.lagt_ind++;
    if (BEKRAEFT) {
      const { data, error } = await admin.from('kunde_telefoner').insert({ firm_id: k.firm_id, kunde_id: k.id, telefon: n }).select('id').single();
      if (error) { console.log(`  ❌ nummer til kunde ${k.id}: ${error.code} ${error.message}`); t1.lagt_ind--; continue; }
      log({ type: 'nummer', id: data.id, kunde_id: k.id });
    }
  }
  console.log('Trin 1 — numre fra kunder.telefon:');
  console.log(`  lagt ind: ${t1.lagt_ind} · havde det i forvejen: ${t1.allerede} · ikke et nummer: ${t1.ikke_nummer} · kollision: ${t1.kollision}\n`);

  // --- 2. Opgaver uden kunde -----------------------------------------------------
  const t2 = { kendt_kunde: 0, ny_med_nummer: 0, ny_uden_nummer: 0, uaendret: 0, fejl: 0 };
  const opgaver = await alle(() => admin.from('leads')
    .select('id, firm_id, name, address, telefon, created_at, calls(from_number)')
    .is('kunde_id', null).not('firm_id', 'is', null).order('created_at', { ascending: true }));
  for (const o of opgaver) {
    const raa = o.telefon || (o.calls && o.calls.from_number) || null;
    const n = kundeNoegle(raa);
    if (!BEKRAEFT) {                                    // simulér samme regel som databasen
      if (!n) { t2.ny_uden_nummer++; continue; }
      const nøgle = `${o.firm_id}|${n}`;
      if (kendt.has(nøgle)) t2.kendt_kunde++;
      else { kendt.set(nøgle, 'ny'); t2.ny_med_nummer++; }
      continue;
    }
    const r = await knytKunde(admin, { firmId: o.firm_id, leadId: o.id, telefon: raa, navn: o.name, adresse: o.address }, { aktiv: true });
    if (r.status === 'kendt') t2.kendt_kunde++;
    else if (r.status === 'ny') r.medNummer ? t2.ny_med_nummer++ : t2.ny_uden_nummer++;
    else if (r.status === 'uaendret') t2.uaendret++;
    else t2.fejl++;
    if (r.status === 'ny' || r.status === 'kendt') log({ type: 'opgave', lead_id: o.id, kunde_id: r.kundeId, ny: r.ny });
  }
  console.log(`Trin 2 — ${opgaver.length} opgaver uden kunde:`);
  console.log(`  til kendt kunde: ${t2.kendt_kunde} · ny kunde med nummer: ${t2.ny_med_nummer} · ny kunde uden nummer: ${t2.ny_uden_nummer}` +
    (BEKRAEFT ? ` · uændret: ${t2.uaendret} · fejl: ${t2.fejl}` : ''));
  if (BEKRAEFT) console.log(`\nLog: ${logfil}  (fortryd: node knyt-kunder.js --fortryd=${logfil} --bekraeft)`);
  else console.log('\nTØRKØRSEL — kør med --bekraeft for at skrive.');
  console.log('');
  process.exit(BEKRAEFT && (t2.fejl || t1.kollision) ? 1 : 0);
})().catch((e) => { console.error('FEJL:', e.message); process.exit(1); });
