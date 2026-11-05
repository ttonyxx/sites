"""Build one region's data file (e.g. data/regions/bishop.json) and the regions index.

Usage:
  python3 -I tools/build_region.py --cache <mp-cache> --csv <csv-dir> --osm <osm.json> \
      --root https://www.mountainproject.com/area/106064825/bishop-area \
      --id bishop --name Bishop --place "California, USA" \
      [--videos <video-titles.json>] [--outlines <outlines.json>] --out data

Inputs come from tools/crawl_region.py (cached Mountain Project pages + route-finder CSVs),
tools/fetch_paths.sh (OpenStreetMap ways) and optionally tools/fetch_video_titles.py and
tools/outlines.py. Only facts are kept (names, grades, stars, heights, GPS, first ascent, the short
"Location" note and links to climbers' beta videos); full write-ups stay on Mountain Project.
"""
import argparse
import csv
import glob
import html
import json
import math
import os
import re
import sys
from datetime import date

ap = argparse.ArgumentParser()
ap.add_argument("--cache", required=True)
ap.add_argument("--csv", required=True)
ap.add_argument("--osm", required=True)
ap.add_argument("--root", required=True)
ap.add_argument("--id", required=True)
ap.add_argument("--name", required=True)
ap.add_argument("--place", required=True)
ap.add_argument("--videos")
ap.add_argument("--outlines")
ap.add_argument("--out", required=True)
args = ap.parse_args()

# Top-level Mountain Project areas that are really groups of separate bouldering areas.
SPLIT = {"Volcanic Tablelands (Happy/Sad Boulders)"}
RENAME = {"Buttermilk Country": "Buttermilks"}


def key(url):
    return re.sub(r"[^a-z0-9]+", "_", url.split(".com/")[1])[:120] + ".html"


def page(url):
    p = os.path.join(args.cache, key(url))
    return open(p, encoding="utf-8").read() if os.path.exists(p) else ""


def text(fragment):
    t = re.sub(r"<br\s*/?>", "\n", fragment)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t)
    t = re.sub(r"[ \t\r\f\v]+", " ", t)
    return re.sub(r"\s*\n\s*", "\n", t).strip()


def mp_id(url):
    return int(re.search(r"/(\d+)/", url).group(1))


def nice(name):
    name = re.sub(r"\s+Climbing$", "", re.sub(r"\s+", " ", name).strip())
    m = re.match(r"^(.*), (The|A)$", name)
    return f"{m.group(2)} {m.group(1)}" if m else name


def title(s):
    m = re.search(r"<h1[^>]*>(.*?)</h1>", s, re.S)
    if not m:
        return ""
    return nice(text(re.sub(r"<span[^>]*>.*?</span>|<a[^>]*>.*?</a>", "", m.group(1), flags=re.S)))


def gps(s):
    m = re.search(r"<td>GPS:</td>\s*<td>\s*([-\d.]+),\s*([-\d.]+)", s)
    return (float(m.group(1)), float(m.group(2))) if m else None


def sections(s):
    out = {}
    for m in re.finditer(
        r"<h2[^>]*>\s*(?:<a name=\"a_\d+\"></a>)?\s*([A-Za-z ]+?)\s*<!--EDIT.*?</h2>\s*<div class=\"fr-view\">(.*?)</div>", s, re.S
    ):
        out[m.group(1).strip()] = text(m.group(2))
    return out


def grade_num(g):
    g = g.strip()
    if g.lower().startswith("v-easy") or g.upper().startswith("VB"):
        return -1.0
    m = re.match(r"V(\d+)(?:-(\d+))?([+-])?", g)
    if not m:
        return None
    n = (int(m.group(1)) + int(m.group(2))) / 2 if m.group(2) else float(m.group(1))
    return n + (0.25 if m.group(3) == "+" else -0.25 if m.group(3) == "-" else 0)


def shorten(t, n):
    t = re.sub(r"\s+", " ", t or "").strip()
    if len(t) <= n:
        return t
    return t[:n].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# ------------------------------------------------------------------ CSV facts (fallback + boulder filter)
