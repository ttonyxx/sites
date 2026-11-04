"""Look up title + channel for every beta video linked from cached Mountain Project problem pages.

Uses the public oEmbed endpoints (no API key). Videos that are deleted or private come back as
errors and are marked {"dead": true} so the build drops them. Incremental: re-running only fetches
videos it hasn't seen.

Usage: python3 -I tools/fetch_video_titles.py <mp-cache> <video-titles.json>
"""
import glob
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CACHE, OUT = sys.argv[1:3]
known = json.load(open(OUT)) if os.path.exists(OUT) else {}
ids = set()
for f in glob.glob(os.path.join(CACHE, "route_*.html")):
    s = open(f, encoding="utf-8").read()
    for u in re.findall(r'data-video-embed="([^"]+)"', s):
        y = re.search(r"youtube(?:-nocookie)?\.com/embed/([A-Za-z0-9_-]{11})", u)
        v = re.search(r"vimeo\.com/(?:video/)?(\d{5,})", u)
        if y:
            ids.add(f"y:{y.group(1)}")
        elif v:
            ids.add(f"v:{v.group(1)}")
todo = sorted(i for i in ids if i not in known)
print(len(ids), "videos,", len(todo), "to look up", flush=True)
for n, k in enumerate(todo):
    kind, vid = k.split(":", 1)
    watch = f"https://www.youtube.com/watch?v={vid}" if kind == "y" else f"https://vimeo.com/{vid}"
    api = ("https://www.youtube.com/oembed?format=json&url=" if kind == "y" else "https://vimeo.com/api/oembed.json?url=") + urllib.parse.quote(watch, safe="")
    try:
        req = urllib.request.Request(api, headers={"User-Agent": "tonyxin-sites-boulder-atlas/1.0"})
        d = json.loads(urllib.request.urlopen(req, timeout=20).read())
        known[k] = {"title": d.get("title"), "author": d.get("author_name")}
    except urllib.error.HTTPError as e:
        if e.code in (400, 401, 403, 404):
            known[k] = {"dead": True}
        else:
            print("skip", k, e, flush=True)
    except Exception as e:  # noqa: BLE001
        print("skip", k, e, flush=True)
    if n % 50 == 0:
        json.dump(known, open(OUT, "w"))
        print(n, "/", len(todo), flush=True)
    time.sleep(0.25)
json.dump(known, open(OUT, "w"))
print("DONE", sum(1 for v in known.values() if v.get("dead")), "dead of", len(known), flush=True)
