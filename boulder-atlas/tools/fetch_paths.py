"""Fetch OpenStreetMap ways for a region: highways across the whole region, and every road, track
and trail around each bouldering area. Uses the Overpass API.

Usage: python3 -I tools/fetch_paths.py <region.json> <out-osm.json>
"""
import json
import sys
import time
import urllib.parse
import urllib.request

region = json.load(open(sys.argv[1]))
pad = 0.006  # ~600 m around each area
lat = [b["lat"] for b in region["boulders"]]
lon = [b["lon"] for b in region["boulders"]]
big = f"{min(lat) - 0.05},{min(lon) - 0.06},{max(lat) + 0.05},{max(lon) + 0.06}"
parts = [f'way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]({big});']
for a in region["areas"]:
    s, w, n, e = a["bbox"]
    parts.append(f'way["highway"]({s - pad},{w - pad},{n + pad},{e + pad});')
q = "[out:json][timeout:180];(" + "".join(parts) + ");out geom;"
data = urllib.parse.urlencode({"data": q}).encode()
for url in ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]:
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "tonyxin-sites-boulder-atlas/1.0"})
            body = urllib.request.urlopen(req, timeout=240).read()
            json.loads(body)
            open(sys.argv[2], "wb").write(body)
            print("ok", url, len(body) // 1024, "KB")
            sys.exit(0)
        except Exception as e:  # noqa: BLE001
            print("retry", url, e)
            time.sleep(10 * (attempt + 1))
sys.exit("overpass failed")
