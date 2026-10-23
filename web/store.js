'use strict';
/* Rutas generadas que el usuario guarda, solo en el dispositivo. Interfaz única (save, list, del, gpx) para que una
   versión nativa (Capacitor) pueda cambiar IndexedDB por almacenamiento del sistema sin tocar app.js.
   Una entrada es { id, peak, t, route } con route en el formato de data/<id>.json. */
const RouteStore = (() => {
  let dbp = null;
  const db = () => dbp ||= new Promise((res, rej) => {
    const q = indexedDB.open('cims-rutas', 1);   // base propia: la de tracks (track.js) tiene su propia versión
    q.onupgradeneeded = () => q.result.createObjectStore('routes', { keyPath: 'id' }).createIndex('peak', 'peak');
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  const tx = (mode, fn) => db().then(d => new Promise((res, rej) => {
    const t = d.transaction('routes', mode), r = fn(t.objectStore('routes'));
    t.oncomplete = () => res(r.result); t.onerror = () => rej(t.error);
  }));

  async function save(peak, route) {
    const e = { id: Date.now().toString(36), peak, t: Date.now(), route };
    await tx('readwrite', s => s.put(e));
    navigator.storage?.persist?.().catch(() => {});   // que el navegador no la borre al faltar espacio
    return e;
  }
  const list = peak => tx('readonly', s => s.index('peak').getAll(peak)).then(a => a.sort((x, y) => y.t - x.t));
  const del = id => tx('readwrite', s => s.delete(id));

  const x = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  function gpx(e, peakName) {
    const r = e.route, name = `${peakName} · ${r.name}`;
    const pts = r.pts.map(p => `<trkpt lat="${p[1]}" lon="${p[0]}"><ele>${p[2]}</ele></trkpt>`);
    const wpts = r.wpts.map(w => `<wpt lat="${w.lat}" lon="${w.lon}"><ele>${w.ele}</ele><name>${x(w.name)}</name></wpt>`);
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Rutero" xmlns="http://www.topografix.com/GPX/1/1">\n${wpts.join('\n')}\n<trk><name>${x(name)}</name><trkseg>\n${pts.join('\n')}\n</trkseg></trk>\n</gpx>\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'application/gpx+xml' }));
    a.download = `${e.peak}-${e.id}.gpx`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return { save, list, del, gpx };
})();
