const CACHE_NAME = 'dashboard-v13';   // <-- bump dette tal ved hver deploy

// App-skallen: det mindste der skal til for at vise siden med det samme.
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
  // ryd gamle caches ved versions-bump
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

  // 1) Selve siden (navigation): vis den cachede skal STRAKS, opdatér i baggrunden.
  if (req.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(req, '/dashboard'));
    return;
  }

  // 2) Statiske aktiver fra CDN (skrifttyper, Supabase-bibliotek): cache-først.
  if (STATIC_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 3) Alt andet — Supabase API/auth/storage, dine egne /api-kald, signerede
  //    billed-URL'er — er dynamisk og auth'et og må ALDRIG serveres fra cache.
  //    Intet respondWith = browseren henter normalt over nettet.
});

// Stale-while-revalidate: returnér den cachede version med det samme (hurtigt),
// og hent samtidig en frisk version i baggrunden til næste gang. Ved cache-miss
// ventes på netværket; offline falder vi tilbage til cachen hvis vi har den.
async function staleWhileRevalidate(req, cacheKey) {
  const cache  = await caches.open(CACHE_NAME);
  const key    = cacheKey || req;
  const cached = await cache.match(key);

  const network = fetch(req)
    .then(res => {
      if (res && res.status === 200) cache.put(key, res.clone());
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
