// Service worker. The Python app renders __VERSION__ (asset hash) and __PRECACHE__ (URL list).
// Policy (ARCHITECTURE §10): precache everything, serve cache-first, never skipWaiting on our own.
// A new version takes over on the next cold launch, or when a parent taps "Update ready".
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `kf-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("kf-") && k !== CACHE).map((k) => caches.delete(k)))),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "skip-waiting") self.skipWaiting();
  if (event.data?.type === "version") event.ports[0]?.postMessage({ version: VERSION });
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname === "/healthz" || url.pathname === "/sw.js") return;
  if (req.mode === "navigate") {
    // The app shell is one document; serve this version's copy so assets never mix.
    event.respondWith(caches.open(CACHE).then((c) => c.match("/")).then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(caches.open(CACHE).then((c) => c.match(req)).then((hit) => hit || fetch(req)));
});
