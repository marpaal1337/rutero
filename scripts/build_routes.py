import sys, json, math, datetime
sys.path.insert(0, "scripts")
import graph, elev
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt

G, pos = graph.load()
SUM = (38.80322, 0.12938); CR = (38.80779, 0.11984); COL = (38.81419, 0.12009)
ROUTES = {
  "A": dict(file="ruta_A_campo_tiro_Les_Planes", name="A · Directa desde campo de tiro (Les Planes, PR-CV 355)",
            via=[(38.80601, 0.15056), SUM], wpts=[("Campo de tiro / parking", 0)]),
  "C": dict(file="ruta_C_Cami_de_la_Colonia", name="C · Camí de la Colònia (Dénia, ruta naranja)",
            via=[(38.8225, 0.1030), COL, SUM], wpts=[("Inicio Camí de la Colònia", 0), ("Casa de la Colònia", COL)]),
  "B": dict(file="ruta_B_larga_Jesus_Pobre_GR330", name="B · Larga desde Jesús Pobre por GR-330 / Creueta de Dénia",
            via=[(38.79859, 0.0847), (38.81283, 0.10085), CR, SUM], wpts=[("Jesús Pobre", 0), ("Creueta de Dénia", CR)]),
}

def resample(nodes, step=15.0):
    pts = [pos[n] for n in nodes]
    out = [pts[0]]; acc = 0.0
    for a, b in zip(pts, pts[1:]):
        d = graph.hav(a, b)
        while acc + d >= step:
            t = (step - acc) / d
            a = (a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t); d = graph.hav(a, b); acc = 0.0
            out.append(a)
        acc += d
    if out[-1] != pts[-1]: out.append(pts[-1])
    return out

def smooth(z, k=5):
    return [sum(z[max(0, i-k):i+k+1]) / len(z[max(0, i-k):i+k+1]) for i in range(len(z))]

def gain(z, thr=3.0):
    up = dn = 0.0; ref = z[0]
    for v in z[1:]:
        if v - ref >= thr: up += v - ref; ref = v
        elif ref - v >= thr: dn += ref - v; ref = v
    return up, dn

res = {}
for k, r in ROUTES.items():
    nodes = graph.route(G, pos, r["via"])
    pts = resample(nodes)
    z = smooth(elev.elevations(pts))
    dist = [0.0]
    for a, b in zip(pts, pts[1:]): dist.append(dist[-1] + graph.hav(a, b))
    up, dn = gain(z)
    km = dist[-1]/1000
    t_up = km/4.0 + up/600.0 if False else (dist[-1]/5000 + up/600)  # Naismith (h)
    t_dn = (dist[-1]/5000 + dn/1000)*0.8
    res[k] = dict(name=r["name"], km=km, up=up, dn=dn, zmin=min(z), zmax=max(z), t_up=t_up, t_dn=t_dn,
                  maxslope=max(abs((z[i+1]-z[i])/15*100) for i in range(len(z)-1)), pts=pts, z=z, dist=dist, file=r["file"], wpts=r["wpts"])
    # GPX
    def wpt(n, p, ele): return f'  <wpt lat="{p[0]:.6f}" lon="{p[1]:.6f}"><ele>{ele:.0f}</ele><name>{n}</name></wpt>\n'
    g = ['<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="rutero" xmlns="http://www.topografix.com/GPX/1/1">\n']
    g.append(f'  <metadata><name>{r["name"]}</name><desc>Generado con OSM + EU-DEM 25 m. Planificación: verificar estado de sendas.</desc></metadata>\n')
    g.append(wpt("Inicio", pts[0], z[0]))
    for n, p in r["wpts"][1:]: g.append(wpt(n, p, z[min(range(len(pts)), key=lambda i: graph.hav(pts[i], p))]))
    g.append(wpt("Cumbre Montgó / Cap Gros (752 m)", SUM, 752))
    g.append(f'  <trk><name>{r["name"]}</name><trkseg>\n')
    for p, e in zip(pts, z): g.append(f'    <trkpt lat="{p[0]:.6f}" lon="{p[1]:.6f}"><ele>{e:.1f}</ele></trkpt>\n')
    g.append('  </trkseg></trk>\n</gpx>\n')
    open(f"out/{r['file']}.gpx", "w").write("".join(g))
    # profile
    fig, ax = plt.subplots(figsize=(10, 3.8))
    d = [x/1000 for x in dist]
    ax.fill_between(d, z, min(z)-20, color="#9bc4a0"); ax.plot(d, z, color="#2d6a4f", lw=1.6)
    ax.annotate("Cumbre ≈752 m", (d[-1], z[-1]), xytext=(d[-1]*0.72, z[-1]+25), arrowprops=dict(arrowstyle="->"))
    ax.set_xlabel("Distancia (km)"); ax.set_ylabel("Altitud (m)"); ax.set_ylim(min(z)-20, 800); ax.grid(alpha=.3)
    ax.set_title(f'{r["name"]}\n{km:.1f} km · +{up:.0f} m · pend. máx {res[k]["maxslope"]:.0f}%', fontsize=10)
    fig.tight_layout(); fig.savefig(f"out/perfil_{k}.png", dpi=130); plt.close(fig)

fig, ax = plt.subplots(figsize=(10, 4.2))
for k, c in zip("ABC", ["#d62828", "#1d3557", "#f77f00"]):
    ax.plot([x/1000 for x in res[k]["dist"]], res[k]["z"], label=res[k]["name"], color=c, lw=1.8)
ax.set_xlabel("Distancia (km)"); ax.set_ylabel("Altitud (m)"); ax.grid(alpha=.3); ax.legend(fontsize=8); ax.set_title("Montgó · comparativa de subidas")
fig.tight_layout(); fig.savefig("out/perfil_comparativo.png", dpi=130)

def hm(h): return f"{int(h)}h{int((h-int(h))*60):02d}"
for k, v in res.items():
    print(k, v["name"], f"{v['km']:.2f} km  +{v['up']:.0f} -{v['dn']:.0f}  z {v['zmin']:.0f}-{v['zmax']:.0f}  slope {v['maxslope']:.0f}%  subida {hm(v['t_up'])} bajada {hm(v['t_dn'])}  pts {len(v['pts'])}")
json.dump({k: {kk: vv for kk, vv in v.items() if kk in ("km","up","dn","zmin","zmax","t_up","t_dn","maxslope","name","file")} for k, v in res.items()}, open("out/stats.json", "w"), indent=1)
