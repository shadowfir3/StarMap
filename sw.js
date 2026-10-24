// Offline cache for the star map.  Every file the page needs is precached on
// install and served cache-first afterwards, so an installed home-screen app
// starts without a network connection.  Increment CACHE_VERSION whenever any
// precached file changes; the new worker replaces the old cache on activation.
const CACHE_VERSION = "starmap-2026-10-24b";
const PRECACHE_URLS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "data/stars.js",
  "data/nebulae.js",
  "data/galaxy.js",
  "data/star-types.js",
  "manifest.json",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_URLS.map(url => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => cached || fetch(request).catch(() => {
      if (request.mode === "navigate") return caches.match("index.html");
      return Response.error();
    })),
  );
});
