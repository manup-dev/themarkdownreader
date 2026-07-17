import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { lazy, Suspense } from 'react'
import { useStore, persistSettled } from '../store/useStore'
import { isTrustedEmbedOrigin } from '../lib/trusted-origins'
import { ErrorBoundary } from '../components/ErrorBoundary'
import App from '../App'

describe('isTrustedEmbedOrigin (B7)', () => {
  it('accepts same-origin, github.com, and the mdonline dev origins', () => {
    expect(isTrustedEmbedOrigin(window.location.origin)).toBe(true)
    expect(isTrustedEmbedOrigin('https://github.com')).toBe(true)
    expect(isTrustedEmbedOrigin('http://localhost:5180')).toBe(true)
    expect(isTrustedEmbedOrigin('http://localhost:5173')).toBe(true)
  })

  it('rejects arbitrary and null origins', () => {
    expect(isTrustedEmbedOrigin('https://evil.example')).toBe(false)
    expect(isTrustedEmbedOrigin('null')).toBe(false)
    expect(isTrustedEmbedOrigin('')).toBe(false)
  })
})

describe('App md-reader-load postMessage origin gate (B7)', () => {
  beforeEach(() => {
    window.location.hash = ''
    useStore.getState().reset()
  })
  afterEach(async () => {
    cleanup()
    // Rendering <App /> here and feeding it a trusted postMessage routes
    // through setMarkdown → openSmart → a fire-and-forget persistPayload()
    // IndexedDB write. Drain it before the test ends so it can't still be in
    // flight when vitest tears down the environment (surfaces as
    // "EnvironmentTeardownError: Closing rpc while onUserConsoleLog was
    // pending" from persistPayload's DEV-only console.warn on failure).
    await persistSettled()
  })

  it('ignores md-reader-load from an untrusted origin', async () => {
    render(<App />)
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://evil.example',
      data: { type: 'md-reader-load', markdown: '# injected', fileName: 'evil.md' },
    }))
    await new Promise((r) => setTimeout(r, 0))
    expect(useStore.getState().markdown).toBe('')
    expect(useStore.getState().tabs.every((t) => t.kind === 'empty')).toBe(true)
  })

  it('accepts md-reader-load from the app origin (extension/E2E flow)', async () => {
    render(<App />)
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'md-reader-load', markdown: '# hello from extension', fileName: 'ext.md' },
    }))
    await vi.waitFor(() => expect(useStore.getState().markdown).toBe('# hello from extension'))
    expect(useStore.getState().fileName).toBe('ext.md')
  })
})

describe('lazy chunk failure containment (B8 pattern)', () => {
  afterEach(() => cleanup())

  it('a rejecting lazy import inside Suspense+ErrorBoundary does not unmount siblings', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Boom = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))
    // Exact wrapper shape App.tsx uses for RemoteBanner after the fix.
    render(
      <div>
        <div data-testid="app-chrome">chrome stays alive</div>
        <Suspense fallback={null}>
          <ErrorBoundary name="Remote Banner" fallback={null}>
            <Boom />
          </ErrorBoundary>
        </Suspense>
      </div>,
    )
    await vi.waitFor(() => expect(screen.getByTestId('app-chrome')).toBeInTheDocument())
    consoleSpy.mockRestore()
  })
})
