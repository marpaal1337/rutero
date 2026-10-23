import json, sys, urllib.request, urllib.parse
BBOX = "38.76,0.03,38.88,0.17"
Q = f"""[out:json][timeout:90];
(
  nwr["sport"="shooting"]({BBOX});
  nwr["leisure"="pitch"]["sport"~"shoot"]({BBOX});
  nwr["place"~"village|hamlet|suburb"]({BBOX});
  nwr["name"~"[Tt]iro|Jes.s Pobre|Hedra|Colonia|Col.nia|Emboixar|Cruz|Creu"]({BBOX});
  relation["route"~"hiking|foot"]({BBOX});
);
out tags center;"""
req = urllib.request.Request("https://overpass-api.de/api/interpreter",
    data=urllib.parse.urlencode({"data": Q}).encode(),
    headers={"User-Agent": "rutero/1.0 (personal hiking)"})
d = json.load(urllib.request.urlopen(req, timeout=120))
for x in d["elements"]:
    t = x.get("tags", {}); c = x.get("center") or x
    print(x["type"], x["id"], round(c.get("lat", 0), 5), round(c.get("lon", 0), 5), {k: t[k] for k in ("name","ref","route","network","highway","sport","place","amenity","ele") if k in t})
