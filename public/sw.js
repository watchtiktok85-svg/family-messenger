const CACHE_NAME = 'shariq-v1';

// Файлы для кэширования (только GET запросы)
const urlsToCache = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/auth.js',
  '/js/chats.js',
  '/js/messages.js',
  '/js/file.js',
  '/js/settings.js',
  '/manifest.json'
];

// Установка Service Worker
self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache opened');
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.error('Cache addAll error:', err);
      })
  );
  self.skipWaiting();
});

// Активация Service Worker
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Перехват запросов
self.addEventListener('fetch', event => {
  // Кэшируем только GET запросы
  if (event.request.method !== 'GET') {
    return;
  }
  
  // Не кэшируем API запросы
  if (event.request.url.includes('/api/')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Возвращаем из кэша, если есть
        if (response) {
          return response;
        }
        
        // Иначе запрашиваем с сети
        return fetch(event.request).then(response => {
          // Проверяем, что ответ валидный
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          
          // Кэшируем только GET запросы
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            })
            .catch(err => {
              console.error('Cache put error:', err);
            });
          return response;
        });
      })
      .catch(err => {
        console.error('Fetch error:', err);
        // Возвращаем офлайн страницу если нужно
        return new Response('Network error', { status: 404 });
      })
  );
});
