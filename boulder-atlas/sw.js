// Boulder Atlas service worker: the app opens instantly from the device and works with no signal.
//  - atlas-shell-*: app code, fonts, icons (precached, versioned)
//  - atlas-data:    region files
//  - atlas-dl:      things a climber chose to download (beta video thumbnails); cache first
//  - atlas-lib:     Firebase SDK modules for sign-in (versioned URLs, cache first)
// App files and data are served from the cache right away and refreshed in the background
// (stale-while-revalidate). When a refresh brings a new version, open pages are told so they can
// switch to it.
const SHELL = "atlas-shell-v12";
const FILES = [
  "./", "index.html", "style.css", "app.js", "auth.js", "firebase-config.js", "manifest.webmanifest", "icon.svg",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css",
  "vendor/fonts/barlow-400.woff2", "vendor/fonts/barlow-500.woff2", "vendor/fonts/barlow-600.woff2", "vendor/fonts/barlow-700.woff2",
  "vendor/fonts/barlow-semi-condensed-600.woff2", "vendor/fonts/barlow-semi-condensed-700.woff2",
  "data/regions.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith("atlas-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const version = (res) => res && (res.headers.get("etag") || res.headers.get("last-modified") || "");

async function notifyUpdated(url) {
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((c) => c.postMessage({ type: "atlas-updated", url }));
}

async function staleWhileRevalidate(event, cacheName) {
  const req = event.request;
  const cache = await caches.open(cacheName);
  const hit = await caches.match(req, { ignoreSearch: true });
  const refresh = fetch(req, { cache: "no-cache" })
    .then(async (res) => {
      if (res.ok) {
        await cache.put(req, res.clone());
        if (hit && version(hit) && version(res) && version(hit) !== version(res)) await notifyUpdated(req.url);
      }
      return res;
    })
    .catch(() => null);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  const res = await refresh;
  if (res) return res;
  if (req.mode === "navigate") return (await caches.match("index.html")) || Response.error();
  return Response.error();
}

async function cacheFirst(req, cacheName, store) {
  const hit = await caches.match(req, { cacheName });
  if (hit) return hit;
  const res = await fetch(req);
  if (store && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(cacheName).then((c) => c.put(req, copy)); }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(staleWhileRevalidate(e, url.pathname.includes("/data/") ? "atlas-data" : SHELL));
  } else if (url.hostname === "i.ytimg.com") {
    e.respondWith(cacheFirst(req, "atlas-dl", false).catch(() => Response.error()));
  } else if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    e.respondWith(cacheFirst(req, "atlas-lib", true));
  }
});
