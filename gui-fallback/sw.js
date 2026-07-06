const BP_CACHE_VERSION = 'bp-fallback-v379';
const STATIC_CACHE = `${BP_CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${BP_CACHE_VERSION}-runtime`;
const PIM_EMAIL_IMAGE_CACHE = `${BP_CACHE_VERSION}-pim-email-images`;
const PIM_EMAIL_IMAGE_PATH = '/api/v1/personal/email/local/images/';

const STATIC_ASSETS = [
  './',
  './index.html',
  './favicon.svg',
  './assets/icons/fallback.svg',
  './css/tokens.css',
  './css/layout-nav.css',
  './css/active-browser-hub.css',
  './js/app.js',
  './js/app-mode-diag.js',
  './js/active-browser-hub.js',
  './js/active-browser-observer.js'
];

function isRuntimeCacheableAsset(pathname) {
  return /\.(css|js|svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf)$/i.test(pathname);
}

function isPimEmailImageRequest(url) {
  return url.pathname.startsWith(PIM_EMAIL_IMAGE_PATH);
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
        .filter(key => ![STATIC_CACHE, RUNTIME_CACHE, PIM_EMAIL_IMAGE_CACHE].includes(key))
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
  if (url.pathname.startsWith('/splash-renderer/')) {
    event.respondWith(fetch(req));
    return;
  }
  if (isPimEmailImageRequest(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(PIM_EMAIL_IMAGE_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    })());
    return;
  }
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

self.addEventListener('message', event => {
  if (event.data?.type === 'BP_SW_VERSION') {
    event.ports?.[0]?.postMessage({
      type: 'BP_SW_VERSION',
      cache_version: BP_CACHE_VERSION,
      pim_email_image_cache: PIM_EMAIL_IMAGE_CACHE,
    });
    return;
  }
  if (event.data?.type === 'BP_PIM_EMAIL_CLEAR_IMAGE_CACHE') {
    const emailUid = String(event.data.email_uid || '').trim();
    event.waitUntil((async () => {
      if (!emailUid) return;
      const cache = await caches.open(PIM_EMAIL_IMAGE_CACHE);
      const requests = await cache.keys();
      await Promise.all(requests.map(request => {
        const url = new URL(request.url);
        return url.searchParams.get('email_uid') === emailUid
          ? cache.delete(request)
          : Promise.resolve(false);
      }));
    })());
  }
});
