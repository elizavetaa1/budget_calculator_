const CACHE_NAME = 'budget-calculator-v2.3';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

// Установка Service Worker
self.addEventListener('install', (event) => {
  console.log('SW installing with scope:', self.registration.scope);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache.map(url => new Request(url, {cache: 'reload'})));
      })
      .then(() => {
        console.log('All resources cached successfully');
        // Принудительная активация нового SW
        self.skipWaiting();
      })
      .catch((error) => {
        console.error('Cache addAll failed:', error);
      })
  );
});

// Активация Service Worker
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('Old caches cleaned up');
      // Немедленно берем контроль над всеми клиентами
      return self.clients.claim();
    }).then(() => {
      console.log('Service Worker activated successfully');
      // Уведомляем клиентов об успешной активации
      return self.clients.matchAll().then((clients) => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_ACTIVATED',
            timestamp: Date.now()
          });
        });
      });
    })
  );
});

// Обработка запросов
self.addEventListener('fetch', (event) => {
  // Игнорируем запросы к внешним API (кроме CDN), POST запросы и non-GET запросы
  if ((!event.request.url.startsWith(self.location.origin) && 
       !event.request.url.includes('cdnjs.cloudflare.com')) || 
      event.request.method !== 'GET' ||
      event.request.url.includes('firebaseapp.com') ||
      event.request.url.includes('googleapis.com') ||
      event.request.url.includes('exchangerate-api.com')) {
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
        if (event.request.destination === 'document' || 
            event.request.mode === 'navigate') {
          return caches.match('/index.html') || caches.match('/');
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

      // Клонируем ответ для кеша (только для GET запросов)
      if (request.method === 'GET') {
        const responseToCache = response.clone();
        
        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(request, responseToCache);
          })
          .catch((error) => {
            console.warn('Failed to cache response:', error);
          });
      }

      return response;
    })
    .catch((error) => {
      console.warn('Fetch failed:', error);
      throw error;
    });
}

// Фоновое обновление кеша
function fetchAndUpdateCache(request) {
  fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        const responseToCache = response.clone();
        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(request, responseToCache);
          })
          .catch((error) => {
            console.warn('Failed to update cache:', error);
          });
      }
    })
    .catch((error) => {
      console.warn('Background fetch failed:', error);
      // Игнорируем ошибки фонового обновления
    });
}

// Обработка фоновой синхронизации
self.addEventListener('sync', (event) => {
  console.log('Background sync triggered:', event.tag);
  
  if (event.tag === 'budget-sync') {
    event.waitUntil(
      syncBudgetData().catch((error) => {
        console.error('Background sync failed:', error);
        // Не выбрасываем ошибку, чтобы не блокировать другие операции
      })
    );
  }
});

// Улучшенная функция синхронизации данных
async function syncBudgetData() {
  try {
    console.log('Starting background sync...');
    
    // Получаем всех активных клиентов
    const clients = await self.clients.matchAll({
      includeUncontrolled: true,
      type: 'window'
    });
    
    if (clients.length === 0) {
      console.log('No active clients for sync');
      return;
    }
    
    // Отправляем сообщение всем клиентам о необходимости синхронизации
    const syncPromises = clients.map(client => {
      return new Promise((resolve) => {
        client.postMessage({
          type: 'SYNC_REQUEST',
          timestamp: Date.now(),
          action: 'background-sync'
        });
        
        // Даем клиенту время на обработку
        setTimeout(resolve, 1000);
      });
    });
    
    await Promise.all(syncPromises);
    
    // Уведомляем о завершении синхронизации
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_COMPLETED',
        timestamp: Date.now()
      });
    });
    
    console.log('Background sync completed successfully');
  } catch (error) {
    console.error('Background sync error:', error);
    
    // Уведомляем клиентов об ошибке
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_ERROR',
        error: error.message,
        timestamp: Date.now()
      });
    });
    
    throw error;
  }
}

