/* Only the public app shell and immutable static assets are cached.
   Authenticated API responses, uploads, and admin data always use the network. */
const SHELL_CACHE = "bgc-shell-v1";
const STATIC_CACHE = "bgc-static-v1";
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const page = await fetch("/index.html", { cache: "reload" });
    if (!page.ok) throw new Error("App shell unavailable");
    const html = await page.clone().text();
    const shell = await caches.open(SHELL_CACHE);
    await shell.put("/index.html", page);
    // Expo emits a fingerprinted entry bundle. Cache that exact bundle for an
    // offline dashboard launch; every authenticated data request still uses API.
    const entries = [...html.matchAll(/src="(\/_expo\/static\/js\/web\/entry-[^"]+\.js)"/g)].map(match => match[1]);
    if (entries.length) await (await caches.open(STATIC_CACHE)).addAll(entries);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("bgc-") && key !== SHELL_CACHE && key !== STATIC_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("authorization")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname === "/api" || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cached = await caches.match("/index.html");
      return cached || Response.error();
    }));
    return;
  }

  const staticAsset = url.pathname.startsWith("/_expo/") || url.pathname.startsWith("/assets/");
  if (!staticAsset) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.put(request, copy)));
    }
    return response;
  })));
});
