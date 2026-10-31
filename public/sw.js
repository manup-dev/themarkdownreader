// md-reader Service Worker — offline support for everything except AI.
//
// Path handling: this SW is served from the same directory as the app
// shell, so `self.registration.scope` is the deploy origin + base path
// (e.g. `https://manup-dev.github.io/themarkdownreader/`). All paths
// below are relative to that scope so the same SW works under root
// (`vite preview`) and under a Pages base path.
//
// Build step: the `md-reader-sw-precache` Vite plugin
// (scripts/build/sw-precache.ts) replaces the placeholder below with this
// build's manifest: a version hash, the shell + chunks to precache at install,
// and the remaining asset names (runtime-cached on first use). Unbuilt (the
// placeholder survives), the SW still works with runtime caching only.
const MANIFEST = /* __MDR_PRECACHE_MANIFEST__ */ { version: 'dev', precache: ['index.html', 'manifest.json', 'favicon.svg'], runtime: [] }

const PREFIX = 'md-reader-'
// Shell + precached chunks for exactly one build. A new deploy installs a new
// cache side by side and swaps on activate, so index.html and the chunks it
// references never mix across builds.
const SHELL_CACHE = `${PREFIX}shell-${MANIFEST.version}`
// Content-hashed assets fetched on demand (heavy AI runtimes, anything not
// precached). Shared across builds — unchanged hashes survive a redeploy —
// and pruned on activate to files the current build still references.
const ASSET_CACHE = `${PREFIX}assets`

const NAV_TIMEOUT_MS = 5000

// Resolve a scope-relative path to an absolute URL string. Robust under
// both `https://x/` and `https://x/themarkdownreader/` scopes.
const scoped = (rel) => new URL(rel, self.registration.scope).toString()
const scopePath = new URL(self.registration.scope).pathname
const stripScope = (urlPath) => urlPath.startsWith(scopePath) ? urlPath.slice(scopePath.length) : null
const SHELL_URL = scoped('./index.html')
const PRECACHE_SET = new Set(MANIFEST.precache.map((p) => scoped(p)))

// Install: precache best-effort, per file. A single miss must not abort the
// install (that would leave the old SW — or none — in charge). Hashed assets
// already sitting in an older cache are copied instead of re-downloaded.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    const queue = [...MANIFEST.precache]
    const worker = async () => {
      for (let rel = queue.shift(); rel !== undefined; rel = queue.shift()) {
        const url = scoped(rel)
        try {
          const hashed = rel.startsWith('assets/')
          if (hashed) {
            const existing = await caches.match(url)
            if (existing) { await cache.put(url, existing); continue }
          }
          // Hashed files may come from the HTTP cache (the page just loaded
          // most of them); the unhashed shell must bypass it to be fresh.
          const res = await fetch(new Request(url, { cache: hashed ? 'default' : 'reload' }))
          if (res.ok) await cache.put(url, res)
        } catch { /* best effort — runtime caching picks it up later */ }
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
  })())
  self.skipWaiting()
})

// Activate: drop other builds' shells, prune runtime assets this build
// doesn't reference, then take control of open pages.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys
      .filter((k) => k.startsWith(PREFIX) && k !== SHELL_CACHE && k !== ASSET_CACHE)
      .map((k) => caches.delete(k)))
    // Legacy pre-manifest cache names (md-reader-v1..v3).
    await Promise.all(keys.filter((k) => /^md-reader-v\d+$/.test(k)).map((k) => caches.delete(k)))
    if (MANIFEST.runtime.length) {
      const known = new Set(MANIFEST.runtime.map((p) => scoped(p)))
      const assets = await caches.open(ASSET_CACHE)
      for (const req of await assets.keys()) {
        if (!known.has(req.url)) await assets.delete(req)
      }
    }
    await self.clients.claim()
  })())
})

const isCacheable = (res) => res && res.status === 200 && (res.type === 'basic' || res.type === 'default')

// Network-first for navigations. Fresh copies of the shell refresh the cached
// index.html; offline (or a hung network) falls back to the cached shell for
// ANY path within scope — the app routes client-side via ?p= / #hash.
async function handleNavigation(request, rel) {
  const isShell = rel === '' || rel === 'index.html'
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS)),
    ])
    if (res.ok) {
      if (isShell && isCacheable(res) && !res.redirected) {
        const copy = res.clone()
        caches.open(SHELL_CACHE).then((c) => c.put(SHELL_URL, copy)).catch(() => {})
      }
      return res
    }
    // 404 on a deep link: GitHub Pages serves 404.html, which redirects to
    // ?p=… — let that through when online; other errors fall to the shell.
    if (res.status === 404) return res
    throw new Error(`HTTP ${res.status}`)
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true })
      || await caches.match(SHELL_URL)
    return cached || Response.error()
  }
}

// Cache-first for content-hashed assets (immutable). Anything fetched from the
// network is kept, so a heavy chunk used once online also works offline.
async function handleAsset(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const res = await fetch(request)
    if (isCacheable(res)) {
      const copy = res.clone()
      caches.open(ASSET_CACHE).then((c) => c.put(request, copy)).catch(() => {})
    }
    return res
  } catch {
    return Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // Skip cross-origin requests (Ollama/OpenRouter API, GitHub raw fetches
  // for shared docs, Hugging Face model downloads).
  if (url.origin !== self.location.origin) return
  const rel = stripScope(url.pathname)
  if (rel === null) return // outside our scope
  // Partial-content requests can't be cached (206) — let the browser handle.
  if (request.headers.has('range')) return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request, rel))
    return
  }

  if (rel.startsWith('assets/')) {
    event.respondWith(handleAsset(request))
    return
  }

  // Precached shell files (manifest, favicon, icons): cache-first.
  if (PRECACHE_SET.has(url.origin + url.pathname)) {
    event.respondWith(
      caches.match(url.origin + url.pathname).then((cached) => cached || fetch(request)).catch(() => Response.error())
    )
    return
  }
  // Anything else same-origin (e.g. the CLI's /__cli__/content, /api/file):
  // plain network — no respondWith, so behaviour is exactly as without a SW.
})
