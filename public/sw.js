const CACHE_NAME = 'dzimmo-v1';
const ASSETS = ['/', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const c = r.clone(); caches.open(CACHE_NAME).then(cache => cache.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request))
  );
});

// ── Notifications push ──────────────────────────────────────────────────────
self.addEventListener('push', e => {
  const data = e.data?.json().catch?.(() => {}) || {};
  try {
    const d = e.data?.json() || {};
    e.waitUntil(self.registration.showNotification(d.title || 'DzImmo', {
      body:  d.body  || '',
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      tag:   d.tag   || 'dzimmo',
      data:  { url: d.url || '/' },
    }));
  } catch {}
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) {
      if (new URL(c.url).pathname === new URL(url, self.location.origin).pathname && 'focus' in c) return c.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
