"""Catálogo de cimas candidatas de la Comunitat Valenciana: OSM (natural=peak) + prominencia calculada con el DEM Terrarium.
Uso: python scripts/cimas_catalog.py   → data/cimas/catalog.json (ordenado por relevancia; regenerable)"""
import heapq, json, math, os, sys, time, urllib.request
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import cimas_lib as L

Z = 11                                  # ~59 m/píxel a esta latitud
LON0, LON1, LAT0, LAT1 = -2.1, 1.0, 37.3, 41.3   # CV con margen para ver relieve vecino
SNAP = 8                                # celdas (~500 m) para ajustar el nodo a la cumbre del DEM
PROM_MIN = 200                          # m de prominencia para entrar por mérito propio
ELE_MIN_FAMA = 400                      # m mínimos si entra solo por tener wikidata/wikipedia
DEM_DIR = "data/cimas/dem"
OUT = "data/cimas/catalog.json"
UA = {"User-Agent": "rutero/1.0 (proyecto personal de senderismo)"}


def tile_xy(lon, lat):
    n = 2 ** Z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def load_dem():
    xa, ya = tile_xy(LON0, LAT1)
    xb, yb = tile_xy(LON1, LAT0)
    xs, ys = range(int(xa), int(xb) + 1), range(int(ya), int(yb) + 1)
    os.makedirs(DEM_DIR, exist_ok=True)
    H = np.zeros((len(ys) * 256, len(xs) * 256), np.float32)
    for i, x in enumerate(xs):
        for j, y in enumerate(ys):
            path = f"{DEM_DIR}/{Z}_{x}_{y}.png"
            if not os.path.exists(path):
                req = urllib.request.Request(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png", headers=UA)
                with urllib.request.urlopen(req, timeout=30) as r, open(path, "wb") as f:
                    f.write(r.read())
                time.sleep(0.1)
            a = np.asarray(Image.open(path).convert("RGB"), np.float32)
            H[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    return H, xs[0], ys[0]


def prominence(H, r0, c0, cap=PROM_MIN):
    (r0, c0), = [snap(H, r0, c0)]
    return _flood(H, r0, c0, cap), (r0, c0)


def snap(H, r0, c0):
    ra, ca = max(r0 - SNAP, 0), max(c0 - SNAP, 0)
    win = H[ra:r0 + SNAP + 1, ca:c0 + SNAP + 1]
    dr, dc = np.unravel_index(int(win.argmax()), win.shape)
    return ra + int(dr), ca + int(dc)


def _flood(H, r0, c0, cap):
    """Prominencia (m) por inundación desde la cima; si supera `cap` devuelve (cap, True) sin seguir."""
    h, w = H.shape
    hp = float(H[r0, c0])
    seen = {(r0, c0)}
    heap = [(-float(H[r0, c0]), r0, c0)]
    low = hp
    while heap:
        nh, r, c = heapq.heappop(heap)
        v = -nh
        if v < hp - cap:
            return cap, True
        low = min(low, v)
        if v > hp:
            return hp - low, False
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            rr, cc = r + dr, c + dc
            if 0 <= rr < h and 0 <= cc < w and (rr, cc) not in seen:
                seen.add((rr, cc))
                heapq.heappush(heap, (-float(H[rr, cc]), rr, cc))
    return hp - low, False               # llegó al borde del mapa sin hallar nada más alto


def ele_num(t):
    try:
        return float(str(t).replace(",", ".").split()[0])
    except (ValueError, IndexError):
        return None


def main():
    raw = "data/cimas/_peaks_cv_osm.json"
    if not os.path.exists(raw):
        q = f"""[out:json][timeout:180];
area["ISO3166-2"="ES-VC"]->.cv;
node["natural"="peak"]["name"](area.cv);
out tags center;"""
        json.dump(L.overpass(q), open(raw, "w"))
    els = json.load(open(raw))["elements"]
    print(len(els), "picos con nombre en OSM")
    H, tx0, ty0 = load_dem()
    print("DEM", H.shape)
    out = []
    for e in els:
        t = e["tags"]
        ele = ele_num(t.get("ele"))
        if ele is None or ele < 300:
            continue
        x, y = tile_xy(e["lon"], e["lat"])
        r, c = int((y - ty0) * 256), int((x - tx0) * 256)
        (pr, capped), cell = prominence(H, r, c)
        fama = bool(t.get("wikidata") or t.get("wikipedia"))
        if pr < PROM_MIN and not (fama and ele >= ELE_MIN_FAMA):
            continue
        out.append({"osm": e["id"], "name": t["name"], "ele": ele, "lat": round(e["lat"], 5), "lon": round(e["lon"], 5),
                    "prom": round(pr), "prom_min": capped, "fama": fama, "_cell": cell,
                    "wikidata": t.get("wikidata"), "wikipedia": t.get("wikipedia")})
    out.sort(key=lambda p: (-p["fama"], -p["ele"]))
    vistos, uniq = {}, []
    for p in out:                            # varios nodos de OSM sobre la misma cumbre: nos quedamos con el mejor
        k = p.pop("_cell")
        if not any(abs(k[0] - a) <= SNAP and abs(k[1] - b) <= SNAP for a, b in vistos):
            vistos[k] = 1
            uniq.append(p)
    out = uniq
    json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=0)
    print(len(out), "candidatas →", OUT)


if __name__ == "__main__":
    main()
