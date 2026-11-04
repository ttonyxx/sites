// The Buttermilks site moved to /sites/boulder-atlas/. Phones that installed the old service worker
// pick up this one, which clears the old cache and unregisters itself.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.delete("buttermilks-v1").then(() => self.registration.unregister()));
});
