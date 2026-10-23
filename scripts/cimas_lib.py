"""Utilidades comunes del pipeline de cimas: Overpass, grafo de sendas (Dijkstra) y métricas de ruta."""
import heapq, json, math, os, re, time, urllib.parse, urllib.request

ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
             "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
UA = {"User-Agent": "cimas-cv-planner/1.0 (personal hiking)"}
# Penalización por tipo de vía: favorece sendas; las vías con relación PR/GR/SL se bonifican (ver build_graph)
PEN = {"path": 1.0, "track": 1.1, "footway": 1.1, "steps": 1.3, "bridleway": 1.1, "service": 1.8,
       "unclassified": 2.5, "tertiary": 4, "tertiary_link": 4, "residential": 3}
MARKED_BONUS = 0.6
WAYREF = {}   # id de vía → códigos de las relaciones de senderismo que la recorren (se rellena en build_graph)


def overpass(query, tries=12):
    for i in range(tries):
        try:
            req = urllib.request.Request(ENDPOINTS[i % len(ENDPOINTS)], data=urllib.parse.urlencode({"data": query}).encode(), headers=UA)
            return json.load(urllib.request.urlopen(req, timeout=180))
        except Exception as ex:
            print("overpass retry:", ex, flush=True)
            time.sleep(min(6 * (i + 1), 60))
    raise RuntimeError("Overpass no responde")


def hav(a, b):
    """Distancia en metros entre (lat, lon)."""
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl, dp = math.radians(b[1] - a[1]), p2 - p1
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def build_graph(osm):
    """Grafo no dirigido {nodo: {vecino: (coste, longitud)}} + posiciones + vías marcadas por relaciones de senderismo."""
    marked = set()
    WAYREF.clear()
    for e in osm["elements"]:
        if e["type"] == "relation" and "members" in e:
            t = e.get("tags", {})
            label = t.get("ref") or ""
            if not re.match(r"^(GR|PR|SL)\b", label):   # solo senderos homologados (no carreras, caminos históricos ni redes locales)
                continue
            for m in e["members"]:
                if m["type"] == "way":
                    marked.add(m["ref"])
                    WAYREF.setdefault(m["ref"], set()).add(label)
    adj, pos = {}, {}
    for e in osm["elements"]:
        if e["type"] != "way" or "highway" not in e.get("tags", {}) or "geometry" not in e:
            continue   # sin geometría: son aparcamientos con highway=service que llegan en la consulta de POI (out tags center)
        pen = PEN.get(e["tags"]["highway"])
        if pen is None:
            continue
        if e["id"] in marked:
            pen *= MARKED_BONUS
        ids, geo = e["nodes"], e["geometry"]
        for i, g in zip(ids, geo):
            pos[i] = (g["lat"], g["lon"])
        for a, b in zip(ids, ids[1:]):
            L = hav(pos[a], pos[b])
            for u, v in ((a, b), (b, a)):
                old = adj.setdefault(u, {}).get(v)
                if old is None or old[0] > L * pen:
                    adj[u][v] = (L * pen, L, e["id"])
    return adj, pos


def nearest(adj, pos, pt):
    n = min(adj, key=lambda k: hav(pos[k], pt))
    return n, hav(pos[n], pt)


