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
 * BYGGET 15/10-26 (Fase 2 punkt F, skive 1): saveReferater, transskriber,
 *   hentKvote. Skive 2 (samme dag): lavUdkast, saetUdkast, udkastSomTekst.
 *   Skive 3: retReferat; loadReferater giver harReferat og tid.
 *
 * IKKE BYGGET ENDNU (kaster en tydelig fejl):
 *   loadTilbud / saveTilbud / loadFirmaProfil / saveFirmaProfil — Tilbud- og
 *   Firma-fanerne er lukket i Fase 1 (tilbud-runbook.md).
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  // Sættes af siden, når supabase-klienten findes. Returnerer {Authorization}.
  let hentAuthHeader = async function () { return {}; };
  // Skive "ventetid" (16/10-26): siden får at vide, hvilken fase et kald er i
  // ('login' → 'server' → ''), så en knap kan vise, HVOR den venter.
  let paaFase = function () {};
  const fase = (f) => { try { paaFase(f); } catch (_) { /* må aldrig vælte et kald */ } };

  class ApiFejl extends Error {
    constructor(status, krop) {
      super((krop && (krop.besked || krop.error)) || ('Serveren svarede ' + status));
      this.name = 'ApiFejl';
      this.status = status;
      this.kode = krop && krop.error;
      this.krop = krop;
    }
  }

  // ─── VENTETID (målt 16/10-26) ───────────────────────────────────────────
  // To referater nåede først serveren 3 og 10 minutter efter, Ann trykkede —
  // og serveren brugte derefter 3 og 7 sekunder. Intet deploy imens. Tiden
  // gik altså tabt i browseren, FØR kaldet blev sendt. Derfor:
  //   - fasen meldes (login / server), så en knap kan vise, hvor den venter
  //   - selve kaldet har en tidsgrænse; før ventede det for evigt
  // Tidsgrænsen på login sidder i siden (saetAuth), fordi det er dér, login
  // hentes.
  const STANDARD_MS = 60000;
  async function api(metode, sti, krop, { timeoutMs = STANDARD_MS } = {}) {
    fase('login');
    let auth;
    try { auth = await hentAuthHeader(); } catch (e) { fase(''); throw e; }
    const headers = Object.assign({}, auth);
    // Lyd sendes som multipart (FormData). Så må Content-Type IKKE sættes her:
    // browseren skal selv skrive den, fordi den indeholder grænsestrengen.
    const erForm = typeof FormData !== 'undefined' && krop instanceof FormData;
    if (krop !== undefined && !erForm) headers['Content-Type'] = 'application/json';
    let svar;
    const afbryd = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const ur = afbryd ? setTimeout(() => afbryd.abort(), timeoutMs) : null;
    fase('server');
    try {
      svar = await fetch(sti, {
        method: metode, headers,
        body: krop === undefined ? undefined : (erForm ? krop : JSON.stringify(krop)),
        signal: afbryd ? afbryd.signal : undefined,
      });
    } catch (e) {
      if (ur) clearTimeout(ur);
      fase('');
      if (e && e.name === 'AbortError') {
        throw new ApiFejl(0, { error: 'tog_for_lang_tid',
          besked: 'Det tog for lang tid at få svar. Intet er gået tabt — prøv igen.' });
      }
      // Intet svar overhovedet. Skal kunne skelnes fra et svar, der siger nej.
      throw new ApiFejl(0, { error: 'ingen_forbindelse',
        besked: 'Vi kunne ikke få forbindelse. Tjek at du er på nettet, og prøv igen.' });
    }
    if (ur) clearTimeout(ur);
    fase('');
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
      // D88 trin 2 (20/10): alle numre fra kunde_telefoner, og det, Ny opgave
      // udfylder med. Ikke i KUNDE_PROTO — de rettes ikke herfra.
      telefoner: Array.isArray(k.telefoner) ? k.telefoner.slice() : (k.telefon ? [k.telefon] : []),
      email: k.email || '', postnr: k.postnr || '', by: k.by || '',
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

  // ─── Ret kunde (D88 opgave 2, 23/10-26) ─────────────────────────────────
  // Ét kald til PATCH /api/tilbud/kunder/:id med netop de felter, arket
  // sender: stamdata (navn, adresse …), `telefon` (nyt nummer), `fjern_telefon`
  // og valget for de aabne opgaver (`opgaver_til` / `behold_opgaver`).
  // Bevidst IKKE gennem saveCustomers(): den sammenligner med sidste hentning
  // og kender ikke numrene. Serveren svarer { kunde, opgaver_flyttet,
  // opgaver_beholdt }; en 409 `nummer_bruges` kastes som ApiFejl med
  // `krop.opgaver` (antallet), og saa er INTET skrevet.
  async function retKunde(id, krop) {
    const svar = await api('PATCH', '/api/tilbud/kunder/' + encodeURIComponent(id), krop);
    if (svar.kunde) {
      const k = kundeCache.get(id);
      if (k) {
        k.navn = svar.kunde.navn || '';
        k.adresse = svar.kunde.adresse || '';
        k.postnr = svar.kunde.postnr || ''; k.by = svar.kunde.by || '';
        k.telefoner = Array.isArray(svar.kunde.telefoner) ? svar.kunde.telefoner.slice() : [];
        k.telefon = k.telefoner[0] || '';
        husk('kunde', k, KUNDE_PROTO);
      }
    }
    return svar;
  }

  // Hvilke numre kundens AABNE opgaver sender SMS til (23/10-26).
  // [{ nummer, antal, sms }] — nummer null = opgaver uden nummer.
  async function hentOpgaveNumre(id) {
    const { numre } = await api('GET', '/api/tilbud/kunder/' + encodeURIComponent(id) + '/opgave-numre');
    return Array.isArray(numre) ? numre : [];
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
  // saveReferater (Fase 2 punkt F, skive 1, 15/10-26) gemmer samme vej som
  // kunder og opgaver: en række uden server-id oprettes, en ændret rettes med
  // netop de ændrede felter, og en fjernet række er en fejl.
  //
  // KILDEMATERIALET SENDES KUN VED OPRETTELSE. `transskript` og `ai_udkast`
  // kan ikke rettes bagefter (serveren afviser dem i PATCH). Derfor er de
  // ikke med i REFERAT_PROTO — en ændring af dem ville ellers blive sendt og
  // afvist som ukendte felter.
  //
  // `transskript` er hans RETTEDE tekst (besluttet af Ann 15/10). En kladde
  // må have transskriptionen alene, uden udkast.
  const REFERAT_PROTO = ['titel', 'status', 'indhold'];
  const referatIder = new Map();            // opgaveId → [id]

  async function loadReferater(opgaveId) {
    const { referater } = await api('GET', '/api/tilbud/opgaver/' + encodeURIComponent(opgaveId));
    const list = (referater || []).map((r) => ({
      id: r.id, titel: r.titel || 'Referat', type: 'Noter',
      dato: (r.moede_dato || r.created_at || '').slice(0, 10),
      status: r.status || 'kladde', createdAt: r.created_at || '',
      // Skive 3: så listen kan skelne "Indtalt tekst" fra "Referat", og fire
      // referater fra samme dag fra hinanden.
      harReferat: !!r.har_referat,
      tid: klokkeslaet(r.created_at),
    }));
    referatIder.set(opgaveId, list.map((r) => r.id));
    list.forEach((r) => husk('referat', r, REFERAT_PROTO));
    return list;
  }

  // "09.05" i telefonens egen tidszone. Tom streng, hvis tidspunktet mangler.
  function klokkeslaet(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '';
    return String(d.getHours()).padStart(2, '0') + '.' + String(d.getMinutes()).padStart(2, '0');
  }

  async function hentReferat(id) {
    const { referat } = await api('GET', '/api/tilbud/referater/' + encodeURIComponent(id));
    return referat;
  }

  async function saveReferater(opgaveId, list) {
    if (!opgaveId) throw new ApiFejl(0, { error: 'opgave_mangler',
      besked: 'Et referat skal høre til en opgave.' });
    const væk = fjernede(referatIder.get(opgaveId) || [], list);
    if (væk.length) throw new ApiFejl(0, { error: 'sletning_findes_ikke',
      besked: 'Referater kan ikke slettes herfra endnu.' });
    for (const r of list) {
      if (!sidst.has(nøgle('referat', r.id))) {
        const krop = { lead_id: opgaveId, titel: (r.titel || '').trim() || null };
        if (r.dato) krop.moede_dato = r.dato;
        if ((r.transskript || '').trim()) krop.transskript = r.transskript;
        if ((r.ai_udkast || '').trim()) krop.ai_udkast = r.ai_udkast;
        if ((r.indhold || '').trim()) krop.indhold = r.indhold;
        if (krop.ai_udkast && r.ophav) krop.ophav = r.ophav;   // se lavUdkast
        if (typeof r.varighedSek === 'number' && isFinite(r.varighedSek)) {
          krop.varighed_sek = Math.round(r.varighedSek);
        }
        const { referat } = await api('POST', '/api/tilbud/referater', krop);
        r.id = referat.id;                  // kaldestedet kan bruge id'et bagefter
        r.status = referat.status || 'kladde';
        r.dato = (referat.moede_dato || r.dato || '').slice(0, 10);
        husk('referat', r, REFERAT_PROTO);
        const ider = referatIder.get(opgaveId) || [];
        ider.push(r.id); referatIder.set(opgaveId, ider);
        continue;
      }
      const æ = ændredeFelter('referat', r, REFERAT_PROTO);
      if (æ && Object.keys(æ).length) {
        await api('PATCH', '/api/tilbud/referater/' + encodeURIComponent(r.id), æ);
        husk('referat', r, REFERAT_PROTO);
      }
    }
  }

  // Skive 3: ret et gemt referat (titel, indhold) og/eller markér det som
  // færdigt. Serveren afviser med 409 (`referat_faerdigt`), hvis det allerede
  // er færdigt — låsen sidder dér, ikke her.
  async function retReferat(id, { titel, indhold, faerdig }) {
    const krop = {};
    if (typeof titel === 'string') krop.titel = titel.trim() || null;
    if (typeof indhold === 'string') krop.indhold = indhold;
    if (faerdig) krop.status = 'faerdig';
    const { referat } = await api('PATCH', '/api/tilbud/referater/' + encodeURIComponent(id), krop);
    return referat;
  }

  /* ───────────────────────────  LYD OG KVOTE  ───────────────────────────── */
  // Ikke blandt Annes ti: prototypen havde én funktion, transcribeAudio(blob),
  // som hun bad os koble til backend. Her er den, med to forskelle:
  //   - den tager ALLE delene af en diktering i ét kald, i rækkefølge, fordi
  //     serveren tæller kvoten på den samlede lydtid og sætter teksterne
  //     sammen (routes/tilbud/index.js). Kaldestedet sender kun de dele, der
  //     skal med — en kasseret del er allerede sorteret fra.
  //   - fejl kastes som ApiFejl med serverens besked, som alle andre kald.
  //
  // dele: [{ blob, filnavn }]. Rækkefølgen er kaldestedets ansvar og ændres
  // ikke her.
  async function transskriber(dele) {
    if (!Array.isArray(dele) || !dele.length) {
      throw new ApiFejl(0, { error: 'ingen_lyd', besked: 'Der var ingen optagelse med.' });
    }
    const form = new FormData();
    dele.forEach((d, i) => form.append('dele', d.blob, d.filnavn || ('del-' + (i + 1))));
    return api('POST', '/api/tilbud/transskriber', form, { timeoutMs: 150000 });
  }

  // Spørges, når optageskærmen åbnes — FØR han taler (besluttet 29/9). Svaret
  // er serverens; fanen læser kun `spaerret`. Serveren tjekker kvoten igen
  // ved selve kaldet, så dette er en høflighed, ikke værnet.
  async function hentKvote() {
    return api('GET', '/api/tilbud/kvote');
  }

  /* ──────────────────────────  REFERATUDKASTET  ─────────────────────────── */
  // Skive 2 (15/10-26). Modellen svarer struktureret; `ai_udkast` er én
  // tekstkolonne. udkastSomTekst() skriver det faste format, som serveren
  // læser tilbage (referat-format.js), så teknik B måles på samme felter som
  // på skærmen. Ændres formatet her, skal tilFelter() ændres med.
  //
  //   <overskrift>
  //
  //   - <punkt>
  //   - <punkt>
  //
  //   <fritekst>
  function udkastSomTekst(r) {
    const dele = [];
    if (r && r.overskrift) dele.push(String(r.overskrift).trim());
    const punkter = (r && Array.isArray(r.punkter) ? r.punkter : [])
      .map((p) => String(p).trim()).filter(Boolean);
    if (punkter.length) dele.push(punkter.map((p) => '- ' + p).join('\n'));
    if (r && r.fritekst) dele.push(String(r.fritekst).trim());
    return dele.join('\n\n');
  }

  // Tekst ind, udkast + teknik B-markeringer ud. Gemmer INTET — det sker med
  // saveReferater (nyt referat) eller saetUdkast (gemt kladde).
  // Svaret har `ophav` ({ model, version }); giv det videre uændret til
  // gemningen, så serveren kan skrive, hvad der lavede udkastet (D14).
  // Minimumslængden (Ann 16/10-26): under 10 ord laves der intet referat.
  // Et fejltryk, et "øh" eller en optagelse uden ord koster ellers et kald og
  // giver et ubrugeligt referat. Et ord er en klump uden mellemrum, der har
  // mindst ét bogstav eller tal. SAMME regel står i routes/tilbud/index.js —
  // serveren er den, der bestemmer; fanen spærrer bare knappen i forvejen.
  const MIN_ORD_REFERAT = 10;
  const FOR_KORT_BESKED = 'Teksten er for kort til et referat. Du kan gemme den, som den er.';
  function antalOrd(tekst) {
    return String(tekst || '').split(/\s+/).filter((o) => /[\p{L}\p{N}]/u.test(o)).length;
  }

  async function lavUdkast(transskription) {
    const t = String(transskription || '').trim();
    if (!t) throw new ApiFejl(0, { error: 'ingen_tekst', besked: 'Der er ingen tekst at lave et referat af.' });
    if (antalOrd(t) < MIN_ORD_REFERAT) throw new ApiFejl(0, { error: 'for_lidt_tekst', besked: FOR_KORT_BESKED });
    return api('POST', '/api/tilbud/referat', { transskription: t }, { timeoutMs: 150000 });
  }

  // Indtal mere (Ann 17/10): erstatter teksten på en kladde, der endnu ikke har
  // et udkast. `transskript` er HELE den nye tekst (gammel + ny, som han har
  // rettet den). Serveren svarer 409 `tekst_laast`, hvis der er lavet et udkast.
  async function saetTransskript(referatId, { transskript, titel }) {
    const t = String(transskript || '').trim();
    if (!t) throw new ApiFejl(0, { error: 'ingen_tekst', besked: 'Der er ingen tekst at gemme.' });
    const krop = { transskript: t };
    if ((titel || '').trim()) krop.titel = titel.trim();
    const { referat } = await api('POST', '/api/tilbud/referater/' + encodeURIComponent(referatId) + '/transskript', krop);
    return referat;
  }

  // Sætter udkastet på en GEMT kladde — én gang. Serveren svarer 409
  // (`udkast_findes`), hvis kladden allerede har et.
  async function saetUdkast(referatId, { aiUdkast, indhold, ophav }) {
    const krop = { ai_udkast: aiUdkast };
    if ((indhold || '').trim()) krop.indhold = indhold;
    if (ophav) krop.ophav = ophav;
    const { referat } = await api('POST', '/api/tilbud/referater/' + encodeURIComponent(referatId) + '/udkast', krop);
    return referat;
  }

  /* ────────────────────────  TILBUD OG FIRMAPROFIL  ─────────────────────── */
  const ikkeBygget = (hvad) => async () => {
    throw new ApiFejl(0, { error: 'ikke_bygget', besked: hvad + ' kommer ikke med i Fase 1.' });
  };

  window.Graenseflade = {
    saetAuth(fn) { hentAuthHeader = fn; },
    saetFase(fn) { paaFase = typeof fn === 'function' ? fn : function () {}; },
    ApiFejl,
    loadCustomers, saveCustomers, retKunde, hentOpgaveNumre,
    loadOpgaver, saveOpgaver,
    loadReferater, saveReferater, hentReferat,
    transskriber, hentKvote,
    lavUdkast, saetUdkast, udkastSomTekst, retReferat, saetTransskript,
    antalOrd, MIN_ORD_REFERAT, FOR_KORT_BESKED,
    loadTilbud: ikkeBygget('Tilbud'), saveTilbud: ikkeBygget('Tilbud'),
    loadFirmaProfil: ikkeBygget('Firmaprofilen'), saveFirmaProfil: ikkeBygget('Firmaprofilen'),
  };
})();
