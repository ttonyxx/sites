"""Download Mountain Project "route finder" CSV exports of every boulder problem in an area.

Usage: python3 -I tools/export_boulders.py <csv-dir> <area-url>

One export is capped at 1000 rows, so an area that hits the cap is split into its sub-areas
(recursively) and each is exported on its own. The CSVs feed tools/crawl_region.py.
"""
import csv
import html
import io
import os
import re
import sys
import time
import urllib.request

OUT, ROOT = sys.argv[1:3]
os.makedirs(OUT, exist_ok=True)
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
Q = ("type=boulder&diffMinrock=1800&diffMinboulder=20000&diffMinaid=70000&diffMinice=30000&diffMinmixed=50000"
     "&diffMaxrock=5500&diffMaxboulder=21700&diffMaxaid=75260&diffMaxice=38500&diffMaxmixed=60000"
     "&is_trad_climb=1&is_sport_climb=1&is_top_rope=1&stars=0&pitches=0&sort1=area&sort2=rating")


def fetch(url):
    for attempt in range(5):
        try:
            s = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60).read().decode("utf-8", "replace")
            time.sleep(0.8)
            return s
        except Exception as e:  # noqa: BLE001
            print("retry", url, e, flush=True)
            time.sleep(5 * (attempt + 1))
    return ""


def export(area_id, name, depth=0):
    text = fetch(f"https://www.mountainproject.com/route-finder-export?selectedIds={area_id}&{Q}")
    rows = list(csv.DictReader(io.StringIO(text))) if text.startswith("Route") else []
    print("  " * depth + f"{name} ({area_id}): {len(rows)}", flush=True)
    if len(rows) < 1000:
        if rows:
            open(os.path.join(OUT, f"{area_id}.csv"), "w", encoding="utf-8").write(text)
        return len(rows)
    page = fetch(f"https://www.mountainproject.com/area/{area_id}")
    subs = re.findall(r'<div class="lef-nav-row">\s*<a href="https://www.mountainproject.com/area/(\d+)/[^"]+">([^<]+)</a>', page)
    if not subs:  # a single area with 1000+ problems; keep what we got
        open(os.path.join(OUT, f"{area_id}.csv"), "w", encoding="utf-8").write(text)
        return len(rows)
    return sum(export(i, html.unescape(n), depth + 1) for i, n in subs)


m = re.search(r"/area/(\d+)", ROOT)
total = export(m.group(1), ROOT.rstrip("/").split("/")[-1])
print("total boulder problems:", total)
