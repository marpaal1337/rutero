'use strict';
/* Métricas de ruta en el navegador: mismo cálculo que scripts/cimas_lib.py + build_cimas.py (remuestreo cada 15 m,
   altitudes Terrarium z13 con interpolación bilineal como scripts/elev.py, suavizado, desnivel con umbral, Naismith).
   Los puntos van como [lon, lat]. Lo usa router.js para dar a las rutas generadas el mismo formato que data/<id>.json. */
const Metrics = (() => {
  const R = 6371008.8, rad = Math.PI / 180, TZ = 13, STEP = 15;
  const hav = (a, b) => {
    const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  function resample(pts, step = STEP) {
    const out = [pts[0]]; let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      let a = pts[i - 1]; const b = pts[i]; let d = hav(a, b);
      while (d > 0 && acc + d >= step) {
        const t = (step - acc) / d;
        a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        d = hav(a, b); acc = 0; out.push(a);
      }
      acc += d;
    }
    const last = pts[pts.length - 1], o = out[out.length - 1];
    if (o[0] !== last[0] || o[1] !== last[1]) out.push(last);
    return out;
  }
  // media móvil con ventana que se estrecha en los extremos (no sesga salida ni cumbre)
  function smooth(z, k = 5) {
    const n = z.length, out = [];
    for (let i = 0; i < n; i++) {
      const h = Math.min(k, i, n - 1 - i); let s = 0;
      for (let j = i - h; j <= i + h; j++) s += z[j];
      out.push(s / (2 * h + 1));
    }
    return out;
  }
  function gain(z, thr = 3) {
    let up = 0, dn = 0, ref = z[0];
    for (const v of z.slice(1)) {
      if (v - ref >= thr) { up += v - ref; ref = v; } else if (ref - v >= thr) { dn += ref - v; ref = v; }
    }
    return [up, dn];
  }

  /* ---- altitudes Terrarium (las mismas teselas que el relieve del mapa; el service worker las guarda) ---- */
  const tiles = new Map();
  function tile(x, y) {
    const k = x + '/' + y;
    if (!tiles.has(k)) tiles.set(k, fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TZ}/${x}/${y}.png`)
      .then(r => { if (!r.ok) throw new Error('relieve ' + r.status); return r.blob(); })
      .then(createImageBitmap)
      .then(img => {
        const c = new OffscreenCanvas(256, 256), g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const px = g.getImageData(0, 0, 256, 256).data, z = new Float32Array(256 * 256);
        for (let i = 0; i < z.length; i++) z[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
        return z;
      })
      .catch(e => { tiles.delete(k); throw e; }));
    return tiles.get(k);
  }
  async function elevations(pts) {
    const n = 2 ** TZ, pos = pts.map(([lon, lat]) => [
      (lon + 180) / 360 * n * 256 - 0.5,
      (1 - Math.asinh(Math.tan(lat * rad)) / Math.PI) / 2 * n * 256 - 0.5]);
    const need = new Set();
    pos.forEach(([fx, fy]) => { const x0 = Math.floor(fx), y0 = Math.floor(fy);
      for (const X of [x0, x0 + 1]) for (const Y of [y0, y0 + 1]) need.add((X >> 8) + '/' + (Y >> 8)); });
    const got = {};
    await Promise.all([...need].map(async k => { const [x, y] = k.split('/').map(Number); got[k] = await tile(x, y); }));
    const v = (X, Y) => got[(X >> 8) + '/' + (Y >> 8)][(Y & 255) * 256 + (X & 255)];
    return pos.map(([fx, fy]) => {
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      return Math.round((v(x0, y0) * (1 - tx) * (1 - ty) + v(x0 + 1, y0) * tx * (1 - ty) + v(x0, y0 + 1) * (1 - tx) * ty + v(x0 + 1, y0 + 1) * tx * ty) * 10) / 10;
    });
  }

  const r2 = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
  // dificultad 0-3 por esfuerzo: horas de subida más 1 h por cada km con pendiente ≥ 30 % (build_cimas.grade)
  const grade = m => { const e = m.t_up + m.steep_m / 1000; return e < 2 ? 0 : e < 3 ? 1 : e < 4 ? 2 : 3; };

  /* raw: [lon, lat] de salida a cumbre; peak: {name, lat, lon, ele}. Devuelve una ruta con los campos de data/<id>.json */
  async function build(raw, peak, extra = {}) {
    const pts = resample(raw), z = smooth(await elevations(pts));
    const dist = [0];
    for (let i = 1; i < pts.length; i++) dist.push(dist[i - 1] + hav(pts[i - 1], pts[i]));
    const [up, dn] = gain(z), L = dist[dist.length - 1];
    const sm = smooth(z.slice(1).map((v, i) => Math.abs(v - z[i]) / STEP * 100), 2);   // pendiente suavizada sobre ~75 m
    const steep = sm.filter(s => s >= 30).length * STEP;
    const m = { km: r2(L / 1000, 2), up: Math.round(up), dn: Math.round(dn), zmin: Math.round(Math.min(...z)), zmax: Math.round(Math.max(...z)),
                z0: Math.round(z[0]), avg_slope: L ? r2(up / L * 100, 1) : 0, max_slope: Math.round(Math.max(0, ...sm)), steep_m: Math.round(steep),
                t_up: r2(L / 5000 + up / 600, 2), t_dn: r2((L / 5000 + dn / 1000) * 0.8, 2) };
    return { ...extra, ...m, diff: grade(m), dem: 'Terrarium z13 (AWS)',
             wpts: [{ lon: r2(pts[0][0], 6), lat: r2(pts[0][1], 6), ele: m.z0, name: 'Inicio' },
                    { lon: peak.lon, lat: peak.lat, ele: peak.ele, name: 'Cumbre ' + peak.name }],
             pts: pts.map((p, i) => [r2(p[0], 6), r2(p[1], 6), z[i]]), dist: dist.map(d => r2(d / 1000, 3)) };
  }
  return { hav, build };
})();
