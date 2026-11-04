"""Trace each boulder's real footprint from public-domain USDA NAIP aerial imagery (via USGS).

Mountain Project gives one GPS point per boulder; this looks at a small aerial photo around that
point, finds the rock (granite reads as a pale, neutral-colored blob with a dark shadow beside it,
on warmer tan ground), and turns its edge into a lat/lon polygon. Only confident traces are kept;
everything else keeps the estimated footprint drawn by the app.

Usage:
  python tools/outlines.py fetch  <region.json> <chip-dir>
  python tools/outlines.py trace  <region.json> <chip-dir> <outlines.json> [--sheet sheet.png]
Needs numpy, pillow, scipy, scikit-image (e.g. in a venv).
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

R_M = 36       # chip half-size in meters (72 m square)
PX = 288       # chip size in pixels -> 0.25 m per pixel
M_PER_PX = 2 * R_M / PX
SEARCH_M = 16  # the traced rock must sit within this distance of Mountain Project's GPS point
SERVICE = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage"


def bbox(lat, lon):
    dlat = R_M / 111320
    dlon = R_M / (111320 * math.cos(math.radians(lat)))
    return lon - dlon, lat - dlat, lon + dlon, lat + dlat


def fetch(region, chips):
    os.makedirs(chips, exist_ok=True)
    for i, b in enumerate(region["boulders"]):
        out = os.path.join(chips, f"{b['id']}.png")
        if os.path.exists(out):
            continue
        w, s, e, n = bbox(b["lat"], b["lon"])
        q = urllib.parse.urlencode({"bbox": f"{w},{s},{e},{n}", "bboxSR": 4326, "imageSR": 4326,
                                    "size": f"{PX},{PX}", "format": "png", "f": "image"})
        for attempt in range(4):
            try:
                req = urllib.request.Request(f"{SERVICE}?{q}", headers={"User-Agent": "tonyxin-sites-boulder-atlas/1.0"})
                data = urllib.request.urlopen(req, timeout=60).read()
                if data[:4] != b"\x89PNG":
                    raise ValueError("not a png")
                open(out, "wb").write(data)
                break
            except Exception as ex:  # noqa: BLE001
                print("retry", b["id"], ex, flush=True)
                time.sleep(3 * (attempt + 1))
        time.sleep(0.25)
        if i % 25 == 0:
            print("chip", i, "/", len(region["boulders"]), flush=True)
    print("fetched", flush=True)


def trace_one(img, b):
    import numpy as np
    from scipy import ndimage as ndi
    from skimage import measure

    a = img.astype(np.float32)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    V = (R + G + B) / 3
    warm = (R - B) / (V + 1)
    edge = np.ones(V.shape, bool)
    m = int(PX * 0.1)
    edge[m:-m, m:-m] = False
    v_bg, w_bg = np.median(V[edge]), np.median(warm[edge])
    w_mad = np.median(np.abs(warm[edge] - w_bg)) + 0.004
    # Rock: noticeably more neutral (less warm) than the ground, and not in deep shadow.
    rock = (warm < w_bg - 1.6 * w_mad) & (V > v_bg * 0.7)
    rock = ndi.binary_opening(rock, iterations=2)
    rock = ndi.binary_closing(rock, iterations=3)
    rock = ndi.binary_fill_holes(rock)
    shadow = V < v_bg * 0.6
    lab, n = ndi.label(rock)
    if n == 0:
        return None
    cy = cx = PX / 2
    yy, xx = np.mgrid[0:PX, 0:PX]
    best, best_score = None, 0
    for k in range(1, n + 1):
        comp = lab == k
        area_px = comp.sum()
        area_m2 = area_px * M_PER_PX ** 2
        if area_m2 < 4 or area_m2 > 1600:
            continue
        ys, xs = np.nonzero(comp)
        if ys.min() <= 1 or xs.min() <= 1 or ys.max() >= PX - 2 or xs.max() >= PX - 2:
            continue  # runs off the chip: probably terrain, not a boulder
        d = math.hypot(ys.mean() - cy, xs.mean() - cx) * M_PER_PX
        if d > SEARCH_M:
            continue
        # A real boulder casts a shadow right next to it.
        ring = ndi.binary_dilation(comp, iterations=6) & ~comp
        shade = (shadow & ring).sum() / max(1, ring.sum())
        if shade < 0.06:
            continue
        score = area_m2 ** 0.5 * (1 - d / (SEARCH_M * 1.5)) * (0.5 + shade)
        if score > best_score:
            best, best_score = (comp, area_m2, d, shade), score
    if not best:
        return None
    comp, area_m2, d, shade = best
    # Include the rock's own shadowed faces (dark pixels hugging the lit rock), not the cast shadow.
    hug = ndi.binary_dilation(comp, iterations=4) & shadow
    comp = ndi.binary_fill_holes(comp | hug)
    comp = ndi.binary_opening(comp, iterations=1)
    lab2, _ = ndi.label(comp)
    keep = lab2 == lab2[tuple(np.round(np.argwhere(best[0]).mean(0)).astype(int))] if lab2[tuple(np.round(np.argwhere(best[0]).mean(0)).astype(int))] else comp
    hull_area = _hull_area(np.argwhere(keep))
    solidity = keep.sum() / max(1.0, hull_area)
    if solidity < 0.72:
        return None
    contours = measure.find_contours(keep.astype(float), 0.5)
    if not contours:
        return None
    c = max(contours, key=len)
    c = measure.approximate_polygon(c, tolerance=0.9)
    if len(c) < 5:
        return None
    w, s, e, n_ = bbox(b["lat"], b["lon"])
    ring_ll = [[round(n_ - (r / PX) * (n_ - s), 6), round(w + (col / PX) * (e - w), 6)] for r, col in c]
    return {"ring": ring_ll, "area_m2": round(float(keep.sum() * M_PER_PX ** 2), 1), "offset_m": round(d, 1),
            "shade": round(float(shade), 2), "solidity": round(float(solidity), 2), "src": "naip", "px": c.tolist()}


def _hull_area(pts):
    from scipy.spatial import ConvexHull
    if len(pts) < 4:
        return float(len(pts))
    try:
        return float(ConvexHull(pts).volume)
    except Exception:  # noqa: BLE001
        return float(len(pts))


def trace(region, chips, out, sheet=None):
    import numpy as np
    from PIL import Image, ImageDraw

    res, tiles = {}, []
    for b in region["boulders"]:
        p = os.path.join(chips, f"{b['id']}.png")
        if not os.path.exists(p):
            continue
        img = np.array(Image.open(p).convert("RGB"))
        r = trace_one(img, b)
        if r:
            res[str(b["id"])] = {k: v for k, v in r.items() if k != "px"}
        if sheet:
            im = Image.fromarray(img).resize((144, 144))
            dr = ImageDraw.Draw(im)
            dr.ellipse([70, 70, 74, 74], outline=(0, 120, 255))
            if r:
                dr.line([(x / 2, y / 2) for y, x in r["px"]] + [(r["px"][0][1] / 2, r["px"][0][0] / 2)], fill=(255, 220, 0), width=2)
            dr.text((3, 2), b["name"][:22], fill=(255, 255, 255))
            tiles.append(im)
    json.dump(res, open(out, "w"))
    print(f"traced {len(res)} of {len(region['boulders'])} boulders", flush=True)
    if sheet and tiles:
        cols = 12
        rows = math.ceil(len(tiles) / cols)
        canvas = Image.new("RGB", (cols * 144, rows * 144), (30, 30, 30))
        for i, t in enumerate(tiles):
            canvas.paste(t, ((i % cols) * 144, (i // cols) * 144))
        canvas.save(sheet)


if __name__ == "__main__":
    cmd, region_path, chips = sys.argv[1:4]
    region = json.load(open(region_path))
    if cmd == "fetch":
        fetch(region, chips)
    else:
        sheet = sys.argv[sys.argv.index("--sheet") + 1] if "--sheet" in sys.argv else None
        trace(region, chips, sys.argv[4], sheet)
