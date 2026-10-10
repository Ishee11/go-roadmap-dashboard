/* Generated from allowlisted public files. Never caches private GitHub documents. */
const CACHE_NAME = "go-middle-public-020889065442f187";
const CACHE_PREFIX = 'go-middle-public-';
const PRECACHE = ["./apple-touch-icon.png","./assets/index-BMSSq81K.css","./assets/index-CqpZ3Szu.js","./assets/pwa-register-ByC4ydEP.js","./assets/pwa-register-DoYOE3Kg.css","./assets/slices-2ZGmvIEl.css","./assets/slices-CpIVg7C7.js","./data/public-febc85c9cb9ddf42.json","./icon-192.png","./icon-512.png","./index.html","./manifest.webmanifest","./slices.html"];
const ROOT = self.registration.scope;
const ALLOWED = new Set(PRECACHE.map(file => new URL(file, ROOT).pathname));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE.map(file => new URL(file, ROOT)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names=await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request=event.request;
  if(request.method !== 'GET') return;
  const url=new URL(request.url);
  if(url.origin !== self.location.origin || !url.pathname.startsWith(new URL(ROOT).pathname)) return;
  if(request.mode === 'navigate'){
    const fallback = url.pathname.endsWith('/slices.html') ? './slices.html' : './index.html';
    event.respondWith(fetch(request).catch(async () => await caches.match(new URL(fallback, ROOT)) || Response.error()));
    return;
  }
  if(!ALLOWED.has(url.pathname)) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
});
