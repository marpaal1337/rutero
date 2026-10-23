'use strict';
/* Rutas al vuelo desde un punto de salida hasta la cumbre, sin servidor propio.
   1º BRouter (brouter.de, perfil hiking-mountain primando senderos señalizados).
   2º si no responde: sendas de OpenStreetMap vía Overpass + Dijkstra en el navegador (port de scripts/cimas_lib.py).
   Las métricas y altitudes salen de metrics.js, igual para ambos motores. Puntos [lon, lat]. */
const Router = (() => {
  const MAX_KM = 15;   // salida a más distancia en línea recta de la cumbre: no es una ruta a pie
  const BROUTER = 'https://brouter.de/brouter';
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];   // públicos y lentos: dos intentos como mucho
  // mismos pesos que cimas_lib.PEN / MARKED_BONUS
  const PEN = { path: 1.0, track: 1.1, footway: 1.1, steps: 1.3, bridleway: 1.1, service: 1.8, unclassified: 2.5, tertiary: 4, tertiary_link: 4, residential: 3 };
  const MARKED_BONUS = 0.6;
  const hav = Metrics.hav;

  /* ---------- BRouter ---------- */
  async function brouter(a, b) {
    const q = `lonlats=${a[0].toFixed(6)},${a[1].toFixed(6)}|${b[0].toFixed(6)},${b[1].toFixed(6)}` +
              '&profile=hiking-mountain&alternativeidx=0&format=geojson&profile:hiking_routes_preference=0.67';
    const r = await fetch(`${BROUTER}?${q}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('BRouter ' + r.status + ': ' + (await r.text()).slice(0, 120));
    const f = (await r.json()).features[0], msg = f.properties.messages || [];
    // messages: una fila por tramo con su longitud y etiquetas OSM; route_hiking_* = vía de una ruta de senderismo
    let tot = 0, marked = 0;
    if (msg.length > 1) {
      const iD = msg[0].indexOf('Distance'), iW = msg[0].indexOf('WayTags');
      msg.slice(1).forEach(row => { const d = +row[iD] || 0; tot += d; if (/route_hiking_|route_foot_/.test(row[iW])) marked += d; });
    }
    return { raw: f.geometry.coordinates.map(c => [c[0], c[1]]), marked_pct: tot ? Math.round(marked / tot * 100) : undefined, engine: 'BRouter' };
  }

  /* ---------- Overpass + Dijkstra ---------- */
  async function overpass(query) {
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(70000) });
        if (r.ok) return await r.json();
        console.warn('Overpass', url, r.status);
      } catch (e) { console.warn('Overpass', url, e); }
    }
    throw new Error('ni BRouter ni OpenStreetMap (Overpass) responden; prueba en unos minutos');
  }
  function buildGraph(osm) {
    const marked = new Map();   // id de vía → códigos GR/PR/SL
    osm.elements.forEach(e => {
      const ref = e.type === 'relation' && e.tags?.ref || '';
      if (!/^(GR|PR|SL)\b/.test(ref)) return;   // solo senderos homologados
      e.members.forEach(m => { if (m.type === 'way') (marked.get(m.ref) || marked.set(m.ref, new Set()).get(m.ref)).add(ref); });
    });
    const adj = new Map(), pos = new Map();
    osm.elements.forEach(e => {
      if (e.type !== 'way' || !e.geometry) return;
      let pen = PEN[e.tags?.highway];
      if (pen === undefined) return;
      if (marked.has(e.id)) pen *= MARKED_BONUS;
      e.nodes.forEach((n, i) => pos.set(n, [e.geometry[i].lon, e.geometry[i].lat]));
      for (let i = 1; i < e.nodes.length; i++) {
        const a = e.nodes[i - 1], b = e.nodes[i], L = hav(pos.get(a), pos.get(b));
        for (const [u, v] of [[a, b], [b, a]]) {
          if (!adj.has(u)) adj.set(u, new Map());
          const old = adj.get(u).get(v);
          if (!old || old[0] > L * pen) adj.get(u).set(v, [L * pen, L, e.id]);
        }
      }
    });
    return { adj, pos, marked };
  }
  function nearest(g, p) {
    let best = null, bd = Infinity;
    for (const n of g.adj.keys()) { const d = hav(g.pos.get(n), p); if (d < bd) { bd = d; best = n; } }
    return [best, bd];
  }
  function dijkstra(adj, src, dst) {
    const dist = new Map([[src, 0]]), prev = new Map(), heap = [[0, src]];
    const push = x => { heap.push(x); let i = heap.length - 1;
      while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; let i = 0;
        for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
      return top; };
    while (heap.length) {
      const [d, u] = pop();
      if (u === dst) break;
      if (d > (dist.get(u) ?? Infinity)) continue;
      for (const [v, [w]] of adj.get(u)) if (d + w < (dist.get(v) ?? Infinity)) { dist.set(v, d + w); prev.set(v, u); push([d + w, v]); }
    }
    if (!dist.has(dst)) throw new Error('No hay camino por sendas entre la salida y la cumbre');
    const path = [dst];
    while (path[path.length - 1] !== src) path.push(prev.get(path[path.length - 1]));
    return path.reverse();
  }
  async function osmRoute(a, b) {
    const m = 0.015;   // ~1,5 km de margen alrededor de salida y cumbre
    const bb = [Math.min(a[1], b[1]) - m, Math.min(a[0], b[0]) - m, Math.max(a[1], b[1]) + m, Math.max(a[0], b[0]) + m].map(v => v.toFixed(5)).join(',');
    const osm = await overpass(`[out:json][timeout:60];
(way["highway"~"^(path|track|footway|steps|bridleway|service|unclassified|tertiary|tertiary_link|residential)$"](${bb}););
out geom;
(relation["route"~"^(hiking|foot)$"](${bb}););
out body;`);
    const g = buildGraph(osm);
    if (!g.adj.size) throw new Error('No hay sendas en OpenStreetMap en esta zona');
    const [na, da] = nearest(g, a), [nb] = nearest(g, b), nodes = dijkstra(g.adj, na, nb);
    let tot = 0, mk = 0; const per = new Map();
    for (let i = 1; i < nodes.length; i++) {
      const [, ln, wid] = g.adj.get(nodes[i - 1]).get(nodes[i]), refs = g.marked.get(wid);
      tot += ln;
      if (refs) { mk += ln; refs.forEach(r => per.set(r, (per.get(r) || 0) + ln)); }
    }
    const top = [...per].sort((x, y) => y[1] - x[1]).filter(([, l]) => tot && l / tot >= 0.15).map(([r]) => r);
    return { raw: nodes.map(n => g.pos.get(n)), marked_pct: tot ? Math.round(mk / tot * 100) : 0, marked: top.slice(0, 2).join(' + ') || undefined,
             engine: 'OpenStreetMap (Overpass)', offNet: da };
  }

  /* start [lon, lat]; peak: entrada de peaks.json; say(texto) informa del progreso.
     Devuelve una ruta lista para app.js (id 'X', generated: true) */
  async function plan(start, peak, name, say = () => {}) {
    const summit = [peak.lon, peak.lat], d = hav(start, summit) / 1000;
    if (d > MAX_KM) throw new Error(`La salida está a ${d.toFixed(0)} km de la cumbre: marca un punto a menos de ${MAX_KM} km`);
    let res;
    try { res = await brouter(start, summit); }
    catch (e) {
      console.warn('BRouter no disponible, uso Overpass:', e);
      say('BRouter no responde; calculando sobre las sendas de OpenStreetMap (puede tardar un minuto)…');
      res = await osmRoute(start, summit);
    }
    const r = await Metrics.build(res.raw, peak, { id: 'X', name, generated: true, engine: res.engine, marked_pct: res.marked_pct, marked: res.marked });
    // la ruta empieza donde el motor engancha con la red: si queda lejos del punto marcado, avisar
    const gap = res.offNet ?? hav(start, res.raw[0]);
    if (gap > 150) r.warn = ['lejos_red'];
    return r;
  }
  return { plan };
})();
