#!/bin/sh
# Roads, 4WD tracks and climber trails around the Buttermilks from OpenStreetMap (Overpass API).
# Usage: tools/fetch_paths.sh <out.json>
curl -s -m 120 -A "tonyxin-sites-buttermilks/1.0" \
  --data-urlencode 'data=[out:json][timeout:60];(way["highway"](37.280,-118.660,37.350,-118.550););out geom;' \
  https://overpass-api.de/api/interpreter -o "$1"
