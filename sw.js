// sw.js — vanilla service worker, no third-party libs
const CACHE_NAME = 'tibicobzaru-v1';

// Core shell assets, cached on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/css/theme-toggle.css',
  '/img/logo.jpg',
  '/manifest.json'
];

// Don't try to cache/intercept these (analytics, cross-origin fonts, etc.)
const IGNORE_PATTERNS = [
  /googletagmanager\.com/,
  /google-analytics\.com/,
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests, same-origin, and skip ignored third-party URLs
  if (request.method !== 'GET') return;
  if (IGNORE_PATTERNS.some((pattern) => pattern.test(request.url))) return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // HTML pages: network-first, so visitors always get fresh content when online,
  // falling back to cache when offline.
  if (isSameOrigin && request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Everything else same-origin (css, images, fonts, scripts): cache-first,
  // falling back to network and caching the result for next time.
  if (isSameOrigin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
  }
});
