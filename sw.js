// Offline shell: serve the app's own files from cache, refresh them in the background.
const CACHE = "fitlog-v2";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "db.js", "ai.js",
  "foods.js", "vendor/anthropic-sdk.mjs", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "examples/nov-2026-block.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never cache API calls.
  if (url.hostname === "api.anthropic.com") return;
  const cacheable = url.origin === self.location.origin
    || url.hostname.endsWith("fonts.googleapis.com")
    || url.hostname.endsWith("fonts.gstatic.com");
  if (!cacheable) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const fresh = fetch(req).then((res) => {
        if (res.ok || res.type === "opaque") cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || fresh;
    }),
  );
});
