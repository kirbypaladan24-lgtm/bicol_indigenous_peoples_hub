// sw.js - Service Worker for Bicol IP Hub
// Provides offline caching for assets, posts, and map tiles

const CACHE_VERSION = 'v12';
const STATIC_CACHE = `bicol-ip-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `bicol-ip-dynamic-${CACHE_VERSION}`;
const IMAGE_CACHE = `bicol-ip-images-${CACHE_VERSION}`;
const MAP_TILE_CACHE = `bicol-ip-map-${CACHE_VERSION}`;
const SW_DEBUG =
  self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

function debugLog(...args) {
  if (SW_DEBUG) {
    console.log(...args);
  }
}

function isCacheableResponse(response) {
  return Boolean(response) && (response.ok || response.type === 'opaque');
}

// Assets to cache on install
const STATIC_ASSETS = [
  './',
  './index.html',
  './posts.html',
  './signup.html',
  './profile.html',
  './admin.html',
  './charts.html',
  './metric-history.html',
  './superadmin.html',
  './tracker.html',
  './landmark.html',
  './policy.html',
  './styles.css',
  './styles-additions.css',
  './app.js',
  './auth.js',
  './firebase-config.js',
  './ui.js',
  './utils.js',
  './security.js',
  './analytics.js',
  './map-enhancements.js',
  './i18n.js',
  './imgbb.js',
  './admin.js',
  './adminPage.js',
  './charts.js',
  './metric-history.js',
  './profile.js',
  './role-nav.js',
  './superadmin.js',
  './tracker.js',
  './landmark.js',
  './signup.js',
  './pwa.js',
];

// Install: Cache static assets
self.addEventListener('install', (event) => {
  debugLog('[SW] Installing...');
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(STATIC_ASSETS);
    await self.skipWaiting();
  })());
});

// Activate: Clean old caches
self.addEventListener('activate', (event) => {
  debugLog('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('bicol-ip-') && !name.includes(CACHE_VERSION))
          .map((name) => {
            debugLog('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Helper: Determine cache strategy
function getCacheStrategy(url) {
  const urlObj = new URL(url);
  
  // Map tiles from OpenStreetMap or other tile servers
  if (url.includes('tile.openstreetmap.org') || 
      url.includes('tile.opentopomap.org') || 
      url.includes('arcgisonline.com')) {
    return 'map-tile';
  }

  // Let the browser handle direct ImgBB-hosted images. This avoids first-load
  // failures on weak connections for freshly uploaded post media.
  if (url.includes('i.ibb.co')) {
    return 'network-only';
  }
  
  // Images from ImgBB or other CDNs
  if (url.includes('img.youtube.com') ||
      url.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
    return 'image';
  }
  
  // Firebase API calls
  if (url.includes('googleapis.com') || url.includes('firebaseio.com')) {
    return 'network-only';
  }

  // Never cache local API endpoints or runtime config.
  if (urlObj.origin === location.origin && urlObj.pathname.startsWith('/api/')) {
    return 'network-only';
  }
  
  // Always prefer fresh HTML and JS so deployments aren't stuck on stale code.
  if (url.match(/\.(js|html)$/i) || urlObj.pathname === '/') {
    return 'network-first';
  }

  // CSS can still be cached aggressively.
  if (url.match(/\.(css)$/i)) {
    return 'static';
  }
  
  // API/data requests
  if (url.includes('ipapi.co')) {
    return 'network-first';
  }
  
  return 'dynamic';
}

// Fetch: Apply caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;
  const strategy = getCacheStrategy(url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  switch (strategy) {
    case 'static':
      // Cache-first for static assets
      event.respondWith(
        caches.match(request).then((cached) => {
          if (cached) {
            // Return cached but fetch update in background
            fetch(request)
              .then((response) => {
                if (isCacheableResponse(response)) {
                  caches.open(STATIC_CACHE).then((cache) => cache.put(request, response));
                }
              })
              .catch(() => {});
            return cached;
          }
          return fetch(request).then((response) => {
            if (!isCacheableResponse(response)) return response;
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
            return response;
          });
        })
      );
      break;
      
    case 'image':
      // Cache-first with background refresh so post images appear quickly.
      event.respondWith(
        caches.open(IMAGE_CACHE).then(async (cache) => {
          const cached = await cache.match(request);

          if (cached) {
            event.waitUntil(
              fetch(request)
                .then((networkResponse) => {
                  if (isCacheableResponse(networkResponse)) {
                    return cache.put(request, networkResponse.clone());
                  }
                  return null;
                })
                .catch(() => null)
            );
            return cached;
          }

          try {
            const networkResponse = await fetch(request);
            if (isCacheableResponse(networkResponse)) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          } catch (error) {
            return cached || Response.error();
          }
        })
      );
      break;
      
    case 'map-tile':
      // Cache map tiles without blocking map rendering on install or fetch.
      event.respondWith(
        caches.open(MAP_TILE_CACHE).then(async (cache) => {
          const cached = await cache.match(request);
          const fetchPromise = fetch(request)
            .then((response) => {
              if (isCacheableResponse(response)) {
                cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => cached);

          return cached || fetchPromise;
        })
      );
      break;
      
    case 'network-first':
      // Network-first with cache fallback
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (isCacheableResponse(response)) {
              const clone = response.clone();
              caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => caches.match(request))
      );
      break;
      
    case 'network-only':
      // Don't cache Firebase API calls
      return;
      
    default:
      // Dynamic content: Network with cache fallback
      event.respondWith(
        fetch(request).then((response) => {
          if (!isCacheableResponse(response)) return response;
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, clone));
          return response;
        }).catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            // Return offline fallback for HTML pages
            if (request.headers.get('accept')?.includes('text/html')) {
              return caches.match('./index.html');
            }
            throw new Error('Network error and no cache');
          });
        })
      );
  }
});

// Background sync for offline form submissions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-posts') {
    event.waitUntil(syncPendingPosts());
  }
});

// Push notifications (for future use)
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Bicol IP Hub', {
      body: data.body || 'New content available',
      icon: '/icon-192x192.png',
      badge: '/badge-72x72.png',
      data: data.url || '/'
    })
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data)
  );
});

// Helper: Sync pending posts (placeholder for future implementation)
async function syncPendingPosts() {
  // This would sync posts created while offline
  debugLog('[SW] Syncing pending posts...');
}

// Message handler from main thread
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