def dijkstra(adj, src, dst):
    dist, prev, pq = {src: 0.0}, {}, [(0.0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == dst:
            break
        if d > dist.get(u, math.inf):
            continue
        for v, (w, _, _) in adj[u].items():
            nd = d + w
            if nd < dist.get(v, math.inf):
                dist[v], prev[v] = nd, u
                heapq.heappush(pq, (nd, v))
    if dst not in dist:
        raise ValueError("sin camino entre los puntos")
    path = [dst]
    while path[-1] != src:
        path.append(prev[path[-1]])
    return path[::-1]


def route(adj, pos, pts):
    """pts: lista de (lat, lon) por los que pasar; devuelve ids de nodo. Avisa si algún punto queda lejos de la red."""
    nodes = []
    for a, b in zip(pts, pts[1:]):
        na, da = nearest(adj, pos, a)
        nb, db = nearest(adj, pos, b)
        for d, p in ((da, a), (db, b)):
            if d > 150:
                print(f"  aviso: punto {p} a {d:.0f} m de la red de sendas")
        p = dijkstra(adj, na, nb)
        nodes += p if not nodes else p[1:]
    return nodes


def resample(pts, step=15.0):
    out, acc = [pts[0]], 0.0
    for a, b in zip(pts, pts[1:]):
        d = hav(a, b)
        while d > 0 and acc + d >= step:
            t = (step - acc) / d
            a = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            d = hav(a, b)
            acc = 0.0
            out.append(a)
        acc += d
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    return out


def smooth(z, k=5):
    """Media móvil con ventana simétrica que se estrecha en los extremos (no sesga la altitud de salida/cumbre)."""
    n = len(z)
    out = []
    for i in range(n):
        h = min(k, i, n - 1 - i)
        out.append(sum(z[i - h:i + h + 1]) / (2 * h + 1))
    return out


def gain(z, thr=3.0):
    up = dn = 0.0
    ref = z[0]
    for v in z[1:]:
        if v - ref >= thr:
            up += v - ref
            ref = v
        elif ref - v >= thr:
            dn += ref - v
            ref = v
    return up, dn


def metrics(pts, z, step=15.0):
    """Métricas homogéneas para cualquier ruta (pts remuestreados cada `step` m)."""
    dist = [0.0]
    for a, b in zip(pts, pts[1:]):
        dist.append(dist[-1] + hav(a, b))
    up, dn = gain(z)
    slopes = [abs(z[i + 1] - z[i]) / step * 100 for i in range(len(z) - 1)]
    # pendiente suavizada sobre ~75 m para no contar ruido del MDT
    sm = smooth(slopes, 2)
    steep = sum(1 for s in sm if s >= 30) * step
    km = dist[-1] / 1000
    return dict(km=round(km, 2), up=round(up), dn=round(dn), zmin=round(min(z)), zmax=round(max(z)),
                z0=round(z[0]), avg_slope=round(up / dist[-1] * 100, 1) if dist[-1] else 0,
                max_slope=round(max(sm)), steep_m=round(steep),
                t_up=round(dist[-1] / 5000 + up / 600, 2), t_dn=round((dist[-1] / 5000 + dn / 1000) * 0.8, 2)), dist


def marked_summary(adj, nodes, min_frac=0.15):
    """Fracción del recorrido por vías de relaciones señalizadas y códigos principales (>= min_frac cada uno)."""
    tot = marked = 0.0
    per = {}
    for a, b in zip(nodes, nodes[1:]):
        _, ln, wid = adj[a][b]
        tot += ln
        refs = WAYREF.get(wid)
        if refs:
            marked += ln
            for r in refs:
                per[r] = per.get(r, 0.0) + ln
    top = [r for r, m in sorted(per.items(), key=lambda x: -x[1]) if tot and m / tot >= min_frac]
    return (marked / tot if tot else 0.0), top


def bearing(a, b):
    y = math.sin(math.radians(b[1] - a[1])) * math.cos(math.radians(b[0]))
    x = math.cos(math.radians(a[0])) * math.sin(math.radians(b[0])) - math.sin(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.cos(math.radians(b[1] - a[1]))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


START_KINDS = ("parking", "alpine_hut", "wilderness_hut", "camp_site", "shelter")   # POI de OSM que valen como punto de salida


def check_start(osm, adj, pos, start, km, drive):
    """Avisos sobre una salida (lista de códigos; vacía si no hay nada que revisar).
    osm/adj/pos pueden ser None (rutas desde GPX): entonces solo se comprueban longitud y coche.
    lejos_red: inicio a >150 m de sendas · sin_parking: ningún aparcamiento/refugio a <300 m ·
    coche_largo: >150 min desde Valencia o sin dato · corta/larga: fuera de 3-12 km."""
    warn = []
    if adj:
        if nearest(adj, pos, start)[1] > 150:
            warn.append("lejos_red")
    if osm:
        for e in osm["elements"]:
            t = e.get("tags", {})
            if "highway" in t or not t:
                continue
            c = (e["lat"], e["lon"]) if "lat" in e else (e["center"]["lat"], e["center"]["lon"]) if "center" in e else None
            if c and (t.get("amenity") or t.get("tourism") or t.get("natural")) in START_KINDS and hav(c, start) <= 300:
                break
        else:
            warn.append("sin_parking")
    if not drive or drive["min"] > 150:
        warn.append("coche_largo")
    if km < 3:
        warn.append("corta")
    elif km > 12:
        warn.append("larga")
    return warn


def candidates(peak, osm, kmin=3.0, kmax=12.0):
    """Salidas candidatas (aparcamiento, refugio, camping) enrutando desde la cumbre sobre OSM.
    Devuelve (d0, lista ordenada de mejor a peor) con d0 = distancia de la cumbre a la red y elementos
    (sector 0-7 desde la cumbre, km de ruta, fracción de sendero, nombre, tipo, (lat, lon), id OSM)."""
    adj, pos = build_graph(osm)
    S = (peak["lat"], peak["lon"])
    src, d0 = nearest(adj, pos, S)
    # Dijkstra desde la cumbre a toda la red (coste ponderado + longitud real)
    cost, length, prev = {src: 0.0}, {src: 0.0}, {}
    pq = [(0.0, src)]
    while pq:
        c, u = heapq.heappop(pq)
        if c > cost[u]: continue
        for v, (w, ln, _) in adj[u].items():
            if c + w < cost.get(v, math.inf):
                cost[v], length[v], prev[v] = c + w, length[u] + ln, u
                heapq.heappush(pq, (c + w, v))
    cands = []
    for e in osm["elements"]:
        t = e.get("tags", {})
        if "highway" in t or not t: continue
        c = (e["lat"], e["lon"]) if "lat" in e else (e["center"]["lat"], e["center"]["lon"]) if "center" in e else None
        kind = t.get("amenity") or t.get("tourism") or t.get("natural")
        if not c or kind not in START_KINDS: continue
        n = min(adj, key=lambda k: hav(pos[k], c))
        if hav(pos[n], c) > 60 or n not in length: continue
        km = length[n] / 1000
        if not kmin <= km <= kmax: continue
        # fracción del recorrido por sendas/pistas de montaña (no calles)
        cur, path_m = n, 0.0
        while cur != src:
            p = prev[cur]; ln = adj[cur][p][1]
            if ln and adj[cur][p][0] / ln < 1.5: path_m += ln
            cur = p
        cands.append((int(bearing(S, c) // 45), km, path_m / length[n], t.get("name", ""), kind, c, e["id"]))
    cands.sort(key=lambda x: (-x[2] + abs(x[1] - 7) / 20))
    return d0, cands
