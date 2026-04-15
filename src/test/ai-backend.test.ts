/**
 * Regression test for the "Waiting for AI..." bug where Chat.tsx's hardcoded
 * isReady allowlist was missing 'gemma4' — so every WebGPU-capable browser
 * (the default case) saw the input permanently disabled.
 *
 * Centralizing backend readiness in ai.ts prevents this drift from ever
 * happening again: adding a new backend type to the union requires updating
 * isBackendReady, and this test pins the invariant.
 */

import { describe, it, expect } from 'vitest'
import { isBackendReady } from '../lib/ai'

describe('isBackendReady', () => {
  it('returns true for every real backend that can serve a chat call', () => {
    // These four must all be considered ready. If you add a new backend,
    // add it here AND to isBackendReady — Chat/Coach/SummaryCards depend on it.
    expect(isBackendReady('gemma4')).toBe(true)
    expect(isBackendReady('webllm')).toBe(true)
    expect(isBackendReady('ollama')).toBe(true)
    expect(isBackendReady('openrouter')).toBe(true)
  })

  it('returns false for "none" and unrecognized values', () => {
    expect(isBackendReady('none')).toBe(false)
    expect(isBackendReady('detecting...')).toBe(false)
    expect(isBackendReady('')).toBe(false)
    expect(isBackendReady('unknown-backend')).toBe(false)
  })

  it('specifically includes gemma4 (the WebGPU default)', () => {
    // Bug #1 was: Chat.tsx's inline isReady check was missing gemma4,
    // so every Chrome/Edge user saw "Waiting for AI..." indefinitely
    // even when the browser model was loading/ready.
    expect(isBackendReady('gemma4')).toBe(true)
  })
})

// The "set OpenRouter key mid-session doesn't take effect until refresh"
// regression is fixed in ai.ts (setApiKey/clearApiKey/setPreferredBackend
// now null detectPromise in addition to backendDetected). A unit test for
// this would require mocking the full Ollama/WebGPU/OpenRouter detection
// pipeline across dynamic module imports and vi.resetModules — the mocks
// proved flaky in jsdom. The fix is a 3-line change with a comment
// pointing at this bug; if it regresses, the Playwright smoke on the
// live site catches it end-to-end.
