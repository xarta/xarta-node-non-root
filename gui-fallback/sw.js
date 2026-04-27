const BP_CACHE_VERSION = 'bp-fallback-v25';
const STATIC_CACHE = `${BP_CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${BP_CACHE_VERSION}-runtime`;

const STATIC_ASSETS = [
  './',
  './index.html',
  './favicon.svg',
  './assets/icons/fallback.svg',
  './css/tokens.css',
  './css/layout-nav.css',
  './js/app.js',
  './js/app-mode-diag.js'
];

function isRuntimeCacheableAsset(pathname) {
  return /\.(css|js|svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf)$/i.test(pathname);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(STATIC_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/health') return;
  if (url.pathname.endsWith('/manifest.webmanifest') || url.pathname.endsWith('/sw.js')) {
    event.respondWith(fetch(req));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch (_) {
        return caches.match('./index.html');
      }
    })());
    return;
  }

  if (!isRuntimeCacheableAsset(url.pathname)) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req);
    const fetchPromise = fetch(req)
      .then(async fresh => {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      })
      .catch(() => cached);

    return cached || fetchPromise;
  })());
});
