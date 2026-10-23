import json, sys, urllib.request, urllib.parse
BBOX = "38.76,0.03,38.88,0.17"  # S,W,N,E
Q = f"""[out:json][timeout:90];
(
  way["highway"~"path|track|footway|steps|unclassified|service|tertiary|residential"]({BBOX});
  node["natural"="peak"]({BBOX});
  node["tourism"~"viewpoint"]({BBOX});
  node["amenity"="parking"]({BBOX});
  way["amenity"="parking"]({BBOX});
);
out geom;"""
req = urllib.request.Request("https://overpass-api.de/api/interpreter",
    data=urllib.parse.urlencode({"data": Q}).encode(),
    headers={"User-Agent": "rutero/1.0 (personal hiking)", "Accept": "application/json"})
with urllib.request.urlopen(req, timeout=120) as r:
    open(sys.argv[1], "wb").write(r.read())
