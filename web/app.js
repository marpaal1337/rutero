'use strict';
/* Un solo mapa 3D: vista regional con la lista de cimas y, al elegir una, sus rutas (visor 3D) sin salir del mapa.
   Depende de ../scripts/shared.js (sol, color por pendiente). Datos: data/peaks.json y data/<id>.json (scripts/build_cimas.py). */
const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const routeColor = k => css('--r' + k);
const fmtH = h => Math.floor(h) + ' h ' + String(Math.round((h % 1) * 60)).padStart(2, '0');
const narrow = () => innerWidth <= 820;
function store(key, val) {   // preferencias por navegador; la página funciona igual sin esto
  try { if (val === undefined) return JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; }
}
const doneSet = () => new Set(store('cims:done') || []);
const TIERS = { emblematica: 'Emblemática', destacada: 'Destacada', local: 'Local' }, TIER_RANK = { emblematica: 0, destacada: 1, local: 2 };
const GRADES = ['Fácil', 'Moderada', 'Exigente', 'Dura'];
const badges = p => `<span class="bd t-${p.tier}">${TIERS[p.tier]}</span><span class="bd g-${p.diff}">${GRADES[p.diff]}</span>`;

let PEAKS = [], P = null, ROUTES = {}, KEYS = [], cur = 'A', markers = [], hoverMk = null, flying = null, sat = true;
let clusters = null;
const filt = { q: '', prov: null, tier: null, diff: null, sort: 'ele' }, cache = {};

