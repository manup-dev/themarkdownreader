import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import 'katex/dist/katex.min.css' // hides the MathML fallback; without it every $…$/$$…$$ renders doubled
import App from './App.tsx'
import { isIFrameMode, getIFrameBridge } from './lib/iframe-bridge'
import { useStore } from './store/useStore'
import { ErrorBoundary } from './components/ErrorBoundary'
import { bumpVisitCount } from './lib/first-run'

// Count this visit before first render so first-run overlays (telemetry
// banner) gate correctly on the current visit. Standalone only — embedded
// (iframe/Jupyter) hosts don't show these overlays.
if (!isIFrameMode()) bumpVisitCount()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary name="App" autoRetry>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// ── Iframe-mode integration ───────────────────────────────────────────────
// When embedded under JupyterLab (or any other host that speaks our v1.0.0
// wire protocol), wire up the bridge so the host can push markdown, theme,
// and settings. Keep this terse — the bridge module owns the protocol.
const MDR_DEBUG =
  typeof globalThis !== 'undefined' &&
  (globalThis as Record<string, unknown>).MDR_DEBUG === true
if (isIFrameMode()) {
  // Expose for runtime debugging from the host's devtools.
  ;(globalThis as Record<string, unknown>).__mdr_iframe_debug = { useStore }
  // When embedded in a host (JupyterLab today), default the AI backend to
  // WebLLM on first run. Rationale: hosts like JL pip-install us as a
  // single command and users don't expect a second "install Ollama" step.
  // WebLLM runs entirely in the browser (no install) so it works the
  // moment the iframe loads, assuming WebGPU. User can override via the
  // host's settings UI; we only seed when nothing is set yet.
  // Namespace this LS key with `-iframe` so the seed never bleeds into the
  // standalone site at the same eTLD+1 (e.g., when a user self-hosts both).
  // `src/lib/ai.ts` reads the iframe variant first when running inside a host.
  try {
    const LS_KEY = 'md-reader-preferred-backend-iframe'
    if (typeof localStorage !== 'undefined' && !localStorage.getItem(LS_KEY)) {
      localStorage.setItem(LS_KEY, 'webllm')
    }
  } catch {
    // ignore — private mode / disabled storage
  }
  const bridge = getIFrameBridge()
  bridge.on<{ markdown: string; path: string }>('SET_MARKDOWN', payload => {
    try {
      if (MDR_DEBUG) {
        console.log('[md-reader/iframe] SET_MARKDOWN', payload.path, payload.markdown.length)
      }
      useStore.getState().setMarkdown(payload.markdown, payload.path)
    } catch (err) {
      if (MDR_DEBUG) console.warn('[md-reader/iframe] setMarkdown failed', err)
    }
  })
  bridge.on<{
    dark: boolean
    fontFamily: string
    fontSize: number
    jpVars: Record<string, string>
    highContrast: boolean
  }>('SET_THEME', payload => {
    try {
      const root = document.documentElement
      for (const [k, v] of Object.entries(payload.jpVars || {})) {
        root.style.setProperty(k, v)
      }
      useStore.getState().setTheme(payload.dark ? 'dark' : 'light')
    } catch (err) {
      if (MDR_DEBUG) console.warn('[md-reader/iframe] setTheme failed', err)
    }
  })
  bridge.on('SET_SETTINGS', _payload => {
    // v0.2: ignore for now — the iframe app already persists its own
    // preferences to localStorage. v0.2.1 will wire AI backend selection.
  })
  // v0.2 plumbing: persist the host's locale on globalThis so a future
  // i18n layer can read it. md-reader's own i18n is out of scope for v0.2.
  bridge.on<{ languageCode: string }>('SET_LOCALE', payload => {
    try {
      ;(globalThis as Record<string, unknown>).__mdr_host_locale =
        payload.languageCode
    } catch {
      // ignore
    }
  })
  bridge.on<{ anchor: string }>('SCROLL_TO', payload => {
    try {
      const target = document.getElementById(payload.anchor)
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch {
      // ignore
    }
  })
  bridge.start()
}

// Release GPU models before navigation/reload so VRAM doesn't leak across sessions.
// `pagehide` is more reliable than `beforeunload` on mobile (bfcache-safe).
//
// FIXME(v0.3): iframe pagehide async unloads can race past the host's dispose
// (which sets iframe.src = 'about:blank'). For now we accept that a tab-close
// during active WebLLM/Gemma/Kokoro inference may leak one WebGPU buffer per
// inflight model — the iframe document is gone before the WebGPU drop
// callback completes. Native v0.3 reading surface removes the iframe and
// the race with it.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    // Dynamic import at event time — inference code is heavy and may not yet be loaded
    void (async () => {
      try {
        const [gemma, kokoro, ai] = await Promise.all([
          import('./lib/inference/gemma-engine'),
          import('./lib/kokoro-tts'),
          import('./lib/ai'),
        ])
        await Promise.allSettled([gemma.unloadGemma(), kokoro.unloadKokoro(), ai.unloadWebLLM()])
      } catch { /* best-effort, page is unloading anyway */ }
    })()
  }, { once: true })
}

// Register service worker for offline support (prod only).
// Skip when embedded in JupyterLab iframe — SW serving stale cached chunks
// breaks the iframe across labextension rebuilds, and JL itself does its
// own asset caching at the labextension layer.
// In dev, unregister any stale SW to prevent cache interference.
const isJupyterHost = (globalThis as { MDR_HOST?: string }).MDR_HOST === 'jupyterlab'
if ('serviceWorker' in navigator && isJupyterHost) {
  // Defensive: a prior build may have planted a SW at this scope; remove it.
  navigator.serviceWorker.getRegistrations().then((regs) =>
    regs.forEach((r) => r.unregister())
  )
}
if ('serviceWorker' in navigator && !isJupyterHost) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      // Use BASE_URL so the SW path is correct under any deploy origin —
      // hard-coding `/sw.js` 404s under GitHub Pages where the app lives
      // at `/<repo>/`. Vite inlines BASE_URL at build time.
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
        // SW registration failed — no offline support, that's ok
      })
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((regs) =>
      regs.forEach((r) => r.unregister())
    )
  }
}
