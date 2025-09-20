const CACHE_NAME = 'budget-calculator-v3.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Установка Service Worker
self.addEventListener('install', (event) => {
  console.log('SW installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('SW installed successfully');
        self.skipWaiting();
      })
  );
});

// Активация Service Worker
self.addEventListener('activate', (event) => {
  console.log('SW activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('SW activated');
      return self.clients.claim();
    })
  );
});

// Простая обработка запросов
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Игнорируем все Firebase, Google APIs, и внешние API
  if (url.hostname.includes('firebaseapp.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('gstatic.com') ||
      url.hostname.includes('exchangerate-api.com') ||
      url.hostname.includes('cdnjs.cloudflare.com') ||
      event.request.method !== 'GET') {
    return; // Пропускаем эти запросы
  }
  
  // Обрабатываем только локальные ресурсы
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          if (response) {
            return response;
          }
          
          return fetch(event.request)
            .then((response) => {
              if (!response || response.status !== 200) {
                return response;
              }
              
              const responseToCache = response.clone();
              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(event.request, responseToCache);
                });
              
              return response;
            });
        })
        .catch(() => {
          // Fallback для навигации
          if (event.request.mode === 'navigate') {
            return caches.match('/') || caches.match('/index.html');
          }
        })
    );
  }
});

console.log('Service Worker loaded');