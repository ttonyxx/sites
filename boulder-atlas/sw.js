// Boulder Atlas service worker: the app works with no signal once it has been opened online.
//  - atlas-shell-*: app code, fonts, icons (precached, versioned)
//  - atlas-data:    region files (network first, cached copy when offline)
//  - atlas-dl:      things a climber chose to download (beta video thumbnails); cache first
//  - atlas-lib:     Firebase SDK modules for sign-in (versioned URLs, cache first)
const SHELL = "atlas-shell-v9";
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

async function networkFirst(req, cacheName) {
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (res.ok) { const copy = res.clone(); caches.open(cacheName).then((c) => c.put(req, copy)); }
    return res;
  } catch {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") return (await caches.match("index.html")) || Response.error();
    return Response.error();
  }
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
    e.respondWith(networkFirst(req, url.pathname.includes("/data/") ? "atlas-data" : SHELL));
  } else if (url.hostname === "i.ytimg.com") {
    e.respondWith(cacheFirst(req, "atlas-dl", false).catch(() => Response.error()));
  } else if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    e.respondWith(cacheFirst(req, "atlas-lib", true));
  }
});