/* ====================== mapa ====================== */
const map = new maplibregl.Map({
  container: 'map', center: [-0.4, 39.3], zoom: 6.4, pitch: 45, maxPitch: 85, attributionControl: { compact: true },
  style: { version: 8, sources: {
    sat: { type: 'raster', tileSize: 256, maxzoom: 19, attribution: 'Esri World Imagery',
           tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
    topo: { type: 'raster', tileSize: 256, maxzoom: 17, attribution: '© OpenTopoMap (CC-BY-SA), © OpenStreetMap',
            tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png'] },
    ign: { type: 'raster', tileSize: 256, maxzoom: 17, attribution: '© Instituto Geográfico Nacional de España (CC BY 4.0)',
           tiles: ['https://www.ign.es/wmts/mapa-raster?service=WMTS&request=GetTile&version=1.0.0&layer=MTN&style=default&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}&format=image/jpeg'] },
    wmt: { type: 'raster', tileSize: 256, maxzoom: 18, attribution: 'Rutas © Waymarked Trails (CC BY-SA), © OpenStreetMap',
           tiles: ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'] },
    dem: { type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'AWS Terrain Tiles',
           tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'] }
  }, layers: [
    { id: 'sat', type: 'raster', source: 'sat' },
    { id: 'topo', type: 'raster', source: 'topo', layout: { visibility: 'none' } },
    { id: 'ign', type: 'raster', source: 'ign', layout: { visibility: 'none' } },
    { id: 'wmt', type: 'raster', source: 'wmt', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85 } },
    { id: 'hill', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.25 } }
  ], terrain: { source: 'dem', exaggeration: 1 } }
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }));
// 'load' espera a las teselas; basta con que el estilo esté cargado para poder añadir capas
const styleReady = new Promise(res => { const f = () => res(); map.once('style.load', f); map.once('styledata', f); map.once('load', f); });

function pad() {
  return narrow() ? { top: 50, bottom: $('side').offsetHeight + 30, left: 24, right: 24 } : { top: 60, bottom: 60, left: 440, right: 60 };
}
function fitHome(duration) {
  const b = new maplibregl.LngLatBounds();
  PEAKS.forEach(p => b.extend([p.lon, p.lat]));
  map.fitBounds(b, { padding: pad(), maxZoom: 9, pitch: 45, bearing: 0, duration });
}
function frameAll(duration) {
  const all = new maplibregl.LngLatBounds();
  KEYS.forEach(k => ROUTES[k].pts.forEach(p => all.extend([p[0], p[1]])));
  // fitBounds ignora la perspectiva con la cámara inclinada y deja las rutas fuera de pantalla: se calcula la cámara y se aleja un poco
  const p = pad(), cam = map.cameraForBounds(all, { padding: p, bearing: -20 });
  // el padding de easeTo coloca el centro en la zona libre (fuera del panel) aunque la cámara esté inclinada
  map.easeTo({ center: cam.center, zoom: cam.zoom - (narrow() ? 0.7 : 0.4), pitch: 60, bearing: -20, duration, padding: p });
}

/* ====================== lista y marcadores de cimas ====================== */
const nearest = p => p.routes.reduce((m, r) => Math.min(m, r.drive ? r.drive.min : Infinity), Infinity);
function renderList() {
  const done = doneSet(), q = filt.q.trim().toLowerCase();
  let ps = PEAKS.filter(p => (!filt.prov || p.prov === filt.prov) && (!filt.tier || p.tier === filt.tier) && (filt.diff === null || p.diff === filt.diff) && (!q || (p.name + ' ' + p.comarca + ' ' + p.prov).toLowerCase().includes(q)));
  ps = ps.sort(filt.sort === 'ele' ? (a, b) => b.ele - a.ele : filt.sort === 'tier' ? (a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.ele - a.ele : (a, b) => nearest(a) - nearest(b));
  const emb = PEAKS.filter(p => p.tier === 'emblematica');
  $('count').textContent = `${ps.length} de ${PEAKS.length} · ${done.size} hechas · emblemáticas ${emb.filter(p => done.has(p.id)).length}/${emb.length}`;
  $('list').innerHTML = ps.map(p => {
    const drv = nearest(p), km = p.routes.map(r => r.km.toFixed(1)).join(' · ');
    return `<li><a href="#/cima/${p.id}" data-id="${p.id}"><span class="n">${done.has(p.id) ? '<span class="done">★</span> ' : ''}${esc(p.name)}</span><span class="e">${p.ele} m</span>
      <span class="s">${badges(p)}${esc(p.comarca)} · ${p.routes.length} rutas${km ? ` (${km} km)` : ''}${drv < Infinity ? ` · ${drv} min desde Valencia` : ''}</span></a></li>`;
  }).join('');
  clusters?.setFilter(new Set(ps.map(p => p.id)));
  $('list').querySelectorAll('a').forEach(a => {
    a.onmouseenter = () => clusters?.highlight(a.dataset.id, true);
    a.onmouseleave = () => clusters?.highlight(a.dataset.id, false);
  });
}
function addPeakMarkers() {
  const done = doneSet();
  clusters = new PeakClusters(map, PEAKS, {
    createPin: p => {
      const el = document.createElement('button');
      el.className = 'peak-pin t-' + p.tier + (done.has(p.id) ? ' done' : '');
      el.innerHTML = `<span><b>${esc(p.name)}</b>${p.ele}</span><i></i>`;
      el.dataset.label = `${p.name}, ${p.ele} metros`;
      return el;
    },
    createCluster: g => {   // g va de mayor a menor altura: el nombre del grupo es el de su cima más alta
      const el = document.createElement('button');
      el.className = 'peak-cluster' + (g.every(p => done.has(p.id)) ? ' done' : '');
      el.innerHTML = `<span><b>${esc(g[0].name)}</b>+${g.length - 1}</span><i>${g.length}</i>`;
      el.dataset.label = `${g.length} cimas: ${g.map(p => p.name).join(', ')}. Pulsa para acercar`;
      return el;
    },
    onSelect: p => { location.hash = '#/cima/' + p.id; },
    padding: pad
  });
}
document.querySelectorAll('.chip[data-prov]').forEach(b => b.onclick = () => {
  filt.prov = filt.prov === b.dataset.prov ? null : b.dataset.prov;
  document.querySelectorAll('.chip[data-prov]').forEach(o => o.setAttribute('aria-pressed', o.dataset.prov === filt.prov));
  renderList();
});
document.querySelectorAll('.chip[data-tier]').forEach(b => b.onclick = () => {
  filt.tier = filt.tier === b.dataset.tier ? null : b.dataset.tier;
  document.querySelectorAll('.chip[data-tier]').forEach(o => o.setAttribute('aria-pressed', o.dataset.tier === filt.tier));
  renderList();
});
document.querySelectorAll('.chip[data-diff]').forEach(b => b.onclick = () => {
  const d = +b.dataset.diff;
  filt.diff = filt.diff === d ? null : d;
  document.querySelectorAll('.chip[data-diff]').forEach(o => o.setAttribute('aria-pressed', +o.dataset.diff === filt.diff));
  renderList();
});
const SORTS = { ele: 'Orden: altura', tier: 'Orden: relevancia', drive: 'Orden: cercanía a Valencia' }, SORT_NEXT = { ele: 'tier', tier: 'drive', drive: 'ele' };
$('sortBtn').onclick = () => {
  filt.sort = SORT_NEXT[filt.sort];
  $('sortBtn').textContent = SORTS[filt.sort];
  renderList();
};
$('q').oninput = e => { filt.q = e.target.value; renderList(); };

/* ====================== rutas de la cima activa ====================== */
const geo = k => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: ROUTES[k].pts } });
function pin(color, label) {
  const el = document.createElement('div'); el.className = 'pin';
  if (label) { const l = document.createElement('span'); l.className = 'lbl'; l.textContent = label; el.appendChild(l); }
  const d = document.createElement('i'); d.style.setProperty('--d', color); el.appendChild(d);
  return el;
}
function addRoutes() {
  KEYS.forEach(k => {
    map.addSource('trk-' + k, { type: 'geojson', data: geo(k), lineMetrics: true });
    map.addLayer({ id: 'case-' + k, type: 'line', source: 'trk-' + k, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 7 } });
    map.addLayer({ id: 'line-' + k, type: 'line', source: 'trk-' + k, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': routeColor(k), 'line-width': 4 } });
  });
  if (typeof Track !== 'undefined') Track.raise();   // mi track y mi posición por encima de las rutas
}
function removeRoutes() {
  KEYS.forEach(k => {
    ['line-', 'case-'].forEach(p => { if (map.getLayer(p + k)) map.removeLayer(p + k); });
    if (map.getSource('trk-' + k)) map.removeSource('trk-' + k);
  });
  markers.forEach(m => m.remove()); markers = [];
  if (hoverMk) { hoverMk.remove(); hoverMk = null; }
}

// hora límite de salida para volver con luz: puesta de sol − subida − bajada − 30 min de margen (Naismith no cuenta paradas)
function lastStart(r) {
  const h = SUN_RISE_SET.set - r.t_up - r.t_dn - 0.5;
  return h < SUN_RISE_SET.rise ? 'Sin luz' : fmtClock(h);
}
function select(k) {
  stopFly(); cur = k;
  const r = ROUTES[k];
  document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === k));
  $('name').textContent = r.name + (r.marked ? ' · ' + r.marked : '') + (r.warn?.length ? ' · ⚠ salida por revisar' : '');
  $('stats').innerHTML = [
    ['Distancia', String(r.km).replace('.', ',') + ' km'], ['Desnivel', '+' + r.up + ' m'], ['Cima', P.ele + ' m'],
    ['Subida', fmtH(r.t_up)], ['Bajada', fmtH(r.t_dn)], ['Dificultad', GRADES[r.diff]],
    ['Puesta de sol', fmtClock(SUN_RISE_SET.set)], ['Salir antes de', lastStart(r)]
  ].map(([l, v]) => `<div><dt>${l}</dt><dd>${v}</dd></div>`).join('');
  KEYS.forEach(j => {
    const on = j === k;
    map.setPaintProperty('line-' + j, 'line-width', on ? 5.5 : 3);
    map.setPaintProperty('line-' + j, 'line-opacity', on ? 1 : 0.75);
    map.setPaintProperty('case-' + j, 'line-width', on ? 9 : 5);
    map.setPaintProperty('case-' + j, 'line-opacity', on ? 1 : 0.6);
  });
  map.moveLayer('case-' + k); map.moveLayer('line-' + k);
  applyColor();
  markers.forEach(m => m.remove()); markers = [];
  r.wpts.forEach(w => {
    const start = w.name.startsWith('Inicio');
    markers.push(new maplibregl.Marker({ element: pin(start ? '#2f9e44' : '#e03131', (start ? 'Salida' : 'Cumbre') + ' · ' + Math.round(w.ele) + ' m'), anchor: 'bottom' })
      .setLngLat([w.lon, w.lat]).addTo(map));
  });
  if (hoverMk) hoverMk.remove();
  hoverMk = new maplibregl.Marker({ element: pin(routeColor(k)) }).setLngLat([r.pts[0][0], r.pts[0][1]]);
  drawProfile();
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) select(b.dataset.k); });
$('moreBtn').addEventListener('click', () => {
  const c = $('peakView').classList.toggle('compact');
  $('moreBtn').setAttribute('aria-expanded', !c);
});

