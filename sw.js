// Prima la rete (orari sempre aggiornati), la copia salvata se manca la connessione.
const CACHE = "quando-passa-v6";
const FILES = ["./", "./index.html", "./app.js", "./logic.js", "./manifest.json", "./orari.json", "./icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  // "no-cache": chiede sempre al server se il file è cambiato, così gli aggiornamenti arrivano subito
  e.respondWith(fetch(e.request.url, { cache: "no-cache" }).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match("./"))));
});
