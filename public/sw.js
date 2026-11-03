const CACHE_NAME = 'nexus-shell-v0.3.1';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/nexus.svg', '/icons/nexus-192.png', '/icons/nexus-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);

    // Pre-cache the built Vite entry JS/CSS discovered from index.html so
    // the first successful visit is enough to establish the offline app shell.
    const response = await fetch('/');
    if (response.ok) {
      const html = await response.clone().text();
      await cache.put('/index.html', response.clone());
      await cache.put('/', new Response(html, { headers: response.headers, status: response.status }));
      const assetPaths = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)]
        .map((match) => new URL(match[1], self.location.origin).href)
        .filter((url) => new URL(url).origin === self.location.origin);
      await Promise.allSettled(assetPaths.map(async (url) => {
        const asset = await fetch(url);
        if (asset.ok) await cache.put(url, asset);
      }));
    }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
      }
      return response;
    }).catch(async () => (await caches.match('/index.html')) || (await caches.match('/'))));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match(request));
    })
  );
});
