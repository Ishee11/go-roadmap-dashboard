/* Generated from allowlisted public files. Never caches private GitHub documents. */
const CACHE_NAME = "go-middle-public-6fccfd97e9a6de0c";
const CACHE_PREFIX = 'go-middle-public-';
const PRECACHE = ["./apple-touch-icon.png","./assets/index--ahbBx0Z.css","./assets/index-D1qv5b3r.js","./data/public-fa037c6cd3e06318.json","./icon-192.png","./icon-512.png","./index.html","./manifest.webmanifest"];
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
    event.respondWith(fetch(request).catch(async () => await caches.match(new URL('./index.html', ROOT)) || Response.error()));
    return;
  }
  if(!ALLOWED.has(url.pathname)) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
});
