"""Revisa las salidas de las rutas ya generadas (web/data/<id>.json) y lista las dudosas. Sin red.
Usa el OSM descargado (data/cimas/<id>_osm.json) para comprobar sendas y aparcamientos cerca del inicio.
Uso: python scripts/cimas_review.py [id ...]   → sale con 1 si hay salidas sin parking o lejos de las sendas"""
import glob, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import cimas_lib as L

GRAVE = {"sin_parking", "lejos_red"}   # lo demás (coche largo, ruta corta o larga) es solo informativo
want = set(sys.argv[1:])
rows, grave = [], False
for f in sorted(glob.glob("web/data/*.json")):
    pid = os.path.basename(f)[:-5]
    if pid == "peaks" or (want and pid not in want):
        continue
    d = json.load(open(f))
    osm_f = f"data/cimas/{pid}_osm.json"
    osm = graph = None
    if os.path.exists(osm_f):
        osm = json.load(open(osm_f))
        graph = L.build_graph(osm)
    for r in d["routes"]:
        lon, lat = r["pts"][0][:2]
        w = L.check_start(osm, *(graph or (None, None)), (lat, lon), r["km"], r.get("drive"))
        if not osm:
            w.append("sin_osm")   # sin el OSM no se pueden comprobar sendas ni aparcamientos
        if w:
            rows.append((-len(GRAVE & set(w)), d["name"], r["id"], r["name"], w))
            grave |= bool(GRAVE & set(w))
for _, peak, rid, name, w in sorted(rows):
    print(f"{peak:<28} {rid}  {name[:34]:<34} {', '.join(w)}")
print(f"{len(rows)} rutas con avisos" + (" (hay graves)" if grave else ""))
sys.exit(1 if grave else 0)
