"""Añade cimas del catálogo (data/cimas/catalog.json) a data/cimas/peaks.json por id de OSM.
Rellena provincia y comarca con Nominatim y guarda prominencia/fama (base de la clasificación).
Uso: python scripts/cimas_add.py <osm_id> [osm_id ...]"""
import json, os, re, sys, time, unicodedata, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
import cimas_lib as L

PEAKS = "data/cimas/peaks.json"
cat = {p["osm"]: p for p in json.load(open("data/cimas/catalog.json"))}
peaks = json.load(open(PEAKS))


def nice(name):
    n = re.sub(r"^(el|la|els|les|l')\s*", "", name.strip(), flags=re.I)
    return n[:1].upper() + n[1:]


def slug(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def place(lat, lon):
    u = f"https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=ca&lat={lat}&lon={lon}"
    a = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=L.UA), timeout=30))["address"]
    time.sleep(1.2)
    comarca = a.get("region") or a.get("county") or ""
    return a.get("province") or a.get("state_district") or "", re.sub(r"^(La|El|Els|Les) ", lambda m: m.group(1).lower() + " ", comarca)


for p in peaks:   # las cimas ya existentes también reciben prominencia y fama
    c = cat.get(p["osm"])
    if c:
        p.update(prom=c["prom"], prom_min=c["prom_min"], fama=c["fama"])
have = {p["osm"] for p in peaks}
for oid in map(int, sys.argv[1:]):
    c = cat.get(oid)
    if not c or oid in have:
        print(oid, "no está en el catálogo o ya existe"); continue
    name = nice(c["name"])
    prov, comarca = place(c["lat"], c["lon"])
    pid = slug(name)
    if any(q["id"] == pid for q in peaks):   # homónimos (p. ej. varios «Pico del Águila»): se distinguen por comarca
        pid += "-" + slug(comarca)
    peaks.append({"id": pid, "name": name, "ele": int(round(c["ele"])), "lat": c["lat"], "lon": c["lon"],
                  "prov": prov, "comarca": comarca, "osm": oid, "prom": c["prom"], "prom_min": c["prom_min"], "fama": c["fama"]})
    print(f"+ {peaks[-1]['id']:<24} {name} {c['ele']:.0f} m  {prov} / {comarca}")
json.dump(peaks, open(PEAKS, "w"), ensure_ascii=False, indent=1)
