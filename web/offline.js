'use strict';
/* PWA: registra el service worker y guarda el mapa de la cima abierta (satélite, mapa del IGN y relieve) para usarlo sin cobertura.
   Depende de app.js (map, ROUTES, KEYS, $). Las teselas van a la caché 'cims-offline', que el service worker no purga. */
if ('serviceWorker' in navigator && isSecureContext) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

const OFF = { zmin: 12, zmax: 15, max: 900, par: 6 };   // niveles de zoom y tope de teselas por cima
const tileXY = (lon, lat, z) => {
  const n = 2 ** z, r = lat * Math.PI / 180;
  return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * n)];
};
function offlineUrls() {
  let w = 180, s = 90, e = -180, n = -90;
  KEYS.forEach(k => ROUTES[k].pts.forEach(p => { w = Math.min(w, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }));
  const m = 0.008; w -= m; e += m; s -= m; n += m;   // ~900 m de margen
  const src = map.getStyle().sources, tpl = [src.sat.tiles[0], src.ign.tiles[0], src.dem.tiles[0]];   // Topo no: se solapa con el IGN
  for (let zmax = OFF.zmax; zmax >= OFF.zmin; zmax--) {
    const urls = [];
    for (let z = OFF.zmin; z <= zmax; z++) {
      const [x0, y0] = tileXY(w, n, z), [x1, y1] = tileXY(e, s, z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++)
        tpl.forEach(t => urls.push(t.replace('{z}', z).replace('{x}', x).replace('{y}', y)));
    }
    if (urls.length <= OFF.max || zmax === OFF.zmin) return urls;   // si la zona es enorme se baja el zoom máximo
  }
}
async function saveOffline() {
  const b = $('offBtn'), urls = offlineUrls(), c = await caches.open('cims-offline'); let done = 0, bad = 0;
  b.disabled = true;
  const next = async () => {
    while (urls.length) {
      const u = urls.pop();
      try { if (!await c.match(u)) { const r = await fetch(u); if (r.ok) await c.put(u, r); else bad++; } } catch (e) { bad++; }
      b.textContent = `Guardando… ${++done}/${done + urls.length}`;
    }
  };
  await Promise.all(Array.from({ length: OFF.par }, next));
  b.disabled = false; b.textContent = bad ? `Guardado (${bad} fallos)` : 'Guardado ✓';
  setTimeout(() => { b.textContent = 'Guardar mapa offline'; }, 4000);
}
if ('caches' in window && isSecureContext) $('offBtn').onclick = () => saveOffline().catch(() => { $('offBtn').disabled = false; $('offBtn').textContent = 'No se pudo guardar'; });
else $('offBtn').hidden = true;

const topoBtn = document.querySelector('#base [data-b="topo"]');
const netBase = () => {   // Topo no se guarda offline: sin red se pasa a IGN y se desactiva
  topoBtn.disabled = !navigator.onLine;
  if (!navigator.onLine && topoBtn.getAttribute('aria-pressed') === 'true') document.querySelector('#base [data-b="ign"]').click();
};
addEventListener('offline', netBase); addEventListener('online', netBase); netBase();
