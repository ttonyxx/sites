# Buttermilks Boulders

**Live:** https://tonyxin.com/sites/buttermilks/

A phone-first map and catalog of every boulder problem in the Buttermilks (Bishop, CA).

- **Simple map**: roads, 4WD tracks and climber trails (OpenStreetMap) plus every boulder, drawn
  at roughly real-world footprint. A satellite layer is one tap away.
- **Your location**: the page asks for GPS on load, shows a blue dot (with a compass cone on phones
  that share heading), the nearest boulder, and distance/direction to whatever you've selected.
- **Boulder drawings**: each boulder is drawn "unrolled" to scale next to a 5′9″ climber. Every
  problem is a numbered line, left → right in Mountain Project's order, reaching its listed height
  and colored by grade. Dashed lines mean the height wasn't listed.
- **Catalog**: every problem with grade, stars, height, and a "where on the boulder" note.
  Search by name or grade (`v4`, `v6+`, `vb`), filter by grade band and stars, sort by grade, stars,
  name or nearest-to-you.
- **Offline**: a service worker caches the app and data, so the simple map works with no signal.

## Data

`data/buttermilks.json` is generated, not hand-edited. To refresh it:

```sh
python3 -I tools/crawl.py /tmp/mp-cache            # polite crawl of Mountain Project (~10–15 min)
tools/fetch_paths.sh /tmp/osm-ways.json            # OSM roads/trails
python3 -I tools/build_data.py /tmp/mp-cache /tmp/osm-ways.json data/buttermilks.json
```

Only facts are kept (names, grades, stars, heights, GPS, first ascent, a short location note);
each problem links back to Mountain Project for full beta, photos and comments. Then bump `CACHE`
in `sw.js` so phones pick up the new data.
