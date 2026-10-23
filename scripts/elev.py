import json, os, time, urllib.request
CACHE = "data/elev_cache.json"
def _key(p): return f"{p[0]:.5f},{p[1]:.5f}"
def elevations(pts):
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
