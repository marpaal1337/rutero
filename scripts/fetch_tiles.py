"""Descarga teselas (relieve AWS Terrarium + OpenTopoMap) de la zona y crea data/terreno.json con malla y textura."""
import base64, io, json, math, os, time, urllib.request
import numpy as np
from PIL import Image

LON0, LON1, LAT0, LAT1 = 0.060, 0.165, 38.786, 38.836   # zona con margen sobre las rutas
UA = {"User-Agent": "rutero/1.0 (proyecto personal de senderismo)"}
CACHE = "data/tiles"


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def get(url, path):
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r, open(path, "wb") as f:
            f.write(r.read())
        time.sleep(0.15)
    return Image.open(path)


def mosaic(z, url, tag):
    xa, ya = tile_xy(LON0, LAT1, z)
    xb, yb = tile_xy(LON1, LAT0, z)
    xs, ys = range(int(xa), int(xb) + 1), range(int(ya), int(yb) + 1)
    img = Image.new("RGB", (len(xs) * 256, len(ys) * 256))
    for i, x in enumerate(xs):
        for j, y in enumerate(ys):
            t = get(url.format(z=z, x=x, y=y), f"{CACHE}/{tag}_{z}_{x}_{y}.png").convert("RGB")
            img.paste(t, (i * 256, j * 256))
    ox, oy = xs[0], ys[0]
    box = tuple(round(v) for v in ((xa - ox) * 256, (ya - oy) * 256, (xb - ox) * 256, (yb - oy) * 256))
    return img.crop(box), (xa, ya, xb, yb)


# --- relieve ---
dem_img, _ = mosaic(13, "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", "dem")
a = np.asarray(dem_img, dtype=np.float64)
elev = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
cols, rows = 300, round(300 * (LAT1 - LAT0) / ((LON1 - LON0) * math.cos(math.radians(38.81))))
grid = np.asarray(Image.fromarray(elev.astype(np.float32), mode="F").resize((cols, rows), Image.BICUBIC))
print("malla", cols, "x", rows, "alt", grid.min(), grid.max())

# --- textura topográfica ---
topo, _ = mosaic(15, "https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "topo")
topo = topo.resize((topo.width * 4 // 5, topo.height * 4 // 5), Image.LANCZOS)
buf = io.BytesIO()
topo.save(buf, "JPEG", quality=82, optimize=True)
print("textura", topo.size, len(buf.getvalue()) // 1024, "KB")

json.dump({
    "bbox": [LON0, LAT0, LON1, LAT1], "cols": cols, "rows": rows,
    "h": base64.b64encode(np.round(grid * 10).astype("<i2").tobytes()).decode(),   # decímetros, int16
    "tex": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(),
}, open("data/terreno.json", "w"))
print("data/terreno.json", os.path.getsize("data/terreno.json") // 1024, "KB")