csv_rows = {}
for f in glob.glob(os.path.join(args.csv, "*.csv")):
    for row in csv.DictReader(open(f, encoding="utf-8")):
        csv_rows[row["URL"].strip()] = row

videos_meta = json.load(open(args.videos)) if args.videos and os.path.exists(args.videos) else {}
outlines = json.load(open(args.outlines)) if args.outlines and os.path.exists(args.outlines) else {}

VIDEO_RE = re.compile(
    r'data-video-embed="(?P<url>[^"]+)"\s+aria-label="Play video from comment by (?P<by>[^"]*)".*?video-tile-date[^>]*>(?P<date>[^<]*)<',
    re.S,
)


def parse_videos(s):
    out, seen = [], set()
    for m in VIDEO_RE.finditer(s):
        u = html.unescape(m.group("url"))
        y = re.search(r"youtube(?:-nocookie)?\.com/embed/([A-Za-z0-9_-]{11})", u)
        v = re.search(r"vimeo\.com/(?:video/)?(\d{5,})", u)
        vid = ("y", y.group(1)) if y else ("v", v.group(1)) if v else None
        if not vid or vid in seen:
            continue
        seen.add(vid)
        meta = videos_meta.get(f"{vid[0]}:{vid[1]}")
        if meta is not None and meta.get("dead"):
            continue  # deleted or private video
        item = {vid[0]: vid[1], "by": html.unescape(m.group("by")).strip()}
        if meta and meta.get("title"):
            item["t"] = shorten(meta["title"], 90)
            item["ch"] = meta.get("author")
        d = m.group("date").strip()
        yr = re.search(r"(\d{4})", d)
        if yr:
            item["yr"] = int(yr.group(1))
        out.append(item)
    return out


def from_csv(url):
    row = csv_rows[url]
    rating = row["Rating"].strip()
    safety = re.search(r"\b(PG13|R|X)$", rating)
    grade = re.sub(r"\s*\b(PG13|R|X)$", "", rating).strip()
    stars = float(row["Avg Stars"]) if row["Avg Stars"] not in ("", "-1") else None
    return {
        "id": mp_id(url),
        "name": nice(row["Route"]),
        "url": url,
        "grade": grade,
        "g": grade_num(grade),
        "font": None,
        "safety": safety.group(1) if safety else None,
        "stars": stars,
        "votes": 0,
        "height_ft": int(row["Length"]) if row["Length"].strip().isdigit() else None,
        "fa": None,
        "where": "",
        "videos": [],
        "_ll": None,
    }


def parse_route(url):
    s = page(url)
    if not s:
        return from_csv(url) if url in csv_rows else None
    typ = re.search(r"<td>Type:</td>\s*<td>(.*?)</td>", s, re.S)
    typ = text(typ.group(1)) if typ else ""
    if "Boulder" not in typ:
        return None
    h = re.search(r"(\d+) ft", typ)
    g = re.search(r"<h2 class=\"inline-block mr-2\"><span class='rateYDS'>([^<]+)<", s)
    grade = g.group(1).strip() if g else "?"
    font = re.search(r"<span class='rateFont'>([^<]+)<", s)
    after = s.split('<h2 class="inline-block mr-2">')[1].split("</h2>")[0] if '<h2 class="inline-block mr-2">' in s else ""
    tail = re.sub(r"<span class='rate\w+'>.*?</span></span>", " ", after, flags=re.S)
    safety = re.search(r"\b(PG13|R|X)\b", text(tail))
    stars = re.search(r"Avg:\s*([\d.]+)\s*from\s*([\d,]+)\s*vote", s)
    fa = re.search(r"<td>FA:</td>\s*<td>(.*?)</td>", s, re.S)
    sec = sections(s)
    return {
        "id": mp_id(url),
        "name": title(s),
        "url": url,
        "grade": grade,
        "g": grade_num(grade),
        "font": font.group(1).strip() if font else None,
        "safety": safety.group(1) if safety else None,
        "stars": float(stars.group(1)) if stars else None,
        "votes": int(stars.group(2).replace(",", "")) if stars else 0,
        "height_ft": int(h.group(1)) if h else None,
        "fa": shorten(text(fa.group(1)), 80) if fa else None,
        "where": shorten(sec.get("Location", ""), 200),
        "videos": parse_videos(s),
        "_ll": gps(s),
    }


