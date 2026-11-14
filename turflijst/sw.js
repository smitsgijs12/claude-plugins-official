/* Turflijst service worker. Only there so the app still opens without any reception (it then says
   "Geen verbinding" and connects by itself once there is reception) instead of the browser's error page.
   - Everything goes to the network first. The copy kept here is only used when the network fails,
     so a new version of the app is never held back: the next load with reception gets it.
   - Only the app's own files (the list below). Supabase, photos and fonts are left alone.
   - Bump V when the list changes. To switch it off, replace this file with one that only does
     self.registration.unregister(). */
var V = "turflijst-shell-1";
var SHELL = ["index.html", "app.js", "backend.js", "config.js", "vendor/supabase.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/apple-touch-icon.png"];
var BASE = new URL("./", self.location).pathname;

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(V).then(function (c) {
    return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: "reload" }); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("turflijst-shell-") === 0 && k !== V; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// The cache entry for a request, or null when it is not one of the app's own files.
function keyOf(req, url) {
  if (req.mode === "navigate") return "index.html";
  if (url.pathname.indexOf(BASE) !== 0) return null;
  var rel = url.pathname.slice(BASE.length);
  return SHELL.indexOf(rel) >= 0 ? rel : null;
}
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var key = keyOf(req, url);
  if (!key) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok && res.type === "basic" && !res.redirected) {
      var copy = res.clone();
      e.waitUntil(caches.open(V).then(function (c) { return c.put(key, copy); }).catch(function () {}));
    }
    return res;
  }, function (err) {
    return caches.open(V).then(function (c) { return c.match(key); }).then(function (hit) {
      if (!hit) throw err;
      // A navigation may not be answered with a response that was redirected.
      return hit.redirected ? hit.blob().then(function (b) { return new Response(b, { status: hit.status, statusText: hit.statusText, headers: hit.headers }); }) : hit;
    });
  }));
});
