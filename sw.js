const CACHE_NAME = 'vozkora-pwa-v17';
const ARCHIVOS_LOCALES = [
  './',
  './index.html',
  './api.js',
  './manifest.json',
  './logo.png',
  './mascota.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_LOCALES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const reqUrl = event.request.url;
  if (
    reqUrl.includes('onrender.com') ||
    reqUrl.includes('supabase.co') ||
    reqUrl.includes('gstatic.com/generate_204') ||
    reqUrl.includes('?ping=') ||
    reqUrl.includes('_nocache=')
  ) {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const copia = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