/* ---- móvil: hoja plegable y popover de capas ---- */
function setSheet(min) {
  $('side').classList.toggle('min', min);
  $('sheetBtn').setAttribute('aria-expanded', !min);
  $('sheetBtn').setAttribute('aria-label', min ? 'Desplegar panel' : 'Plegar panel');
  map.easeTo({ padding: pad(), duration: 250 });
}
$('sheetBtn').addEventListener('click', () => setSheet(!$('side').classList.contains('min')));
function setCtl(open) { $('mapctl').classList.toggle('open', open); $('ctlBtn').setAttribute('aria-expanded', open); }
$('ctlBtn').addEventListener('click', () => setCtl(!$('mapctl').classList.contains('open')));
document.addEventListener('pointerdown', e => { if (!e.target.closest('#mapctl')) setCtl(false); });

/* ---- comparativa ---- */
const METRICS = [
  ['Distancia', r => r.km, v => v.toFixed(1) + ' km', 'min'],
  ['Desnivel +', r => r.up, v => '+' + v + ' m', 'min'],
  ['Pend. media', r => r.avg_slope, v => v.toFixed(0) + ' %', 'min'],
  ['Pend. máx', r => r.max_slope, v => v + ' %', 'min'],
  ['Tramos > 30 %', r => r.steep_m, v => v ? v + ' m' : '—', 'min'],
  ['Dificultad', r => r.diff, v => GRADES[v], 'min'],
  ['Subida', r => r.t_up, fmtH, 'min'],
  ['Bajada', r => r.t_dn, fmtH, 'min'],
  ['Altitud salida', r => r.z0, v => v + ' m', null],
  ['Coche desde VLC', r => r.drive ? r.drive.min : null, v => v + ' min', 'min'],
  ['Señalizada', r => r.marked_pct !== undefined ? r.marked_pct : null, v => v + ' %', 'max'],
];
function renderTable() {
  const rs = KEYS.map(k => ROUTES[k]);
  const head = `<thead><tr><th></th>${rs.map(r => `<th style="--c:var(--r${r.id})">${r.id}</th>`).join('')}</tr></thead>`;
  const body = METRICS.map(([label, get, fmt, rule]) => {
    const vals = rs.map(get), nums = vals.filter(v => typeof v === 'number');
    const bestV = rule && nums.length > 1 && new Set(nums).size > 1 ? Math[rule](...nums) : null;
    return `<tr><td>${label}</td>${vals.map(v => `<td class="mono${bestV !== null && v === bestV ? ' best' : ''}">${v === null || v === undefined ? '—' : fmt(v)}</td>`).join('')}</tr>`;
  }).join('');
  $('cmp').innerHTML = head + `<tbody>${body}</tbody>`;
}

