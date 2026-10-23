import json, math, os, time, urllib.request
import numpy as np
CACHE = "data/elev_cache.json"
def _key(p): return f"{p[0]:.5f},{p[1]:.5f}"
TZ = 13   # AWS Terrarium z13 ≈ 15 m/píxel; sin límite de consultas (EU-DEM vía opentopodata admite ~1000 llamadas al día)
_tiles = {}


def _tile(x, y):
    if (x, y) not in _tiles:
        from PIL import Image
        path = f"data/cimas/dem/{TZ}_{x}_{y}.png"
        os.makedirs("data/cimas/dem", exist_ok=True)
        if not os.path.exists(path):
            req = urllib.request.Request(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{TZ}/{x}/{y}.png", headers={"User-Agent": "montgo-planner/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r, open(path, "wb") as f:
                f.write(r.read())
            time.sleep(0.1)
        a = np.asarray(Image.open(path).convert("RGB"), np.float32)
        _tiles[(x, y)] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    return _tiles[(x, y)]


def terrarium(pts):
    """Altitudes (m) por interpolación bilineal sobre teselas Terrarium."""
    n, out = 2 ** TZ, []
    for lat, lon in pts:
        fx = (lon + 180) / 360 * n * 256 - 0.5
        fy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n * 256 - 0.5
        x0, y0 = math.floor(fx), math.floor(fy)
        tx, ty = fx - x0, fy - y0
        v = lambda X, Y: float(_tile(X // 256, Y // 256)[Y % 256, X % 256])
        out.append(round(v(x0, y0) * (1 - tx) * (1 - ty) + v(x0 + 1, y0) * tx * (1 - ty) + v(x0, y0 + 1) * (1 - tx) * ty + v(x0 + 1, y0 + 1) * tx * ty, 1))
    return out


def elevations(pts):
    if os.environ.get("ELEV_SOURCE") == "terrarium":
        return terrarium(pts)
    c = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    todo = [p for p in dict.fromkeys(pts) if _key(p) not in c]
    for i in range(0, len(todo), 100):
        chunk = todo[i:i+100]
        url = "https://api.opentopodata.org/v1/eudem25m?locations=" + "|".join(f"{a:.5f},{b:.5f}" for a, b in chunk)
        for t in range(4):
            try:
                r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "montgo-route-planner/1.0"}), timeout=60))
                break
            except Exception as ex:
                print("retry", ex); time.sleep(3)
        else:   # sin respuesta: abortar antes que reutilizar la respuesta del lote anterior y envenenar la caché
            json.dump(c, open(CACHE, "w"))
            raise RuntimeError("opentopodata no responde")
        for p, res in zip(chunk, r["results"]):
            c[_key(p)] = res["elevation"]
        time.sleep(1.1)
    json.dump(c, open(CACHE, "w"))
    return [c[_key(p)] for p in pts]
