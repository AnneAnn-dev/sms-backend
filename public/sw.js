const CACHE_NAME = 'dashboard-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(['/dashboard']);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request)
    )
  );
});

// Modtag push notifikation
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Nyt lead', {
      body: data.body || 'Du har modtaget et nyt lead',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    })
  );
});