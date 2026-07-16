const CACHE_NAME = 'waemprestimo-cache-v3';
const urlsToCache = [
  'index.html',
  'login.html',
  'style.css',
  'script.js',
  'config.js',
  'auth.js',
  'wa-manager.js',
  'logo.png',
  'background.png',
  'background_vault_v2.png',
  'icon-192.png',
  'icon-512.png',
  'manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    })
  );
});

self.addEventListener('fetch', event => {
  // Ignorar requisições para a API proxy
  if (event.request.url.includes('/api/')) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});