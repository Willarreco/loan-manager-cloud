const CACHE_NAME = 'waemprestimo-cache-v1';
const urlsToCache = [
  'index.html',
  'login.html',
  'style.css',
  'script.js',
  'config.js',
  'auth.js',
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
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});
