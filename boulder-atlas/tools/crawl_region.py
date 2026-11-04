"""Polite crawl of every bouldering area inside a Mountain Project region.

Usage: python3 -I tools/crawl_region.py <cache-dir> <csv-dir> <region-area-url>

<csv-dir> holds Mountain Project "route finder" CSV exports (type=boulder) for the region's
sub-areas (one export is capped at 1000 rows, so export each sub-area separately). Those CSVs say
which problems are boulders and which area names contain them, so the crawl only walks areas that
hold boulders and only fetches boulder problem pages. Pages are cached; re-running is cheap.
"""
import csv
import glob
import json
import os
import re
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

CACHE, CSV_DIR, ROOT = sys.argv[1:4]
os.makedirs(CACHE, exist_ok=True)
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
lock = threading.Lock()


def key(url):
    return re.sub(r"[^a-z0-9]+", "_", url.split(".com/")[1])[:120] + ".html"


def get(url):
    p = os.path.join(CACHE, key(url))
    if os.path.exists(p):
        return open(p, encoding="utf-8").read()
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            s = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "replace")
            open(p, "w", encoding="utf-8").write(s)
            time.sleep(0.6)
            return s
        except Exception as e:  # noqa: BLE001
            print("retry", url, e, flush=True)
            time.sleep(4 * (attempt + 1))
    return ""


def norm(name):
    n = name.lower().strip()
    m = re.match(r"^(.*), (the|a)$", n)
    if m:
        n = f"{m.group(2)} {m.group(1)}"
    return re.sub(r"[^a-z0-9]+", "", n)


boulder_routes, names = set(), set()
for f in glob.glob(os.path.join(CSV_DIR, "*.csv")):
    for row in csv.DictReader(open(f, encoding="utf-8")):
        boulder_routes.add(row["URL"].strip())
        for part in row["Location"].split(" > "):
            names.add(norm(part))
print("boulder problems in CSVs:", len(boulder_routes), flush=True)

areas, routes = [], []


def walk(url, depth=0):
    s = get(url)
    subs = re.findall(r'<div class="lef-nav-row">\s*<a href="(https://www.mountainproject.com/area/\d+/[^"]+)">([^<]+)</a>', s)
    table = s.split('id="left-nav-route-table"')[1].split("</table>")[0] if 'id="left-nav-route-table"' in s else ""
    rts = [r for r in re.findall(r'href="(https://www.mountainproject.com/route/\d+/[^"]+)"', table) if r in boulder_routes]
    areas.append(url)
    print("  " * depth + url.split("/area/")[1], len(subs), len(rts), flush=True)
    for r in rts:
        if r not in routes:
            routes.append(r)
    for u, name in subs:
        import html as _h
        if norm(_h.unescape(name)) in names:
            walk(u, depth + 1)


walk(ROOT)
print("areas", len(areas), "boulder routes found in tree", len(routes), "missing", len(boulder_routes - set(routes)), flush=True)
for r in sorted(boulder_routes - set(routes)):
    print("not in tree:", r, flush=True)

done = [0]


def fetch(r):
    get(r)
    with lock:
        done[0] += 1
        if done[0] % 50 == 0:
            print("route", done[0], "/", len(routes), flush=True)


with ThreadPoolExecutor(max_workers=2) as ex:
    list(ex.map(fetch, routes))
json.dump({"areas": areas, "routes": routes}, open(os.path.join(CACHE, "_region_index.json"), "w"))
print("DONE", flush=True)
