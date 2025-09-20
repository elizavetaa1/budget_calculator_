const CACHE_NAME = 'budget-calculator-v2.1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js'
];

// Установка Service Worker
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache.map(url => new Request(url, {cache: 'reload'})));
      })
      .catch((error) => {
        console.error('Cache addAll failed:', error);
      })
  );
  // Принудительная активация нового SW
  self.skipWaiting();
});

// Активация Service Worker
// В начале sw.js добавьте правильную область
self.addEventListener('install', (event) => {
  console.log('SW installing with scope:', self.registration.scope);
  event.waitUntil(
    caches.open('budget-calculator-v1')
      .then((cache) => {
        return cache.addAll([
          './',
          './index.html',
          './manifest.json'
        ]);
      })
  );
});
      // Немедленно берем контроль над всеми клиентами
      return self.clients.claim();

// Обработка запросов
self.addEventListener('fetch', (event) => {
  // Игнорируем запросы к внешним API и не-GET запросы
  if (!event.request.url.startsWith(self.location.origin) || event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Возвращаем из кеша, если есть
        if (response) {
          // Для HTML страниц проверяем обновления в фоне
          if (event.request.destination === 'document') {
            fetchAndUpdateCache(event.request);
          }
          return response;
        }

        // Нет в кеше - загружаем из сети
        return fetchAndCache(event.request);
      })
      .catch(() => {
        // Офлайн fallback для навигационных запросов
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      })
  );
});

// Функция для загрузки и кеширования
function fetchAndCache(request) {
  return fetch(request)
    .then((response) => {
      // Проверяем валидность ответа
      if (!response || response.status !== 200 || response.type !== 'basic') {
        return response;
      }

      // Клонируем ответ для кеша
      const responseToCache = response.clone();

      caches.open(CACHE_NAME)
        .then((cache) => {
          cache.put(request, responseToCache);
        });

      return response;
    });
}

// Фоновое обновление кеша
function fetchAndUpdateCache(request) {
  fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(request, response);
          });
      }
    })
    .catch(() => {
      // Игнорируем ошибки фонового обновления
    });
}

// Обработка фоновой синхронизации
self.addEventListener('sync', (event) => {
  console.log('Background sync:', event.tag);
  
  if (event.tag === 'budget-sync') {
    event.waitUntil(
      syncBudgetData()
    );
  }
});

// Функция синхронизации данных
async function syncBudgetData() {
  try {
    // Получаем данные из IndexedDB или localStorage
    const clients = await self.clients.matchAll();
    
    // Отправляем сообщение клиентам о необходимости синхронизации
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_REQUEST',
        timestamp: Date.now()
      });
    });
    
    console.log('Background sync completed');
  } catch (error) {
    console.error('Background sync failed:', error);
    throw error;
  }
}

// Обработка push уведомлений (опционально)
self.addEventListener('push', (event) => {
  console.log('Push message received');
  
  const options = {
    body: event.data ? event.data.text() : 'Не забудьте обновить свой бюджет!',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 'budget-reminder'
    },
    actions: [
      {
        action: 'open',
        title: 'Открыть приложение',
        icon: '/icons/icon-96x96.png'
      },
      {
        action: 'close',
        title: 'Закрыть',
        icon: '/icons/icon-96x96.png'
      }
    ],
    requireInteraction: false,
    silent: false
  };

  event.waitUntil(
    self.registration.showNotification('Калькулятор Бюджета', options)
  );
});

// Обработка кликов по уведомлениям
self.addEventListener('notificationclick', (event) => {
  console.log('Notification click received');
  
  event.notification.close();

  if (event.action === 'open') {
    event.waitUntil(
      clients.openWindow('/')
    );
  } else if (event.action === 'close') {
    // Просто закрываем уведомление
    return;
  } else {
    // Клик по самому уведомлению
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Обработка сообщений от клиентов
self.addEventListener('message', (event) => {
  console.log('Service Worker received message:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_CACHE_NAMES') {
    event.ports[0].postMessage({
      cacheNames: [CACHE_NAME]
    });
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.delete(CACHE_NAME).then(() => {
        event.ports[0].postMessage({
          success: true
        });
      })
    );
  }
});