# ------------------------------------------------------------------ walk the region
areas, boulders, problems = {}, [], []


def walk(url, trail):
    s = page(url)
    if not s:
        return
    name = title(s)
    subs = re.findall(r'<div class="lef-nav-row">\s*<a href="(https://www.mountainproject.com/area/\d+/[^"]+)"', s)
    subs = [u for u in subs if "buttermilk-crags" not in u]
    table = s.split('id="left-nav-route-table"')[1].split("</table>")[0] if 'id="left-nav-route-table"' in s else ""
    rows = re.findall(r'<tr data-az="\d+"\s+data-lr="(-?\d+)".*?href="(https://www.mountainproject.com/route/\d+/[^"]+)"', table, re.S)
    rows = [r for r in rows if r[1] in csv_rows]
    here = trail + [name]
    if rows and len(here) > 1:
        top = here[1]
        area_name = here[2] if top in SPLIT and len(here) > 2 else RENAME.get(top, top)
        area_name = re.sub(r"\s+(Bouldering|Area)$", "", area_name)
        aid = slug(area_name)
        if aid not in areas:
            areas[aid] = {"id": aid, "name": area_name, "url": None}
        ll = gps(s)
        elev = re.search(r'Elevation:</td>\s*<td class="imperial">([\d,]+) ft', s)
        sec = sections(s)
        depth_in_area = 3 if top in SPLIT else 2
        b = {
            "id": mp_id(url),
            "name": name,
            "url": url,
            "lat": ll[0] if ll else None,
            "lon": ll[1] if ll else None,
            "elev_ft": int(elev.group(1).replace(",", "")) if elev else None,
            "area": aid,
            "sector": here[depth_in_area] if len(here) > depth_in_area + 1 else area_name,
            "path": here[1:],
            "approach": shorten(sec.get("Getting There", ""), 220),
            "problems": [],
        }
        boulders.append(b)
        for order, (lr, rurl) in enumerate(sorted(rows, key=lambda r: int(r[0]))):
            p = parse_route(rurl)
            if not p:
                continue
            p["boulder"] = b["id"]
            p["order"] = order
            b["problems"].append(p["id"])
            problems.append(p)
    for u in subs:
        walk(u, here)


walk(args.root, [])
by_b = {b["id"]: b for b in boulders}

# Route-level GPS only matters when it differs (a little) from the boulder's.
for p in problems:
    ll = p.pop("_ll")
    b = by_b[p["boulder"]]
    if ll and b["lat"] and (abs(ll[0] - b["lat"]) > 1e-5 or abs(ll[1] - b["lon"]) > 1e-5):
        d = math.hypot((ll[0] - b["lat"]) * 111000, (ll[1] - b["lon"]) * 88000)
        if d < 150:
            p["lat"], p["lon"] = ll
    if not p["videos"]:
        p.pop("videos")

missing_gps = [b["name"] for b in boulders if b["lat"] is None]
if missing_gps:
    print("no GPS (dropped):", missing_gps, file=sys.stderr)
boulders = [b for b in boulders if b["lat"] is not None]
keep = {b["id"] for b in boulders}
problems = [p for p in problems if p["boulder"] in keep]

# Spread boulders that share identical coordinates so they don't stack.
seen = {}
for b in boulders:
    k = (round(b["lat"], 5), round(b["lon"], 5))
    n = seen.get(k, 0)
    seen[k] = n + 1
    if n:
        ang = n * 2.4
        b["lat"] += math.sin(ang) * 6 / 111000
        b["lon"] += math.cos(ang) * 6 / 88000
        b["approx"] = True
    o = outlines.get(str(b["id"]))
    if o:
        # The traced rock is where the boulder really is: move the point there (it drives pins,
        # distances and directions), keeping Mountain Project's original GPS for reference.
        b["outline"] = o["ring"]
        b["outline_src"] = o.get("src", "satellite")
        b["mp_gps"] = [b["lat"], b["lon"]]
        b["lat"] = round(sum(p[0] for p in o["ring"]) / len(o["ring"]), 6)
        b["lon"] = round(sum(p[1] for p in o["ring"]) / len(o["ring"]), 6)

