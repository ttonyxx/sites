# Boulder Atlas

**Live:** https://tonyxin.com/sites/boulder-atlas/ (the old `/sites/buttermilks/` link redirects here)

An offline-first map of bouldering areas, built to grow into an atlas of the world's bouldering.
It starts with **Bishop, CA**: 1,527 problems on 339 boulders across 11 areas (Buttermilks, Happy &
Sad Boulders, Druid Stones, and smaller spots).

- **Atlas map**: zoomed out, each area is a labeled pill; tap one to fly in. Boulders are drawn at
  real-world size as map shapes (they scale smoothly while zooming). Roads, 4WD tracks and climber
  trails come from OpenStreetMap; a satellite layer is one tap away.
- **Your location**: GPS dot (plus a compass cone on phones that share heading), the nearest
  boulder, and distance and direction to anything you select. GPS needs no data connection.
- **Boulder drawings**: each boulder is drawn "unrolled" to scale next to a 5′9″ climber, every
  problem a numbered line left → right, reaching its listed height and colored by grade.
- **Catalog**: search by name or grade (`v4`, `v6+`, `vb`), filter by area, grade band and stars,
  sort by grade, stars, name or nearest-to-you.
- **Beta videos**: the videos climbers posted on each problem's Mountain Project page (973 of them),
  with titles and thumbnails, plus a YouTube search for more.
- **Saved & downloaded climbs**: Save keeps a climb in your list (synced across devices when signed
  in with Google). Download keeps the climb, its beta notes and its video list with thumbnails on the
  device for use with no signal. (YouTube/Vimeo don't allow saving the videos themselves.)
- **Offline / install**: a service worker keeps the app and the whole region on the device after the
  first visit. "Add to Home Screen" (iPhone) or "Install" (Android/desktop) makes it an app.

## Accounts (Google sign-in)

`auth.js` uses Firebase Auth (Google provider) + Cloud Firestore. It's off until
`firebase-config.js` sets `window.ATLAS_FIREBASE` to the project's web config. Firestore rules live
in `firestore.rules`: each person can only read/write `users/{their uid}` = `{ saved: {problemId:
savedAt}, updatedAt }`. Add the site's domain under Authentication → Settings → Authorized domains.

## Data

Generated, not hand-edited: `data/regions.json` (the atlas index) and one file per region in
`data/regions/`. To rebuild Bishop:

```sh
# 1. Mountain Project route-finder CSV exports (type=boulder), one per sub-area (each export caps at 1000 rows)
# 2. Crawl the region's boulder areas + problem pages (cached; ~1 request/sec)
python3 -I tools/crawl_region.py /tmp/mp-cache /tmp/mp-csv https://www.mountainproject.com/area/106064825/bishop-area
# 3. Titles for the beta videos (oEmbed; drops deleted/private videos)
python3 -I tools/fetch_video_titles.py /tmp/mp-cache /tmp/video-titles.json
# 4. Build (writes data/regions/bishop.json and updates data/regions.json)
python3 -I tools/build_region.py --cache /tmp/mp-cache --csv /tmp/mp-csv --osm /tmp/osm.json \
  --videos /tmp/video-titles.json --root https://www.mountainproject.com/area/106064825/bishop-area \
  --id bishop --name Bishop --place "California, USA" --out data
# 5. OpenStreetMap paths for every area (uses the built region to pick bounding boxes), then build again
python3 -I tools/fetch_paths.py data/regions/bishop.json /tmp/osm.json
```

Only facts are kept (names, grades, stars, heights, GPS, first ascent, the short "Location" note,
links to climbers' videos); full write-ups stay on Mountain Project, linked from every problem.
After changing data or code, bump `SHELL` in `sw.js` so installed copies update.

Fonts: [Barlow](https://github.com/jpt/barlow) (SIL OFL 1.1, `vendor/fonts/OFL.txt`).
