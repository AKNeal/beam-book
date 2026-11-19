/* Beam app service worker. Lets phones install Beam to the home screen.
   Deliberately simple: pages and data always come from the network (bookings must never be stale).
   Only when the phone is offline does it show a small "You're offline" page instead of the browser's error. */
const CACHE = "beam-shell-v2";
const OFFLINE = "/offline"; // cleanUrls serves offline.html here (no redirect)

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/assets/brand/beam-icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return; // everything else goes straight to the network as usual
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
