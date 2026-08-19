const CACHE_NAME = 'dashboard-v18';   // <-- bump dette tal ved hver deploy

// ─────────────────────────────────────────────────────────────────────────────
// OMSKREVET 13/7-26 efter hvid skærm-fejlfindingen. Den gamle version havde to
// alvorlige fejl i navigation-håndteringen:
//   1) ALLE navigationer på domænet (også kundeformularen /:slug/:token og
//      /onboarding) blev besvaret med den cachede kopi under nøglen
//      '/dashboard' — kunden kunne få dashboard-HTML serveret.
//   2) CACHE-FORGIFTNING: baggrunds-fetchen hentede den FAKTISKE url (fx
//      formularen) og gemte svaret under '/dashboard'-nøglen. Næste
//      dashboard-åbning fik så formular-HTML → hvid skærm.
// Ny strategi: ALLOWLIST. Kun /dashboard-navigationen håndteres (network-first
// med cache som offline-fallback). Alt andet — kundeformular, /onboarding,
// /config.js, Supabase-kald — rører SW'en ALDRIG.
// ─────────────────────────────────────────────────────────────────────────────

// App-skallen: det mindste der skal til for at vise siden offline.
const APP_SHELL = ['/dashboard'];

// Værter hvis STATISKE aktiver må caches (skrifttyper + Supabase-biblioteket).
// Data fra din egen Supabase (*.supabase.co) er IKKE her — det skal aldrig caches.
const STATIC_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  self.skipWaiting();                          // tag den nye SW i brug straks
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  // ryd gamle caches ved versions-bump (fjerner også evt. forgiftede v16-caches)
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;            // POST/PUT/DELETE urørt → netværk

  const url = new URL(req.url);
  const egenVaert = url.origin === self.location.origin;

  // 1) Navigation: KUN dashboardets egen sti håndteres — network-first, så en
  //    deploy slår igennem ved første genindlæsning. Cachen bruges kun offline.
  //    ALLE andre navigationer (kundeformularen, /onboarding, …) falder
  //    igennem til browserens normale netværkshentning.
  if (req.mode === 'navigate') {
    if (egenVaert && url.pathname === '/dashboard') {
      event.respondWith(networkFirst(req));
    }
    return;
  }

  // 2) /config.js må ALDRIG caches (serveres med no-store og bærer miljøets
  //    Supabase-config). Eksplicit "rør ikke"-linje, så reglen ikke kan
  //    forsvinde ved en senere omskrivning af punkt 3.
  if (egenVaert && url.pathname === '/config.js') return;

  // 3) Statiske aktiver fra CDN (skrifttyper, Supabase-bibliotek): cache-først.
  if (STATIC_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 4) Alt andet — Supabase API/auth/storage, egne /api-kald, signerede
  //    billed-URL'er — er dynamisk og auth'et og må ALDRIG serveres fra cache.
  //    Intet respondWith = browseren henter normalt over nettet.
});

// Network-first: prøv altid nettet først (frisk HTML efter hver deploy) og
// opdatér cachen ved succes. Kun ved netværksfejl (offline) bruges cachen.
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put('/dashboard', res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match('/dashboard');
    if (cached) return cached;
    throw err;                                  // offline uden cache → normal fejl
  }
}

// Stale-while-revalidate: returnér den cachede version med det samme (hurtigt),
// og hent samtidig en frisk version i baggrunden til næste gang. Bruges KUN til
// versionsløse statiske CDN-aktiver — aldrig til egen HTML (se networkFirst).
async function staleWhileRevalidate(req) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  const network = fetch(req)
    .then(res => {
      if (res && res.status === 200) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);                       // offline → brug cache hvis muligt

  return cached || network;                     // cache straks, ellers vent på net
}

// ─── Push notifikation (uændret) ────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Nyt lead', {
      body: data.body || 'Du har modtaget et nyt lead',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    })
  );
  if (data.count && 'setAppBadge' in self.navigator) {
    self.navigator.setAppBadge(data.count);
  }
});
