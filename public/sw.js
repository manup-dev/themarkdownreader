// md-reader Service Worker — offline support for core reading features.
//
// Path handling: this SW is served from the same directory as the app
// shell, so `self.registration.scope` is the deploy origin + base path
// (e.g. `https://manup-dev.github.io/themarkdownreader/`). All paths
// below are relative to that scope so the same SW works under root
// (`vite preview`) and under a Pages base path without a build step.
const CACHE_NAME = 'md-reader-v3'

// Resolve a scope-relative path to an absolute URL string. Robust under
// both `https://x/` and `https://x/themarkdownreader/` scopes.
const scoped = (rel) => new URL(rel, self.registration.scope).toString()

const CORE_ASSETS = [
  scoped('./'),
  scoped('./index.html'),
  scoped('./manifest.json'),
  scoped('./favicon.svg'),
]

// Install: cache core assets. addAll() rejects atomically — if any URL
// 404s the whole install fails, leaving no SW registered. We tolerate
// individual misses by falling back to per-asset adds with try/catch so
// a single bad path doesn't break the offline read path.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(CORE_ASSETS.map(async (url) => {
        try { await cache.add(url) } catch { /* skip — best effort */ }
      }))
    })
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

// Path matching against the SW scope — strip the scope prefix so we can
// compare against scope-relative names like `assets/foo.js`.
const scopePath = new URL(self.registration.scope).pathname
const stripScope = (urlPath) => urlPath.startsWith(scopePath) ? urlPath.slice(scopePath.length) : urlPath

// Fetch: network-first for navigation, passthrough for hashed assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Skip cross-origin requests (Ollama/OpenRouter API, GitHub raw fetches
  // for shared docs)
  if (url.hostname !== self.location.hostname) return

  // Don't intercept Vite hashed assets — browser cache handles them fine
  // and caching them here causes stale-hash fetch failures on rebuilds
  const rel = stripScope(url.pathname)
  if (rel.startsWith('assets/')) return

  // Network-first for HTML (SPA) — fall back to cached shell when offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(scoped('./index.html')))
    )
    return
  }

  // Cache-first for core assets (favicon, manifest, etc.)
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  )
})
