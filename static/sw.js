const CACHE_NAME = 'dashboard-v4';

self.addEventListener('install', (event) => {
  self.skipWaiting();                          // tag den nye SW i brug straks
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(['/dashboard']))
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
  // Rør KUN GET. POST/PUT/DELETE passerer uberørt til netværket.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Push notifikation (uændret)
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