// Обработка push уведомлений
self.addEventListener('push', (event) => {
  console.log('Push message received');
  
  let notificationData = {
    title: 'Калькулятор Бюджета',
    body: 'Не забудьте обновить свой бюджет!',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png'
  };
  
  // Парсим данные из push сообщения, если есть
  if (event.data) {
    try {
      const pushData = event.data.json();
      notificationData = { ...notificationData, ...pushData };
    } catch (e) {
      notificationData.body = event.data.text() || notificationData.body;
    }
  }
  
  const options = {
    body: notificationData.body,
    icon: notificationData.icon,
    badge: notificationData.badge,
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 'budget-reminder',
      url: '/'
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
    silent: false,
    tag: 'budget-notification' // Группировка уведомлений
  };

  event.waitUntil(
    self.registration.showNotification(notificationData.title, options)
      .then(() => {
        console.log('Notification shown successfully');
      })
      .catch((error) => {
        console.error('Failed to show notification:', error);
      })
  );
});

// Обработка кликов по уведомлениям
self.addEventListener('notificationclick', (event) => {
  console.log('Notification click received, action:', event.action);
  
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      }).then((clients) => {
        // Ищем уже открытое окно приложения
        const existingClient = clients.find(client => 
          client.url.includes(self.registration.scope)
        );
        
        if (existingClient) {
          // Фокусируем существующее окно
          return existingClient.focus().then(() => {
            // Уведомляем клиента о клике по уведомлению
            existingClient.postMessage({
              type: 'NOTIFICATION_CLICK',
              action: event.action || 'open',
              timestamp: Date.now()
            });
          });
        } else {
          // Открываем новое окно
          return self.clients.openWindow(urlToOpen);
        }
      }).catch((error) => {
        console.error('Failed to handle notification click:', error);
      })
    );
  }
  // Для действия 'close' просто закрываем уведомление (уже сделано выше)
});

// Расширенная обработка сообщений от клиентов
self.addEventListener('message', (event) => {
  console.log('Service Worker received message:', event.data);
  
  const messageHandlers = {
    'SKIP_WAITING': () => {
      self.skipWaiting();
    },
    
    'GET_CACHE_NAMES': () => {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({
          cacheNames: [CACHE_NAME]
        });
      }
    },
    
    'CLEAR_CACHE': () => {
      event.waitUntil(
        caches.delete(CACHE_NAME).then((success) => {
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ success });
          }
          console.log('Cache cleared:', success);
        }).catch((error) => {
          console.error('Failed to clear cache:', error);
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ success: false, error: error.message });
          }
        })
      );
    },
    
    'UPDATE_CACHE': () => {
      event.waitUntil(
        updateCache().then(() => {
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ success: true });
          }
        }).catch((error) => {
          console.error('Failed to update cache:', error);
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ success: false, error: error.message });
          }
        })
      );
    },
    
    'SYNC_DATA': () => {
      // Принудительная синхронизация данных
      event.waitUntil(
        syncBudgetData().then(() => {
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ success: true });
          }
        }).catch((error) => {
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ success: false, error: error.message });
          }
        })
      );
    }
  };
  
  if (event.data && event.data.type && messageHandlers[event.data.type]) {
    messageHandlers[event.data.type]();
  }
});

// Функция обновления кеша
async function updateCache() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = urlsToCache.map(url => new Request(url, {cache: 'reload'}));
    await cache.addAll(requests);
    console.log('Cache updated successfully');
  } catch (error) {
    console.error('Failed to update cache:', error);
    throw error;
  }
}

// Обработка ошибок
self.addEventListener('error', (event) => {
  console.error('Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker unhandled rejection:', event.reason);
  event.preventDefault(); // Предотвращаем вывод ошибки в консоль
});

// Уведомление об установке Service Worker
console.log('Service Worker script loaded');

// Проверка возможностей браузера
if ('clients' in self) {
  console.log('Clients API supported');
}

if ('sync' in self.registration) {
  console.log('Background Sync supported');
}

if ('showNotification' in self.registration) {
  console.log('Push Notifications supported');
}