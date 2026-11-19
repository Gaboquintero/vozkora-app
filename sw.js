const CACHE_NAME = 'vozkora-pwa-v1';
const ARCHIVOS_LOCALES = [
  './',
  './index.html',
  './api.js',
  './manifest.json'
];

// Instalar y guardar la interfaz en el teléfono
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_LOCALES))
  );
  self.skipWaiting();
});

// Activar y limpiar versiones viejas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Responder desde el teléfono si no hay internet
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('onrender.com')) return; // Las consultas al puente van directo a red
  event.respondWith(
    caches.match(event.request).then((respuestaCache) => respuestaCache || fetch(event.request))
  );
});