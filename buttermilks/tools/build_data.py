"""Turn a local cache of Mountain Project pages + an OSM Overpass dump into data/buttermilks.json.

Usage: python3 -I tools/build_data.py <mp-cache-dir> <osm-ways.json> <out.json>

The cache is produced by crawling https://www.mountainproject.com/area/105876411/buttermilk-country
(every sub-area page plus every route page). Only facts are kept (names, grades, stars, heights,
coordinates, first ascent, the short "Location" note); full write-ups stay on Mountain Project.
"""
import html
import json
import math
import os
import re
import sys
from datetime import date

CACHE, OSM, OUT = sys.argv[1:4]
ROOT_URL = "https://www.mountainproject.com/area/105876411/buttermilk-country"


def key(url):
    return re.sub(r"[^a-z0-9]+", "_", url.split(".com/")[1])[:120] + ".html"


def page(url):
    p = os.path.join(CACHE, key(url))
    return open(p, encoding="utf-8").read() if os.path.exists(p) else ""


def text(fragment):
    t = re.sub(r"<br\s*/?>", "\n", fragment)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t)
    t = re.sub(r"[ \t\r\f\v]+", " ", t)
    t = re.sub(r"\s*\n\s*", "\n", t)
    return t.strip()


def mp_id(url):
    return int(re.search(r"/(\d+)/", url).group(1))


def title(s):
    m = re.search(r"<h1[^>]*>(.*?)</h1>", s, re.S)
    t = text(re.sub(r"<span[^>]*>.*?</span>|<a[^>]*>.*?</a>", "", m.group(1), flags=re.S)) if m else ""
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s+Climbing$", "", t)
    m2 = re.match(r"^(.*), (The|A)$", t)
    return f"{m2.group(2)} {m2.group(1)}" if m2 else t


def gps(s):
    m = re.search(r"<td>GPS:</td>\s*<td>\s*([-\d.]+),\s*([-\d.]+)", s)
    return (float(m.group(1)), float(m.group(2))) if m else None


def sections(s):
    out = {}
    for m in re.finditer(
        r"<h2[^>]*>\s*(?:<a name=\"a_\d+\"></a>)?\s*([A-Za-z ]+?)\s*<!--EDIT.*?</h2>\s*<div class=\"fr-view\">(.*?)</div>",
        s,
        re.S,
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
    lo = int(m.group(1))
    n = (lo + int(m.group(2))) / 2 if m.group(2) else float(lo)
    if m.group(3) == "+":
        n += 0.25
    elif m.group(3) == "-":
        n -= 0.25
    return n


def shorten(t, n):
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) <= n:
        return t
    cut = t[:n].rsplit(" ", 1)[0]
    return cut.rstrip(",;:") + "…"


# ---------------------------------------------------------------- walk the area tree
areas, boulders, problems = {}, [], []


def walk(url, parent_id, trail):
    s = page(url)
    if not s:
        print("missing", url, file=sys.stderr)
        return
    aid = mp_id(url)
    name = title(s)
    areas[aid] = {"id": aid, "name": name, "parent": parent_id}
    subs = re.findall(
        r'<div class="lef-nav-row">\s*<a href="(https://www.mountainproject.com/area/\d+/[^"]+)"', s
    )
    subs = [u for u in subs if "buttermilk-crags" not in u]
    table = s.split('id="left-nav-route-table"')[1].split("</table>")[0] if 'id="left-nav-route-table"' in s else ""
    rows = re.findall(r'<tr data-az="\d+"\s+data-lr="(-?\d+)".*?href="(https://www.mountainproject.com/route/\d+/[^"]+)"', table, re.S)
    if rows:
        ll = gps(s)
        elev = re.search(r'Elevation:</td>\s*<td class="imperial">([\d,]+) ft', s)
        sec = sections(s)
        b = {
            "id": aid,
            "name": name,
            "url": url,
            "lat": ll[0] if ll else None,
            "lon": ll[1] if ll else None,
            "elev_ft": int(elev.group(1).replace(",", "")) if elev else None,
            "sector": trail[1] if len(trail) > 1 else name,
            "path": trail[1:],
            "approach": shorten(sec.get("Getting There", ""), 220),
            "problems": [],
        }
        boulders.append(b)
        for order, (lr, rurl) in enumerate(sorted(rows, key=lambda r: int(r[0]))):
            p = parse_route(rurl)
            if not p:
                continue
            p["boulder"] = aid
            p["order"] = order
            b["problems"].append(p["id"])
            problems.append(p)
    for u in subs:
        walk(u, aid, trail + [name])


