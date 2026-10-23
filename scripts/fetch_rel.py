import json, urllib.request, urllib.parse
Q = """[out:json][timeout:60];
relation(id:1237477,2319713);
out geom;"""
req = urllib.request.Request("https://overpass-api.de/api/interpreter",
    data=urllib.parse.urlencode({"data": Q}).encode(),
    headers={"User-Agent": "rutero/1.0 (personal hiking)"})
d = json.load(urllib.request.urlopen(req, timeout=90))
json.dump(d, open("data/rels.json", "w"))
for r in d["elements"]:
    print(r["id"], r["tags"].get("name"), r["tags"].get("distance"), len(r["members"]))
    for m in r["members"]:
        if m["type"] == "way":
            g = m["geometry"]
            print("  way", m["ref"], m["role"], len(g), (round(g[0]["lat"],5), round(g[0]["lon"],5)), (round(g[-1]["lat"],5), round(g[-1]["lon"],5)))
