import re, os, sys, time, urllib.request, json
CACHE = sys.argv[1]
os.makedirs(CACHE, exist_ok=True)
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
def get(url):
    key = re.sub(r'[^a-z0-9]+', '_', url.split('.com/')[1])[:120] + '.html'
    p = os.path.join(CACHE, key)
    if os.path.exists(p): return open(p, encoding='utf-8').read()
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            s = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
            open(p, 'w', encoding='utf-8').write(s); time.sleep(0.8); return s
        except Exception as e:
            print('retry', url, e, flush=True); time.sleep(3 * (attempt + 1))
    return ''
areas, routes = [], []
def crawl(url, depth=0):
    s = get(url)
    subs = re.findall(r'<div class="lef-nav-row">\s*<a href="(https://www.mountainproject.com/area/\d+/[^"]+)"', s)
    rts = re.findall(r'href="(https://www.mountainproject.com/route/\d+/[^"]+)"', s.split('left-nav-route-table')[1] if 'left-nav-route-table' in s else '')
    areas.append(url); print('  ' * depth + url, len(subs), len(rts), flush=True)
    for r in rts:
        if r not in routes: routes.append(r)
    for u in subs:
        if 'buttermilk-crags' in u: continue  # trad crag, not bouldering
        crawl(u, depth + 1)
crawl('https://www.mountainproject.com/area/105876411/buttermilk-country')
print('areas', len(areas), 'routes', len(routes), flush=True)
for i, r in enumerate(routes):
    get(r)
    if i % 25 == 0: print('route', i, flush=True)
json.dump({'areas': areas, 'routes': routes}, open(os.path.join(CACHE, '_index.json'), 'w'))
print('DONE', flush=True)
