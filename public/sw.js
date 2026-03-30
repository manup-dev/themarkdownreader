// md-reader Service Worker — offline support for core reading features
const CACHE_NAME = 'md-reader-v2'
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
]

// Install: cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  )
  self.skipWaiting()
})

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch: network-first for navigation, passthrough for hashed assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Skip cross-origin requests (Ollama/OpenRouter API)
  if (url.hostname !== self.location.hostname) return

  // Don't intercept Vite hashed assets — browser cache handles them fine
  // and caching them here causes stale-hash fetch failures on rebuilds
  if (url.pathname.startsWith('/assets/')) return

  // Network-first for HTML (SPA) — fall back to cached shell when offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    )
    return
  }

  // Cache-first for core assets (favicon, manifest, etc.)
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  )
})
