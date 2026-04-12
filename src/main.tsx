import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Release GPU models before navigation/reload so VRAM doesn't leak across sessions.
// `pagehide` is more reliable than `beforeunload` on mobile (bfcache-safe).
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

// Register service worker for offline support (prod only)
// In dev, unregister any stale SW to prevent cache interference
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW registration failed — no offline support, that's ok
      })
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((regs) =>
      regs.forEach((r) => r.unregister())
    )
  }
}
