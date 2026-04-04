/* ── Tap2Dine Service Worker ── */
const CACHE  = 'tap2dine-v2';
const ASSETS = [
  '/static/index.html',
  '/static/style.css',
  '/static/app.js',
  '/static/admin.html',
  '/static/admin.css',
  '/static/admin.js',
  '/static/manifest.json',
  '/static/favicon.svg',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap',
];

// Install — pre-cache shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Activate — clear old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network-first for API, cache-first for static assets
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Always fetch API + WebSocket live from network
  if (url.pathname.startsWith('/api') || url.protocol === 'ws:') return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Cache fresh copy of static assets
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
