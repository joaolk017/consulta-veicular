/* Cache apenas os recursos públicos. Páginas de conta e respostas de API nunca são armazenadas. */
const CACHE = "cv360-shell-v3";
const SHELL = ["/", "/manifest.webmanifest", "/pwa-icon.svg"];
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const isPrivate = /^\/(?:minhas-consultas|admin-funil)(?:\/|\.html|$)/i.test(url.pathname);
  if (isPrivate) {
    event.respondWith(fetch(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(response => {
        if (url.pathname === "/" && response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put("/", copy)).catch(() => {});
        }
        return response;
      }).catch(async () => {
        if (url.pathname === "/") return (await caches.match("/")) || Response.error();
        return Response.error();
      })
    );
    return;
  }
  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
      }
      return response;
    }))
  );
});