/* ---- perfil de elevación ---- */
const tip = $('tip'), box = $('svgbox'), M = { l: 44, r: 16, t: 14, b: 22 };
let PR = null;
function drawProfile() {
  const w = box.clientWidth, h = box.clientHeight;
  if (!w || !h || !KEYS.length) return;
  const all = Object.values(ROUTES), KM = Math.max(...all.map(r => r.total));
  const zs = all.flatMap(r => r.pts.map(p => p[2]));
  const zstep = Math.max(...zs) - Math.min(...zs) > 600 ? 250 : 100;
  const zmin = Math.floor(Math.min(...zs) / zstep) * zstep, zmax = Math.ceil(Math.max(...zs) / zstep) * zstep;
  const x = d => M.l + d / KM * (w - M.l - M.r), y = z => M.t + (1 - (z - zmin) / (zmax - zmin)) * (h - M.t - M.b);
  const line = r => r.pts.map((p, i) => `${i ? 'L' : 'M'}${x(r.dist[i]).toFixed(1)},${y(p[2]).toFixed(1)}`).join('');
  let g = '';
  for (let z = zmin; z <= zmax; z += zstep) g += `<line x1="${M.l}" x2="${w - M.r}" y1="${y(z)}" y2="${y(z)}" stroke="var(--line)"/><text class="ax" x="${M.l - 6}" y="${y(z) + 3}" text-anchor="end">${z}</text>`;
  for (let d = 0; d <= KM; d += KM > 8 ? 2 : 1) g += `<text class="ax" x="${x(d)}" y="${h - 6}" text-anchor="middle">${d} km</text>`;
  const order = KEYS.filter(k => k !== cur).concat(cur);
  const paths = order.map(k => {
    const r = ROUTES[k], on = k === cur, c = `var(--r${k})`;
    return (on ? `<path d="${line(r)}L${x(r.total)},${y(zmin)}L${x(0)},${y(zmin)}Z" fill="${c}" opacity=".18"/>` : '') +
      `<path d="${line(r)}" fill="none" stroke="${c}" stroke-width="${on ? 2.5 : 1.5}" opacity="${on ? 1 : .55}" stroke-linejoin="round"/>`;
  }).join('');
  box.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Perfil de elevación de las rutas">${g}${paths}
    <line id="cl" y1="${M.t}" y2="${h - M.b}" stroke="var(--fg)" stroke-dasharray="3 3" style="display:none"/>
    <circle id="cc" r="5" fill="var(--panel)" stroke="var(--r${cur})" stroke-width="3" style="display:none"/></svg>`;
  PR = { x, y, KM, w };
}
function at(d) {
  const r = ROUTES[cur]; let i = 1;
  while (i < r.dist.length - 1 && r.dist[i] < d) i++;
  const t = (d - r.dist[i - 1]) / ((r.dist[i] - r.dist[i - 1]) || 1), a = r.pts[i - 1], b = r.pts[i];
  return { lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, ele: a[2] + (b[2] - a[2]) * t,
           slope: (b[2] - a[2]) / (((r.dist[i] - r.dist[i - 1]) * 1000) || 1) * 100 };
}
function showAt(d) {
  const p = at(d), x = PR.x(d), cl = $('cl'), cc = $('cc');
  if (cl) { cl.setAttribute('x1', x); cl.setAttribute('x2', x); cl.style.display = ''; }
  if (cc) { cc.setAttribute('cx', x); cc.setAttribute('cy', PR.y(p.ele)); cc.style.display = ''; }
  hoverMk.setLngLat([p.lon, p.lat]).addTo(map);
  tip.style.display = 'block'; tip.style.left = Math.min(Math.max(x, 70), PR.w - 70) + 'px';
  tip.textContent = `${d.toFixed(2).replace('.', ',')} km · ${Math.round(p.ele)} m · ${Math.round(p.slope)} %`;
}
function hideAt() {
  tip.style.display = 'none';
  ['cl', 'cc'].forEach(id => { const e = $(id); if (e) e.style.display = 'none'; });
  if (hoverMk) hoverMk.remove();
}
function onMove(e) {
  if (flying || !PR || !ROUTES[cur]) return;
  const rect = box.getBoundingClientRect(), d = (e.clientX - rect.left - M.l) / (PR.w - M.l - M.r) * PR.KM;
  if (d >= 0 && d <= ROUTES[cur].total) showAt(d); else hideAt();
}
box.addEventListener('pointermove', onMove);
box.addEventListener('pointerdown', onMove);
box.addEventListener('pointerleave', () => { if (!flying) hideAt(); });
new ResizeObserver(drawProfile).observe(box);

/* ---- sobrevuelo ---- */
const flyBtn = $('fly');
function stopFly() { if (flying) cancelAnimationFrame(flying.raf); flying = null; flyBtn.textContent = 'Sobrevuelo'; hideAt(); }
flyBtn.addEventListener('click', () => {
  if (flying) return stopFly();
  const total = ROUTES[cur].total, dur = 45000;
  flyBtn.textContent = 'Parar'; let t0 = null, bearing = map.getBearing();
  const step = ts => {
    if (t0 === null) t0 = ts;
    const f = Math.min((ts - t0) / dur, 1), d = f * total, p = at(d), q = at(Math.min(d + 0.25, total));
    const target = Math.atan2(q.lon - p.lon, q.lat - p.lat) * 180 / Math.PI;
    bearing += (((target - bearing + 540) % 360) - 180) * 0.03;
    map.jumpTo({ center: [p.lon, p.lat], bearing, pitch: 68, zoom: 15.2 });
    showAt(d);
    if (f < 1) flying.raf = requestAnimationFrame(step); else stopFly();
  };
  flying = { raf: requestAnimationFrame(step) };
});
map.on('mousedown', () => { if (flying) stopFly(); });
map.on('touchstart', () => { if (flying) stopFly(); });
$('frame').addEventListener('click', () => { stopFly(); frameAll(1200); });

/* ---- color del track: siempre por pendiente en la ruta activa ---- */
$('lgbar').style.background = LEGEND_CSS;
function applyColor() {
  KEYS.forEach(j => {
    const l = 'line-' + j;
    if (!map.getLayer(l)) return;
    if (j === cur) {
      const r = ROUTES[j], N = 120, st = [];
      for (let i = 0; i <= N; i++) st.push(i / N, slopeHex(slopeAtDist(r, i / N * r.total)));
      map.setPaintProperty(l, 'line-gradient', ['interpolate', ['linear'], ['line-progress'], ...st]);
    } else map.setPaintProperty(l, 'line-gradient', null);
  });
}

/* ---- sol y mapa base: controles del mapa, activos en la vista regional y en la de cada cima ---- */
const REGION = [39.3, -0.4];   // centro aproximado de la Comunitat Valenciana para calcular el sol en la vista regional
function setSun(h) {
  $('hourv').textContent = fmtClock(h); $('sunnfo').textContent = sunInfo(h);
  if (!map.getLayer('hill')) return;
  const s = sunPos(h), k = Math.min(Math.max((s.el + 3) / 10, 0), 1);
  map.setPaintProperty('hill', 'hillshade-illumination-anchor', 'map');
  map.setPaintProperty('hill', 'hillshade-illumination-direction', s.az);
  map.setPaintProperty('hill', 'hillshade-exaggeration', 0.9 - 0.55 * Math.min(Math.max(s.el, 0), 45) / 45);
  ['sat', 'topo', 'ign'].forEach(l => map.setPaintProperty(l, 'raster-brightness-max', 0.3 + 0.7 * k));
}
function sunAt(lat, lon) { setSunLocation(lat, lon); setSun(+$('hour').value); }   // fecha de hoy en la ubicación dada
$('hour').addEventListener('input', e => setSun(+e.target.value));

$('base').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  sat = b.dataset.b === 'sat';
  ['sat', 'topo', 'ign'].forEach(l => map.setLayoutProperty(l, 'visibility', l === b.dataset.b ? 'visible' : 'none'));
  document.querySelectorAll('#base button').forEach(o => o.setAttribute('aria-pressed', o === b));
});
$('wmtOn').addEventListener('change', e => {
  map.setLayoutProperty('wmt', 'visibility', e.target.checked ? 'visible' : 'none'); store('cims:wmt', e.target.checked);
});
if (store('cims:wmt')) { $('wmtOn').checked = true; styleReady.then(() => map.setLayoutProperty('wmt', 'visibility', 'visible')); }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  KEYS.forEach(k => { if (map.getLayer('line-' + k)) map.setPaintProperty('line-' + k, 'line-color', routeColor(k)); });
  if (hoverMk && cur) hoverMk.getElement().firstChild.style.setProperty('--d', routeColor(cur));
});
function syncDone() {
  const d = P && doneSet().has(P.id);
  $('doneBtn').setAttribute('aria-pressed', !!d);
  $('doneBtn').textContent = d ? '★ Hecha' : '☆ Hecha';
}
$('doneBtn').onclick = () => {
  const s = doneSet(); s.has(P.id) ? s.delete(P.id) : s.add(P.id);
  store('cims:done', [...s]); syncDone();
  renderList(); clusters.refresh();
};
$('back').onclick = () => { location.hash = '#/'; };

/* ====================== vistas ====================== */
function showHome() {
  stopFly(); removeRoutes();
  P = null; ROUTES = {}; KEYS = [];
  document.body.classList.remove('in-peak');
  clusters?.setEnabled(true);
  $('listView').hidden = false; $('peakView').hidden = true; $('prof').hidden = true;
  document.title = 'Cims valencians · rutas en 3D';
  sunAt(...REGION); renderList();
  fitHome(1800);
}
async function showPeak(id) {
  const peak = PEAKS.find(p => p.id === id);
  if (!peak) { location.hash = '#/'; return; }
  if (P && P.id === id) { frameAll(1200); return; }
  const res = await (cache[id] ||= fetch(`data/${id}.json`).then(r => r.json()));
  if (!location.hash.endsWith(id)) return;   // el usuario ya ha cambiado de vista mientras cargaba
  stopFly(); removeRoutes();
  P = res; ROUTES = {}; KEYS = [];
  P.routes.forEach(r => { r.total = r.dist[r.dist.length - 1]; ROUTES[r.id] = r; KEYS.push(r.id); });
  KEYS.sort();
  document.body.classList.add('in-peak');
  clusters?.setEnabled(false);
  $('listView').hidden = true; $('peakView').hidden = false; $('prof').hidden = false;
  document.title = `${P.name} · Cims valencians`;
  $('pname').textContent = P.name;
  $('psub').innerHTML = `${P.ele} m · ${esc(P.comarca)} · ${esc(P.prov)}<br>${badges(peak)}${peak.prom ? `<span class="mut">prominencia ${peak.prom >= 200 && P.prom_min ? '≥ ' : ''}${peak.prom} m</span>` : ''}`;
  $('tabs').innerHTML = KEYS.map(k => `<button class="tab" type="button" data-k="${k}" style="--c:var(--r${k})" aria-pressed="false"><b>Ruta ${k}</b><span>${String(ROUTES[k].km).replace('.', ',')} km</span></button>`).join('');
  $('note').textContent = `Rutas calculadas sobre OpenStreetMap (pesan más las sendas PR/GR/SL) y altitudes ${P.routes[0].dem || 'EU-DEM 25 m'}: no son grabaciones GPS. Tiempos con Naismith, sin paradas. Contrasta con el estado real de la senda.`;
  syncDone(); renderTable();
  sunAt(P.lat, P.lon);
  addRoutes(); select(KEYS[0]);
  frameAll(2400);
}
async function route() {
  const m = location.hash.match(/^#\/cima\/([\w-]+)/);
  await styleReady;
  if (m) await showPeak(m[1]); else showHome();
}
addEventListener('hashchange', route);
if (narrow()) { $('peakView').classList.add('compact'); $('moreBtn').setAttribute('aria-expanded', 'false'); }

fetch('data/peaks.json').then(r => r.json()).then(async d => {
  PEAKS = d; addPeakMarkers(); renderList();
  await styleReady;
  sunAt(...REGION); fitHome(0);
  if (/^#\/cima\//.test(location.hash)) route();
}).catch(() => { $('listView').innerHTML = '<p style="padding:1rem">No se pudieron cargar los datos. Sirve la raíz del repositorio con un servidor local (<code>python -m http.server</code>) y abre <code>/web/</code>.</p>'; });

/* ====================== sobre el terreno: posición real frente a la ruta y cima hecha automática ====================== */
const NEAR_PEAK = 40, OFF_ROUTE = 50;   // m
let offRoute = false;
addEventListener('track:fix', e => {
  const f = e.detail, el = $('routeInfo');
  if (!f || f[4] > 50) { if (!f) { el.hidden = true; offRoute = false; } return; }
  const hit = PEAKS.find(p => Track.hav(f, [p.lon, p.lat]) <= NEAR_PEAK);
  if (hit && !doneSet().has(hit.id)) {
    const s = doneSet(); s.add(hit.id); store('cims:done', [...s]);
    if (P) syncDone();
    renderList(); clusters?.refresh();
    Track.say('★ ' + hit.name + ' marcada como hecha.', 10000);
  }
  if (!P || !KEYS.length) { el.hidden = true; offRoute = false; return; }
  const r = ROUTES[cur], pr = Track.projectOnLine(f, r.pts);
  if (pr.d > 600) { el.hidden = true; offRoute = false; return; }   // lejos de la ruta: no es relevante
  const off = pr.d > OFF_ROUTE, km = n => n.toFixed(1).replace('.', ',');
  el.hidden = false; el.classList.toggle('off', off);
  el.innerHTML = off ? `<b>Fuera de la ruta ${cur}</b><small>A ${Math.round(pr.d)} m del trazado. Pulsa «Volver» si te has perdido.</small>`
                     : `<b>En la ruta ${cur}</b><small>${km(pr.along / 1000)} de ${km(r.km)} km · a ${Math.round(pr.d)} m del trazado</small>`;
  if (off && !offRoute && navigator.vibrate) navigator.vibrate([200, 100, 200]);
  offRoute = off;
});
