// adressevaelger.js — adresseforslag til ALLE felter, der skal have en dansk
// adresse (Fase 1d, 13/10-26).
// -----------------------------------------------------------------------------
// Flyttet ud af dashboard.html, saa dashboardets "Ny opgave" og Kunder-fanen
// (tilbud/index.html) bruger SAMME kode. Foer stod den kun i dashboardet, og
// Kunder-siden havde frie tekstfelter uden forslag.
//
// Global funktion initDawa({...}) — signaturen er uaendret fra dashboardet.
// Kalderen SKAL taale, at filen ikke er indlaest (offline, netfejl): tjek
// `typeof initDawa === 'function'` og fald tilbage til den manuelle vej.
//
// Uden afhaengigheder. parseAddress() bruges, hvis siden har den (dashboardet),
// ellers tages gadedelen som teksten foer foerste komma.
// -----------------------------------------------------------------------------

// ── Adresse-autocomplete (D77) ───────────────────────────────────────────
// 8/10-26: forslag hentes fra VORES eget endpoint (/api/adresse, adresse.js),
// som taler med Klimadatastyrelsens Adressevaelger. Adressen paa tjenesten og
// tokenen staar kun ét sted — paa serveren. Foer stod DAWA-adressen her, i
// kundeformularen og i vagten.
// Fail-open (4/10-26): svarer endpointet ikke, kaldes onNede én gang, og
// modalen viser sin reservevej. Proeven koeres med det samme, saa felterne er
// der fra start.
// Et forslag er et husnummer. Ved valg slaas postnr og by op paa id'et, og
// onSelect faar samme form som foer: { tekst, data: { postnr, postnrnavn } }.
function initDawa({ inputId, suggestionsId, onSelect, onType, fuldTekstIFelt, onNede }) {
  const inp = document.getElementById(inputId);
  const boks = document.getElementById(suggestionsId);
  let debounce = null, aktive = -1, forslag = [], nede = false;
  // Valgt vej (D77, 9/10-26): soeg videre inden for vejen (og postnr).
  let valgtVej = '', valgtPostnr = '';
  const meldNede = () => { if (nede) return; nede = true; skjul(); if (onNede) onNede(); };
  if (onNede) {
    (async () => {
      try { const r = await fetch('/api/adresse/status'); if (!r.ok) meldNede(); }
      catch (_) { meldNede(); }
    })();
  }
  const esc = t => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 
  inp.addEventListener('input', () => {
    if (onType) onType();
    aktive = -1;
    if (valgtVej && inp.value.indexOf(valgtVej) !== 0) { valgtVej = ''; valgtPostnr = ''; }
    const q = inp.value.trim();
    if (q.length < 2) { skjul(); return; }
    clearTimeout(debounce);
    debounce = setTimeout(() => hent(q), 200);
  });
 
  inp.addEventListener('keydown', e => {
    if (!forslag.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); aktive = Math.min(aktive+1, forslag.length-1); vis(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); aktive = Math.max(aktive-1, 0); vis(); }
    else if (e.key === 'Enter' && aktive >= 0) { e.preventDefault(); vaelg(forslag[aktive]); }
    else if (e.key === 'Escape') skjul();
  });
 
  document.addEventListener('click', e => { if (e.target !== inp && !boks.contains(e.target)) skjul(); });
 
  async function hent(q) {
    if (nede) return;
    try {
      const r = await fetch('/api/adresse/soeg?q=' + encodeURIComponent(q) + (valgtPostnr ? '&postnr=' + valgtPostnr : ''));
      if (!r.ok) { meldNede(); return; }
      const data = await r.json();
      if (!data || !Array.isArray(data.forslag)) { meldNede(); return; }
      if (inp.value.trim() !== q) return;   // svar paa en aeldre soegning
      forslag = data.forslag;
      vis();
    } catch (_) { meldNede(); }
  }
 
  function fremhæv(tekst, q) {
    const i = tekst.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return tekst;
    return tekst.slice(0,i) + '<strong>' + tekst.slice(i, i+q.length) + '</strong>' + tekst.slice(i+q.length);
  }
 
  function vis() {
    if (!forslag.length) { skjul(); return; }
    const q = inp.value.trim();
    boks.innerHTML = forslag.map((s,i) =>
      `<div data-i="${i}" style="padding:9px 14px;font-size:14px;cursor:pointer;border-bottom:1px solid #DDE4EC;${i===aktive?'background:#EAF2FB':''}">${fremhæv(esc(s.tekst), esc(q))}</div>`
    ).join('');
    boks.style.display = 'block';
    boks.querySelectorAll('div').forEach(el => {
      el.addEventListener('mousedown', e => { e.preventDefault(); vaelg(forslag[+el.dataset.i]); });
    });
  }
 
  async function vaelg(s) {
    skjul();
    if (s.type === 'vej') {
      // En vej er ikke en adresse: saet vejnavnet i feltet og vis husnumrene.
      valgtVej = s.vej; valgtPostnr = s.postnr || '';
      inp.value = s.vej + ' ';
      if (onType) onType();   // nulstil et evt. tidligere valg
      inp.focus();
      hent(s.vej);
      return;
    }
    inp.value = s.tekst;   // vis valget med det samme; opslaget finpudser bagefter
    try {
      const r = await fetch('/api/adresse/' + encodeURIComponent(s.id));
      // Har brugeren rettet i feltet, mens opslaget kørte, gælder valget ikke.
      if (inp.value !== s.tekst) return;
      // 404: tjenesten er oppe, men kunne ikke slå netop dette husnummer op
      // (set 8/10-26). Forslagets tekst slutter med "postnr by" fra samme
      // register — brug den frem for reservevejen.
      const d = r.ok ? await r.json() : (r.status === 404 ? fraTekst(s.tekst) : null);
      if (!d || !d.postnr) { meldNede(); return; }
      // Modaler med SYNLIGE postnr/by-felter faar kun gadedelen i gadefeltet
      // (ellers dubletter); modaler med skjulte felter (Ny opgave) viser hele
      // adressen — et felt med "Barakstien 4" uden by skaber tvivl.
      inp.value = fuldTekstIFelt ? d.tekst
        : (d.vej || (typeof parseAddress === 'function' ? parseAddress(d.tekst).street : String(d.tekst).split(',')[0]));
      if (onSelect) onSelect({ tekst: d.tekst, data: { postnr: d.postnr, postnrnavn: d.by } });
    } catch (_) { meldNede(); }
  }
 
  // "Vej 1, [Suppl. by,] 2630 Taastrup" -> { tekst, vej, postnr, by }, ellers null.
  function fraTekst(t) {
    const dele = String(t || '').split(',').map(x => x.trim()).filter(Boolean);
    const m = /^([0-9]{4})\s+(.+)$/.exec(dele[dele.length - 1] || '');
    if (!m || dele.length < 2) return null;
    return { tekst: dele.join(', '), vej: dele.slice(0, -1).join(', '), postnr: m[1], by: m[2] };
  }

  function skjul() { boks.style.display = 'none'; forslag = []; aktive = -1; }
}
 
