/* tilbud/graenseflade.js — BACKEND-GRÆNSEFLADEN (Annes 10 funktioner)
 * ---------------------------------------------------------------------------
 * ⚠️ OFFENTLIG FIL. Alt i tilbud/ kan hentes af enhver (se README.md, S17).
 * Her ligger kun kald til vores egne endpoints. Ingen nøgler, ingen modeltekster,
 * ingen kvote- eller prislogik.
 *
 * HVAD FILEN ER
 *   Annes prototype (docs/referater-app.html) lader AL dataadgang gå gennem ti
 *   funktioner. Navnene og kaldestederne BEVARES (tilbud-primer.md, "De 10
 *   datafunktioner"), så hendes UI-kode kan bruges uden at blive læst om.
 *   Indmaden er skrevet om fra "gem hele listen" til ét kald pr. række.
 *
 * HVORFOR IKKE "GEM HELE LISTEN"
 *   To åbne skærme (telefon + iPad, mester + svend) ville give last-write-wins
 *   og tavst datatab. Derfor sammenligner save*(list) listen med det, der sidst
 *   blev hentet, og sender kun det, der er nyt eller ændret:
 *     - en række uden server-id  → POST, og id'et skrives TILBAGE på objektet,
 *       så kaldestedet kan bruge nyKunde.id bagefter, som i prototypen
 *     - en række, der er ændret  → PATCH med netop de ændrede felter
 *     - en række, der er FJERNET → fejl. Der findes ingen sletning (ingen rute,
 *       ingen DELETE-politik). At lade den forsvinde i stilhed ville være
 *       "skrevet, kvitteret og væk" igen.
 *
 * FEJL SLUGES IKKE
 *   Prototypens load*() returnerede [] ved enhver fejl. En tom liste ved en
 *   netværksfejl ligner "du har ingen kunder" — og det er præcis den fejlklasse,
 *   registret har set fem gange på ti dage. Her kastes fejlen med serverens
 *   egen besked, og UI'et viser den.
 *
 * IKKE BYGGET ENDNU (kaster en tydelig fejl):
 *   loadTilbud / saveTilbud / loadFirmaProfil / saveFirmaProfil — Tilbud- og
 *   Firma-fanerne er lukket i Fase 1 (tilbud-runbook.md).
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  // Sættes af siden, når supabase-klienten findes. Returnerer {Authorization}.
  let hentAuthHeader = async function () { return {}; };

  class ApiFejl extends Error {
    constructor(status, krop) {
      super((krop && (krop.besked || krop.error)) || ('Serveren svarede ' + status));
      this.name = 'ApiFejl';
      this.status = status;
      this.kode = krop && krop.error;
      this.krop = krop;
    }
  }

  async function api(metode, sti, krop) {
    const headers = Object.assign({}, await hentAuthHeader());
    if (krop !== undefined) headers['Content-Type'] = 'application/json';
    let svar;
    try {
      svar = await fetch(sti, {
        method: metode, headers,
        body: krop === undefined ? undefined : JSON.stringify(krop),
      });
    } catch (e) {
      // Intet svar overhovedet. Skal kunne skelnes fra et svar, der siger nej.
      throw new ApiFejl(0, { error: 'ingen_forbindelse',
        besked: 'Vi kunne ikke få forbindelse. Tjek at du er på nettet, og prøv igen.' });
    }
    let data = null;
    try { data = await svar.json(); } catch (_) { /* fx en HTML-fejlside */ }
    if (!svar.ok) throw new ApiFejl(svar.status, data);
    if (!data) throw new ApiFejl(svar.status, { error: 'tomt_svar', besked: 'Serveren svarede uden indhold.' });
    return data;
  }

  // ── Sidste hentede udgave pr. række ───────────────────────────────────────
  // Nøgle: tabel + id. Værdi: de felter, prototypen kender, som JSON.
  const sidst = new Map();
  const nøgle = (tabel, id) => tabel + ':' + id;
  function husk(tabel, obj, felter) {
    const kopi = {};
    for (const f of felter) kopi[f] = obj[f] === undefined ? null : obj[f];
    sidst.set(nøgle(tabel, obj.id), JSON.stringify(kopi));
  }
  function ændredeFelter(tabel, obj, felter) {
    const gammel = sidst.get(nøgle(tabel, obj.id));
    if (!gammel) return null;                    // ukendt række
    const før = JSON.parse(gammel), ud = {};
    for (const f of felter) {
      const nu = obj[f] === undefined ? null : obj[f];
      if (JSON.stringify(nu) !== JSON.stringify(før[f])) ud[f] = nu;
    }
    return ud;
  }
  // Rækker, der var der ved sidste hentning, men mangler nu.
  function fjernede(hentede, list) {
    const ider = new Set(list.map((o) => o.id));
    return hentede.filter((id) => !ider.has(id));
  }

  const tomTilNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

  /* ───────────────────────────────  KUNDER  ─────────────────────────────── */
  // Prototypen: { id, navn, telefon, adresse, oprettet }
  const KUNDE_PROTO = ['navn', 'telefon', 'adresse'];
  let kundeIder = [];
  const kundeCache = new Map();             // id → kunde (bruges af saveOpgaver)

  async function loadCustomers() {
    const { kunder } = await api('GET', '/api/tilbud/kunder');
    const list = (kunder || []).map((k) => ({
      id: k.id, navn: k.navn || '', telefon: k.telefon || '', adresse: k.adresse || '',
      oprettet: k.created_at || '',
    }));
    kundeIder = list.map((k) => k.id);
    kundeCache.clear();
    list.forEach((k) => { husk('kunde', k, KUNDE_PROTO); kundeCache.set(k.id, k); });
    return list;
  }

  async function saveCustomers(list) {
    const væk = fjernede(kundeIder, list);
    if (væk.length) throw new ApiFejl(0, { error: 'sletning_findes_ikke',
      besked: 'Kunder kan ikke slettes herfra endnu.' });
    for (const k of list) {
      if (!sidst.has(nøgle('kunde', k.id))) {
        // Ny. telefon er unik pr. firma — en tom streng ville kollidere med den
        // næste kunde uden nummer. Derfor null, ikke "".
        const { kunde } = await api('POST', '/api/tilbud/kunder', {
          navn: k.navn, telefon: tomTilNull(k.telefon), adresse: tomTilNull(k.adresse),
        });
        k.id = kunde.id;                    // kaldestedet bruger nyKunde.id bagefter
        k.oprettet = k.oprettet || new Date().toISOString();
        husk('kunde', k, KUNDE_PROTO);
        kundeIder.push(k.id);
        kundeCache.set(k.id, k);
        continue;
      }
      const æ = ændredeFelter('kunde', k, KUNDE_PROTO);
      if (æ && Object.keys(æ).length) {
        for (const f of Object.keys(æ)) æ[f] = tomTilNull(æ[f]);
        await api('PATCH', '/api/tilbud/kunder/' + encodeURIComponent(k.id), æ);
        husk('kunde', k, KUNDE_PROTO);
        kundeCache.set(k.id, k);
      }
    }
  }

  /* ───────────────────────────────  OPGAVER  ────────────────────────────── */
  // Prototypen: { id, titel, beskrivelse, oprettet }  — gemt pr. kunde.
  // Serveren:   leads { id, name, address, task, titel, kunde_id, created_at }
  //
  // name, address og task er NOT NULL. Beslutning 11/10 (Ann): opgaven ARVER
  // navn og adresse fra kunden; titlen bliver beskrivelsen, hvis der ikke er
  // andet. Mangler kunden en adresse, skal UI'et have spurgt og lagt den på
  // opgaven som `adresse` (et felt, prototypen ikke havde) — ellers kastes
  // 'adresse_mangler' her, FØR noget sendes.
  const OPGAVE_PROTO = ['titel', 'beskrivelse'];
  const opgaveIder = new Map();             // kundeId → [id]

  async function loadOpgaver(kundeId) {
    const { opgaver } = await api('GET', '/api/tilbud/opgaver');
    const list = (opgaver || [])
      .filter((o) => o.kunde_id === kundeId)
      .map((o) => ({
        id: o.id, titel: o.titel || o.task || '', beskrivelse: o.task || '',
        oprettet: o.created_at || '',
      }));
    opgaveIder.set(kundeId, list.map((o) => o.id));
    list.forEach((o) => husk('opgave', o, OPGAVE_PROTO));
    return list;
  }

  async function saveOpgaver(kundeId, list) {
    const væk = fjernede(opgaveIder.get(kundeId) || [], list);
    if (væk.length) throw new ApiFejl(0, { error: 'sletning_findes_ikke',
      besked: 'Opgaver kan ikke slettes herfra endnu.' });
    const kunde = kundeCache.get(kundeId);
    for (const o of list) {
      if (!sidst.has(nøgle('opgave', o.id))) {
        const adresse = (o.adresse || (kunde && kunde.adresse) || '').trim();
        if (!kunde) throw new ApiFejl(0, { error: 'kunde_ukendt',
          besked: 'Kunden er ikke hentet. Gå tilbage til kundelisten og prøv igen.' });
        if (!adresse) throw new ApiFejl(0, { error: 'adresse_mangler',
          besked: 'Opgaven skal have en adresse.' });
        const titel = (o.titel || '').trim();
        const { opgave } = await api('POST', '/api/tilbud/opgaver', {
          kunde_id: kundeId, titel,
          name: kunde.navn, address: adresse,
          task: (o.beskrivelse || '').trim() || titel,
        });
        o.id = opgave.id;
        o.beskrivelse = o.beskrivelse || titel;
        o.oprettet = opgave.created_at || new Date().toISOString();
        delete o.adresse;
        husk('opgave', o, OPGAVE_PROTO);
        const ider = opgaveIder.get(kundeId) || [];
        ider.push(o.id); opgaveIder.set(kundeId, ider);
        continue;
      }
      const æ = ændredeFelter('opgave', o, OPGAVE_PROTO);
      if (æ && Object.keys(æ).length) {
        const krop = {};
        if ('titel' in æ) krop.titel = æ.titel;
        if ('beskrivelse' in æ) krop.task = æ.beskrivelse;
        await api('PATCH', '/api/tilbud/opgaver/' + encodeURIComponent(o.id), krop);
        husk('opgave', o, OPGAVE_PROTO);
      }
    }
  }

  /* ──────────────────────────────  REFERATER  ───────────────────────────── */
  // Listen kommer fra GET /opgaver/:id i oversigtsform (uden indhold).
  // Indholdet hentes pr. referat med hentReferat(id) — en udvidelse, som
  // prototypen ikke havde, fordi den holdt alt i én liste i browseren.
  //
  // saveReferater kommer med Referat-fanen (trin 3): den skal gemme
  // transskript og ai_udkast uændret ved siden af indhold, så teknik B kan
  // måles server-side. Den bygges ikke halvt nu.
  async function loadReferater(opgaveId) {
    const { referater } = await api('GET', '/api/tilbud/opgaver/' + encodeURIComponent(opgaveId));
    return (referater || []).map((r) => ({
      id: r.id, titel: r.titel || 'Referat', type: 'Noter',
      dato: (r.moede_dato || r.created_at || '').slice(0, 10),
      status: r.status || 'kladde', createdAt: r.created_at || '',
    }));
  }

  async function hentReferat(id) {
    const { referat } = await api('GET', '/api/tilbud/referater/' + encodeURIComponent(id));
    return referat;
  }

  async function saveReferater(/* opgaveId, list */) {
    throw new ApiFejl(0, { error: 'ikke_bygget', besked: 'Referater gemmes fra Referat-fanen, som kommer i næste trin.' });
  }

  /* ────────────────────────  TILBUD OG FIRMAPROFIL  ─────────────────────── */
  const ikkeBygget = (hvad) => async () => {
    throw new ApiFejl(0, { error: 'ikke_bygget', besked: hvad + ' kommer ikke med i Fase 1.' });
  };

  window.Graenseflade = {
    saetAuth(fn) { hentAuthHeader = fn; },
    ApiFejl,
    loadCustomers, saveCustomers,
    loadOpgaver, saveOpgaver,
    loadReferater, saveReferater, hentReferat,
    loadTilbud: ikkeBygget('Tilbud'), saveTilbud: ikkeBygget('Tilbud'),
    loadFirmaProfil: ikkeBygget('Firmaprofilen'), saveFirmaProfil: ikkeBygget('Firmaprofilen'),
  };
})();
