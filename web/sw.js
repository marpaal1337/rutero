'use strict';
/* Service worker: la web y los datos funcionan sin red una vez visitados.
   - Archivos propios: red primero (con tiempo límite) y, si falla, la copia guardada.
   - Teselas del mapa y librerías externas: copia guardada primero. */
const V = 'cims-v1', LIBS = 'cims-libs', TILES = 'cims-tiles', OFFLINE = 'cims-offline';   // OFFLINE lo rellena offline.js y nunca se purga
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'track.js', 'clusters.js', 'offline.js', '../scripts/shared.js', 'data/peaks.json', 'manifest.webmanifest', 'icon.svg'];
const TILE_URL = /^(server\.arcgisonline\.com|[a-z]\.tile\.opentopomap\.org|www\.ign\.es\/wmts|s3\.amazonaws\.com\/elevation-tiles-prod|tile\.waymarkedtrails\.org)/;   // host + ruta: el relieve (AWS) solo se distingue por la ruta
const LIB_HOST = /^(unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;
const MAX_TILES = 1500;

self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => ![V, LIBS, TILES, OFFLINE].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())));

async function trim(c) {
  const ks = await c.keys();
  await Promise.all(ks.slice(0, Math.max(0, ks.length - MAX_TILES)).map(k => c.delete(k)));
}
async function store(name, req, res) {
  if (res.ok || res.type === 'opaque') { const c = await caches.open(name); await c.put(req, res.clone()); if (name === TILES && Math.random() < 0.02) trim(c); }
  return res;
}
async function networkFirst(req) {
  try { return await store(V, req, await fetch(req, { signal: AbortSignal.timeout(5000) })); }
  catch (e) { const hit = await caches.match(req, { ignoreSearch: true }); if (hit) return hit; throw e; }
}
async function cacheFirst(name, req) {
  const hit = await caches.match(req); if (hit) return hit;
  return store(name, req, await fetch(req));
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) e.respondWith(networkFirst(req));
  else if (TILE_URL.test(u.hostname + u.pathname)) e.respondWith(cacheFirst(TILES, req));
  else if (LIB_HOST.test(u.hostname)) e.respondWith(cacheFirst(LIBS, req));
});
