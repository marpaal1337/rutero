"""Genera web/data/*.json (índice de cimas + rutas con métricas homogéneas) a partir de data/cimas/routes.json.
Cada ruta se define por puntos de paso (se enruta sobre sendas OSM, favoreciendo las señalizadas) o por un GPX.
Uso: python scripts/build_cimas.py [id ...]"""
import json, os, sys, urllib.request
import xml.etree.ElementTree as ET
sys.path.insert(0, os.path.dirname(__file__))
import cimas_lib as L, elev

VALENCIA = (39.4699, -0.3763)
DEM = "AWS Terrarium ~15 m" if os.environ.get("ELEV_SOURCE") == "terrarium" else "EU-DEM 25 m"   # fuente de altitudes de esta ejecución
peaks = json.load(open("data/cimas/peaks.json"))
defs = json.load(open("data/cimas/routes.json"))
want = set(sys.argv[1:])
os.makedirs("web/data", exist_ok=True)


def gpx_points(path):
    ns = {"g": "http://www.topografix.com/GPX/1/1"}
    return [(float(p.get("lat")), float(p.get("lon"))) for p in ET.parse(path).getroot().iterfind(".//g:trkpt", ns)]


def grade(m):
    """Dificultad de una ruta (0-3) por esfuerzo: horas de subida (Naismith) más 1 h por cada km con pendiente ≥30 %."""
    e = m["t_up"] + m["steep_m"] / 1000
    return 0 if e < 2 else 1 if e < 3 else 2 if e < 4 else 3


def tier(p):
    """Relevancia de la cima: prominencia (relieve propio), fama (wikidata/wikipedia en OSM) y altura. `tier` en peaks.json lo fuerza."""
    if p.get("tier"):
        return p["tier"]
    prom_ok = p.get("prom_min") or p.get("prom", 0) >= 200
    if p.get("fama") and prom_ok and p["ele"] >= 700:
        return "emblematica"
    return "destacada" if prom_ok or (p.get("fama") and p.get("prom", 0) >= 100) else "local"


GEO = "data/cimas/geocode_cache.json"


def place_name(pt):
    """Topónimo cercano (Nominatim, con caché) para nombrar salidas que solo son un aparcamiento sin nombre."""
    import time
    c = json.load(open(GEO)) if os.path.exists(GEO) else {}
    k = f"{pt[0]:.4f},{pt[1]:.4f}"
    if k not in c:
        url = f"https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=ca,es&lat={pt[0]}&lon={pt[1]}"
        try:
            a = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=L.UA), timeout=30))["address"]
            c[k] = next((a[f] for f in ("hamlet", "village", "town", "suburb", "city", "municipality", "county") if f in a), "")
        except Exception as ex:
            print("  Nominatim sin respuesta:", ex); return ""
        json.dump(c, open(GEO, "w"), ensure_ascii=False, indent=0)
        time.sleep(1.2)
    return c[k]


def drive_from_valencia(pt):
    """(km, min) en coche Valencia → punto de salida con OSRM público; None si no responde."""
    url = f"https://router.project-osrm.org/route/v1/driving/{VALENCIA[1]},{VALENCIA[0]};{pt[1]},{pt[0]}?overview=false"
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=L.UA), timeout=30))["routes"][0]
        return {"km": round(r["distance"] / 1000), "min": round(r["duration"] / 60)}
    except Exception as ex:
        print("  OSRM sin respuesta:", ex)
        return None


for p in peaks:
    if want and p["id"] not in want:
        continue
    rdefs = defs.get(p["id"], [])
    if not rdefs:
        continue
    print("==", p["name"])
    graph = osm = None
    routes = []
    for r in rdefs:
        if "gpx" in r:
            raw = gpx_points(r["gpx"])
            gadj = gpos = gosm = None
        else:
            if graph is None:
                osm = json.load(open(f"data/cimas/{p['id']}_osm.json"))
                graph = L.build_graph(osm)
            adj, pos = graph
            gadj, gpos, gosm = adj, pos, osm
            nodes = L.route(adj, pos, [tuple(v) for v in r["via"]])
            raw = [pos[n] for n in nodes]
            frac, refs = L.marked_summary(adj, nodes)
            r["marked_pct"] = round(frac * 100)
            if refs:
                r["marked"] = " + ".join(refs[:2])
        pts = L.resample(raw)
        z = L.smooth(elev.elevations(pts))
        m, dist = L.metrics(pts, z)
        m["drive"] = drive_from_valencia(pts[0])
        r["warn"] = L.check_start(gosm, gadj, gpos, pts[0], m["km"], m["drive"])
        if r["warn"]:
            print("  ⚠ revisar salida:", ", ".join(r["warn"]))
        if "name" not in r:
            r["start"] = place_name(pts[0]) or f"{pts[0][0]:.4f}, {pts[0][1]:.4f}"
            r["name"] = f"Desde {r['start']}"
        print(f"  {r['id']} {r['name'][:50]:<50} {m['km']} km +{m['up']} máx {m['max_slope']}% salida {m['z0']} m")
        wpts = [{"lon": round(pts[0][1], 6), "lat": round(pts[0][0], 6), "ele": m["z0"], "name": "Inicio"},
                {"lon": p["lon"], "lat": p["lat"], "ele": p["ele"], "name": f"Cumbre {p['name']}"}]
        routes.append({**{k: r[k] for k in ("id", "name", "start", "marked", "marked_pct", "notes") if k in r}, **m, **({"warn": r["warn"]} if r["warn"] else {}),
                       "diff": grade(m), "dem": DEM, "maxslope": m["max_slope"], "wpts": wpts,
                       "pts": [[round(a[1], 6), round(a[0], 6), round(e, 1)] for a, e in zip(pts, z)],
                       "dist": [round(d / 1000, 3) for d in dist]})
    from collections import Counter
    dup = Counter(r["start"] for r in routes if "start" in r)
    for r in routes:   # salidas con el mismo topónimo: distinguirlas por altitud de salida
        if dup.get(r.get("start"), 0) > 1:
            r["start"] += f" ({r['z0']} m)"
            r["name"] = f"Desde {r['start']}"
    json.dump({**p, "tier": tier(p), "routes": routes}, open(f"web/data/{p['id']}.json", "w"), ensure_ascii=False, separators=(",", ":"))

index = []
for p in peaks:
    f = f"web/data/{p['id']}.json"
    if os.path.exists(f):
        d = json.load(open(f))
        index.append({**{k: p[k] for k in ("id", "name", "ele", "lat", "lon", "prov", "comarca")},
                      "tier": tier(p), "prom": p.get("prom"), "diff": min(r["diff"] for r in d["routes"]),
                      "routes": [{k: r[k] for k in ("id", "name", "km", "up", "t_up", "max_slope", "marked", "drive", "diff") if k in r} for r in d["routes"]]})
json.dump(index, open("web/data/peaks.json", "w"), ensure_ascii=False, indent=1)
print("web/data/peaks.json:", len(index), "cimas")