def parse_route(url):
    s = page(url)
    if not s:
        print("missing route", url, file=sys.stderr)
        return None
    typ = re.search(r"<td>Type:</td>\s*<td>(.*?)</td>", s, re.S)
    typ = text(typ.group(1)) if typ else ""
    if "Boulder" not in typ:
        return None
    h = re.search(r"(\d+) ft", typ)
    g = re.search(r"<h2 class=\"inline-block mr-2\"><span class='rateYDS'>([^<]+)<", s)
    grade = g.group(1).strip() if g else "?"
    font = re.search(r"<span class='rateFont'>([^<]+)<", s)
    after = s.split("<h2 class=\"inline-block mr-2\">")[1].split("</h2>")[0] if "<h2 class=\"inline-block mr-2\">" in s else ""
    tail = re.sub(r"<span class='rate\w+'>.*?</span></span>", " ", after, flags=re.S)
    safety = re.search(r"\b(PG13|R|X)\b", text(tail))
    safety = safety.group(1) if safety else None
    stars = re.search(r"Avg:\s*([\d.]+)\s*from\s*([\d,]+)\s*vote", s)
    fa = re.search(r"<td>FA:</td>\s*<td>(.*?)</td>", s, re.S)
    sec = sections(s)
    ll = gps(s)
    return {
        "id": mp_id(url),
        "name": title(s),
        "url": url,
        "grade": grade,
        "g": grade_num(grade),
        "font": font.group(1).strip() if font else None,
        "safety": safety,
        "stars": float(stars.group(1)) if stars else None,
        "votes": int(stars.group(2).replace(",", "")) if stars else 0,
        "height_ft": int(h.group(1)) if h else None,
        "fa": shorten(text(fa.group(1)), 80) if fa else None,
        "where": shorten(sec.get("Location", ""), 200),
        "_ll": ll,
    }


walk(ROOT_URL, None, [])

# Route-level GPS is only interesting when it differs from its boulder's.
by_b = {b["id"]: b for b in boulders}
for p in problems:
    ll = p.pop("_ll")
    b = by_b[p["boulder"]]
    if ll and b["lat"] and (abs(ll[0] - b["lat"]) > 1e-5 or abs(ll[1] - b["lon"]) > 1e-5):
        d = math.hypot((ll[0] - b["lat"]) * 111000, (ll[1] - b["lon"]) * 88000)
        if d < 150:
            p["lat"], p["lon"] = ll

for b in boulders:
    if b["lat"] is None:
        print("no gps", b["name"], file=sys.stderr)

# Spread boulders that share identical coordinates so they don't stack.
seen = {}
for b in boulders:
    if b["lat"] is None:
        continue
    k = (round(b["lat"], 5), round(b["lon"], 5))
    n = seen.get(k, 0)
    seen[k] = n + 1
    if n:
        ang = n * 2.4
        b["lat"] += math.sin(ang) * 6 / 111000
        b["lon"] += math.cos(ang) * 6 / 88000
        b["approx"] = True

# ---------------------------------------------------------------- OSM paths
paths = []
try:
    osm = json.load(open(OSM))
    for e in osm.get("elements", []):
        if e.get("type") != "way" or "geometry" not in e:
            continue
        hw = e.get("tags", {}).get("highway")
        if not hw:
            continue
        kind = "road" if hw in ("primary", "secondary", "tertiary", "unclassified", "residential") else (
            "track" if hw in ("track", "service") else "trail"
        )
        paths.append({
            "k": kind,
            "n": e["tags"].get("name"),
            "c": [[round(pt["lat"], 6), round(pt["lon"], 6)] for pt in e["geometry"]],
        })
except FileNotFoundError:
    print("no osm file", file=sys.stderr)

data = {
    "generated": date.today().isoformat(),
    "source": "Mountain Project (mountainproject.com) · paths © OpenStreetMap contributors",
    "areas": sorted(areas.values(), key=lambda a: a["id"]),
    "boulders": [b for b in boulders if b["lat"] is not None],
    "problems": problems,
    "paths": paths,
}
json.dump(data, open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
print(len(data["boulders"]), "boulders", len(problems), "problems", len(paths), "paths", os.path.getsize(OUT) // 1024, "KB")
