/* tilbud/tilbud.js — Tilbud på opgaven (Fase 5, spor 2, klient trin C1)
 * ---------------------------------------------------------------------------
 * ⚠️ OFFENTLIG FIL, som resten af tilbud/ (README.md, S17). Ingen nøgler, ingen
 * pris- eller kvotelogik: KLIENTEN REGNER INGENTING (kontrakten §0). Alle beløb
 * kommer fra serveren i heltal øre og vises, som de er.
 *
 * C1 (26/11-26): opgavens tilbud vises på opgaveskærmen under referaterne, et
 * nyt tilbud kan oprettes, og ét tilbud kan ses (kun læsning). Editoren (C2) og
 * forslaget (C3) bygges oven på denne fil.
 *
 * Tilbudsdelen er slukket, når ruterne ikke findes (TILBUDSDEL_AKTIV slukket
 * giver Express' egen 404 uden JSON) eller modulet mangler (403). Så vises
 * afsnittet slet ikke. "Opgaven findes ikke" (404 med kode) er en rigtig fejl
 * og vises.
 *
 * Bruger fra index.html: showScreen, escapeHtml, visFejl, skjulFejl, erLoggetUd.
 * Bruger fra graenseflade.js: Graenseflade.loadTilbud / opretTilbud / hentTilbud.
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  const G = () => window.Graenseflade;

  const STATUS = {
    kladde: 'Kladde', godkendt: 'Godkendt', sendt: 'Sendt', accepteret: 'Accepteret',
    erstattet: 'Erstattet', afvist: 'Afvist', udloebet: 'Udløbet',
  };

  // Øre (heltal) → "1.234,50 kr." Kun visning; der regnes ikke.
  function kr(oere) {
    if (oere === null || oere === undefined) return '';
    const n = Number(oere);
    if (!Number.isFinite(n)) return '';
    const neg = n < 0, a = Math.abs(n);
    const kroner = Math.trunc(a / 100), oe = a % 100;
    const tus = String(kroner).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '−' : '') + tus + ',' + String(oe).padStart(2, '0') + ' kr.';
  }
  // Antal er tekst med punktum fra serveren ("1.5") → "1,5".
  const antalTekst = (a) => (a === null || a === undefined ? '' : String(a).replace('.', ','));

  // Ruten findes ikke (flaget slukket) eller modulet mangler → afsnittet skjules.
  const erSlukket = (e) => e && ((e.status === 404 && !e.kode) || e.status === 403);

  let aktuelOpgaveId = null;

  /* ─────────────── Opgaveskærmen: listen over opgavens tilbud ─────────────── */
  async function visPaaOpgave(opgaveId) {
    aktuelOpgaveId = opgaveId;
    const blok = document.getElementById('opgaveTilbudBlok');
    const wrap = document.getElementById('opgaveTilbudWrap');
    const knap = document.getElementById('nytTilbudBtn');
    if (!blok || !wrap || !knap) return;
    blok.style.display = 'none';
    skjulFejl('errorBannerOpgaveTilbud');
    let liste;
    try {
      liste = await G().loadTilbud(opgaveId);
    } catch (e) {
      if (aktuelOpgaveId !== opgaveId) return;
      if (erSlukket(e)) return;                     // tilbudsdelen er ikke slået til
      if (erLoggetUd(e)) return showScreen('login');
      blok.style.display = '';
      wrap.innerHTML = '';
      knap.style.display = 'none';
      visFejl('errorBannerOpgaveTilbud', e);
      return;
    }
    if (aktuelOpgaveId !== opgaveId) return;        // han har skiftet opgave imens
    blok.style.display = '';
    wrap.innerHTML = liste.length
      ? liste.map((t) => `
          <div class="referat-list-row tilbud-raekke" data-id="${escapeHtml(t.id)}">
            <div class="rt">${escapeHtml(t.titel || 'Tilbud uden titel')}</div>
            <div class="rm"><span class="type-badge">${escapeHtml(STATUS[t.status] || t.status)}</span>
              ${t.version > 1 ? 'Version ' + escapeHtml(t.version) + ' · ' : ''}${t.tilbudsnummer ? 'Nr. ' + escapeHtml(t.tilbudsnummer) + ' · ' : ''}${escapeHtml(kr(t.inkl_moms_oere))}${t.inkl_moms_oere != null ? ' inkl. moms' : ''}</div>
          </div>`).join('')
      : '<p class="empty-note">Intet tilbud på denne opgave endnu.</p>';
    wrap.querySelectorAll('.tilbud-raekke').forEach((row) => {
      row.addEventListener('click', () => aabnTilbud(row.dataset.id));
    });
    // Én kæde pr. opgave i Fase 5 (#15). En ny version laves inde fra tilbuddet (D1).
    knap.style.display = liste.length ? 'none' : '';
  }

  async function opretTilbud() {
    const knap = document.getElementById('nytTilbudBtn');
    const opgaveId = aktuelOpgaveId;
    if (!opgaveId || knap.disabled) return;
    knap.disabled = true;
    skjulFejl('errorBannerOpgaveTilbud');
    try {
      const t = await G().opretTilbud(opgaveId);
      knap.disabled = false;
      visTilbud(t);
    } catch (e) {
      knap.disabled = false;
      if (erLoggetUd(e)) return showScreen('login');
      // En anden skærm nåede at oprette det: vis det, der findes.
      if (e.status === 409 && e.kode === 'kaede_findes' && e.krop && e.krop.tilbud_id) return aabnTilbud(e.krop.tilbud_id);
      visFejl('errorBannerOpgaveTilbud', e);
    }
  }

  /* ─────────────────────────── Ét tilbud (C1: læsning) ──────────────────────── */
  async function aabnTilbud(id) {
    const wrap = document.getElementById('tilbudDetailWrap');
    wrap.innerHTML = '<p class="indlaeser">Henter tilbud …</p>';
    skjulFejl('errorBannerTilbudDetail');
    showScreen('tilbud-detail');
    try {
      visTilbud(await G().hentTilbud(id));
    } catch (e) {
      if (erLoggetUd(e)) return showScreen('login');
      wrap.innerHTML = '';
      visFejl('errorBannerTilbudDetail', e);
    }
  }

  function visTilbud(t) {
    const wrap = document.getElementById('tilbudDetailWrap');
    showScreen('tilbud-detail');
    const s = t.summer || {};
    const linjer = (t.linjer || []).map((l) => `
        <tr>
          <td>${escapeHtml(l.beskrivelse || '')}</td>
          <td class="tal">${escapeHtml(antalTekst(l.antal))}</td>
          <td>${escapeHtml((l.enhed && l.enhed.navn) || '')}</td>
          <td class="tal">${escapeHtml(kr(l.enhedspris_oere))}</td>
          <td class="tal">${escapeHtml(kr(l.linje_sum_oere))}</td>
        </tr>`).join('');
    const sumRaekke = (navn, v) => (v ? `<tr><td colspan="4">${navn}</td><td class="tal">${escapeHtml(kr(v))}</td></tr>` : '');
    wrap.innerHTML = `
      <div class="section-label">${escapeHtml(t.titel || 'Tilbud uden titel')}</div>
      <p class="empty-note"><span class="type-badge">${escapeHtml(STATUS[t.status] || t.status)}</span>
        ${t.tilbudsnummer ? ' Tilbud nr. ' + escapeHtml(t.tilbudsnummer) : ''}${t.version > 1 ? ' · version ' + escapeHtml(t.version) : ''}</p>
      ${t.indledning ? `<p class="referat-tekst">${escapeHtml(t.indledning)}</p>` : ''}
      <table class="tilbud-tabel">
        <thead><tr><th>Linje</th><th class="tal">Antal</th><th>Enhed</th><th class="tal">Pris</th><th class="tal">I alt</th></tr></thead>
        <tbody>${linjer || '<tr><td colspan="5" class="empty-note">Ingen linjer endnu.</td></tr>'}</tbody>
        <tfoot>
          ${sumRaekke('Rabat på hele tilbuddet', s.samlet_rabat_oere ? -s.samlet_rabat_oere : 0)}
          ${sumRaekke('I alt ekskl. moms', s.ex_moms_oere)}
          ${sumRaekke('Moms', s.moms_oere)}
          ${sumRaekke('<strong>I alt inkl. moms</strong>', s.inkl_moms_oere)}
        </tfoot>
      </table>
      ${(t.mangler || []).length ? `<div class="tilbud-mangler"><strong>Før tilbuddet kan godkendes:</strong><ul>${t.mangler.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul></div>` : ''}
      <p class="empty-note" style="margin-top:14px">Redigering og forslag kommer i næste trin.</p>`;
  }

  /* ─────────────────────────────── Knapper ─────────────────────────────── */
  function init() {
    const knap = document.getElementById('nytTilbudBtn');
    if (knap) knap.addEventListener('click', opretTilbud);
    const tilbage = document.getElementById('backToOpgaveDetailFromTilbud');
    if (tilbage) tilbage.addEventListener('click', () => {
      // Tilbage til opgaven, hentet frisk (status og beløb kan være ændret).
      if (typeof openOpgaveDetail === 'function' && currentKundeDetailId && aktuelOpgaveId) openOpgaveDetail(currentKundeDetailId, aktuelOpgaveId);
      else showScreen('customers');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.TilbudSkaerm = { visPaaOpgave, aabnTilbud, _kr: kr };
})();