# Areas: center, bounds and counts.
for aid, a in areas.items():
    bs = [b for b in boulders if b["area"] == aid]
    if not bs:
        continue
    lats = sorted(b["lat"] for b in bs)
    lons = sorted(b["lon"] for b in bs)
    a["lat"] = round(lats[len(lats) // 2], 5)
    a["lon"] = round(lons[len(lons) // 2], 5)
    a["bbox"] = [round(min(lats), 5), round(min(lons), 5), round(max(lats), 5), round(max(lons), 5)]
    a["boulders"] = len(bs)
    a["problems"] = sum(len(b["problems"]) for b in bs)
area_list = sorted((a for a in areas.values() if a.get("boulders")), key=lambda a: -a["problems"])

# ------------------------------------------------------------------ OSM paths
def simplify(pts, tol_m=1.5):
    """Douglas-Peucker in a local metric projection: drops points that change the line by < tol_m."""
    if len(pts) < 3:
        return pts
    lat0 = math.radians(sum(p[0] for p in pts) / len(pts))
    xy = [(p[1] * 111320 * math.cos(lat0), p[0] * 111320) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        best, bi = 0.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            if L2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best:
                best, bi = d, i
        if best > tol_m and bi > 0:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


paths = []
osm = json.load(open(args.osm))
for e in osm.get("elements", []):
    if e.get("type") != "way" or "geometry" not in e:
        continue
    hw = e.get("tags", {}).get("highway")
    if not hw:
        continue
    if hw in ("motorway", "trunk", "primary", "secondary"):
        kind = "hwy"
    elif hw in ("tertiary", "unclassified", "residential"):
        kind = "road"
    elif hw in ("track", "service"):
        kind = "track"
    else:
        kind = "trail"
    coords = [[round(pt["lat"], 5), round(pt["lon"], 5)] for pt in e["geometry"]]
    paths.append({"k": kind, "n": e["tags"].get("name") or e["tags"].get("ref"), "c": simplify(coords, 3.0 if kind == "hwy" else 1.5)})

region = {
    "id": args.id,
    "name": args.name,
    "place": args.place,
    "generated": date.today().isoformat(),
    "source": "Mountain Project (mountainproject.com) · paths © OpenStreetMap contributors",
    "areas": area_list,
    "boulders": boulders,
    "problems": problems,
    "paths": paths,
}
os.makedirs(os.path.join(args.out, "regions"), exist_ok=True)
rel = f"regions/{args.id}.json"
out_file = os.path.join(args.out, rel)
json.dump(region, open(out_file, "w"), separators=(",", ":"), ensure_ascii=False)

# Regions index (the atlas' table of contents).
idx_file = os.path.join(args.out, "regions.json")
idx = json.load(open(idx_file)) if os.path.exists(idx_file) else {"regions": []}
lat_all = [b["lat"] for b in boulders]
lon_all = [b["lon"] for b in boulders]
entry = {
    "id": args.id,
    "name": args.name,
    "place": args.place,
    "file": rel,
    "bytes": os.path.getsize(out_file),
    "generated": region["generated"],
    "areas": [{"id": a["id"], "name": a["name"], "problems": a["problems"]} for a in area_list],
    "boulders": len(boulders),
    "problems": len(problems),
    "bbox": [min(lat_all), min(lon_all), max(lat_all), max(lon_all)],
}
idx["regions"] = [r for r in idx["regions"] if r["id"] != args.id] + [entry]
json.dump(idx, open(idx_file, "w"), indent=1, ensure_ascii=False)

nv = sum(len(p.get("videos", [])) for p in problems)
print(f"{args.name}: {len(area_list)} areas, {len(boulders)} boulders, {len(problems)} problems, "
      f"{sum(1 for p in problems if p.get('videos'))} with {nv} beta videos, {len(paths)} paths, {entry['bytes'] // 1024} KB")
for a in area_list:
    print(f"  {a['name']}: {a['problems']} problems on {a['boulders']} boulders")
