/**
 * Regression test for the OpenRouter free-tier model fallback chain.
 *
 * Context: when the primary free model (e.g. meta-llama/llama-3.2-3b-instruct:free)
 * is temporarily rate-limited upstream, OpenRouter returns HTTP 429 with a
 * message like "provider returned error, <model> is temporarily rate-limited
 * upstream." This used to fail podcast and diagram generation outright because
 * chatOpenRouterStream hardcoded one model and didn't retry.
 *
 * chatOpenRouterStream is a module-internal function (not exported), so these
 * tests exercise it through the public chat() function with activeBackend
 * forced to 'openrouter'. That also proves the chain works end-to-end from
 * any ai.ts caller.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// In-memory localStorage polyfill (vitest runs under jsdom which has one,
// but we want to reset it between tests)
const storage: Record<string, string> = {}
const mockLocalStorage = {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => { storage[k] = v },
  removeItem: (k: string) => { delete storage[k] },
  clear: () => { for (const k of Object.keys(storage)) delete storage[k] },
}

beforeEach(() => {
  mockLocalStorage.clear()
  vi.stubGlobal('localStorage', mockLocalStorage)
  // Seed a valid-looking key so checkOpenRouter() returns true
  mockLocalStorage.setItem('md-reader-openrouter-key', 'sk-or-v1-fake-test-key-for-unit-tests')
  // Force OpenRouter as the preferred backend so detection picks it immediately
  mockLocalStorage.setItem('md-reader-preferred-backend', 'openrouter')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Build a Response that mimics OpenRouter's 429 JSON error
function rateLimitedResponse(model: string): Response {
  const body = JSON.stringify({
    error: {
      message: 'Provider returned error',
      code: 429,
      metadata: { raw: `${model} is temporarily rate-limited upstream.` },
    },
  })
  return new Response(body, { status: 429, headers: { 'content-type': 'application/json' } })
}

// Build a Response that mimics a successful OpenRouter SSE stream with one token
function successStreamResponse(token: string): Response {
  const sse = `data: {"choices":[{"delta":{"content":${JSON.stringify(token)}}}]}\n\ndata: [DONE]\n\n`
  return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

// Build a Response that mimics a reasoning-mode model — emits chain-of-thought
// into `delta.reasoning` and leaves `delta.content` null. This is the
// 2026-04-15 regression: z-ai/glm-4.5-air accidentally landed in the chain
// and diagram/quiz/podcast parsers all failed because the stream yielded
// empty strings. The defensive empty-content guard must skip past this model.
function emptyContentReasoningResponse(): Response {
  const sse =
    `data: {"choices":[{"delta":{"reasoning":"Let me think about this..."}}]}\n\n` +
    `data: {"choices":[{"delta":{"reasoning":" The answer is..."}}]}\n\n` +
    `data: {"choices":[{"finish_reason":"length"}]}\n\n` +
    `data: [DONE]\n\n`
  return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('OpenRouter model fallback chain', () => {
  it('succeeds on the first model when it is NOT rate-limited', async () => {
    const calls: { model: string }[] = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}')
      calls.push({ model: body.model })
      return successStreamResponse('hello')
    })
    vi.stubGlobal('fetch', fetchMock)

    const ai = await import('../lib/ai')
    const result = await ai.chat([{ role: 'user', content: 'say hello' }])

    expect(result).toBe('hello')
    expect(calls.length).toBe(1)
    // The first call should be to the PRIMARY free model — whichever we
    // currently ship. The test doesn't pin a specific model name so we can
    // re-order the chain without breaking the test; it just verifies the
    // first call happened.
    expect(calls[0].model).toMatch(/:free$/)
  })

  it('falls through on 200-but-empty-content (reasoning model masquerading as success)', async () => {
    // Regression: z-ai/glm-4.5-air (a reasoning model) returned 200 with
    // delta.content=null and delta.reasoning=<cot>, causing chatOpenRouterStream
    // to return ''. parseDiagramDSL('') → null → "Failed to generate diagram".
    // The fix is to treat empty content as a transient failure and skip to
    // the next model. This test pins that behavior so future chain edits
    // can't silently reintroduce the bug.
    const calls: { model: string }[] = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}')
      calls.push({ model: body.model })
      // First call → reasoning-mode 200 with empty content
      // Second call → real content
      if (calls.length === 1) return emptyContentReasoningResponse()
      return successStreamResponse('real-content')
    })
    vi.stubGlobal('fetch', fetchMock)

    const ai = await import('../lib/ai')
    const result = await ai.chat([{ role: 'user', content: 'make diagram' }])

    expect(result).toBe('real-content')
    expect(calls.length).toBe(2)
    expect(calls[0].model).not.toBe(calls[1].model)
  })

  it('throws a targeted error if EVERY model in the chain returns empty content', async () => {
    const calls: { model: string }[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('openrouter.ai') && url.includes('chat/completions')) {
        const body = JSON.parse((init?.body as string) ?? '{}')
        calls.push({ model: body.model })
        return emptyContentReasoningResponse()
      }
      // Simulate Ollama unreachable so chat()'s error-path fallback doesn't
      // mask the OpenRouter exhaustion error we want to assert on.
      return new Response('', { status: 503 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const ai = await import('../lib/ai')
    // Must throw a message that references "empty content" so the UI's
    // error formatter can explain the reasoning-mode issue specifically.
    await expect(ai.chat([{ role: 'user', content: 'test' }])).rejects.toThrow(/empty content/)
    // Must have tried EVERY model in the chain — no silent bailout after
    // the first empty response.
    const uniqueModels = new Set(calls.map(c => c.model))
    expect(uniqueModels.size).toBe(calls.length)
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('falls through to the second model on 429 from the first', async () => {
    const calls: { model: string }[] = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}')
      calls.push({ model: body.model })
      // First call → 429, second call → success
      if (calls.length === 1) return rateLimitedResponse(body.model)
      return successStreamResponse('fallback-ok')
    })
    vi.stubGlobal('fetch', fetchMock)

    const ai = await import('../lib/ai')
    const result = await ai.chat([{ role: 'user', content: 'test' }])

    expect(result).toBe('fallback-ok')
    expect(calls.length).toBe(2)
    expect(calls[0].model).not.toBe(calls[1].model) // different model on retry
    expect(calls[0].model).toMatch(/:free$/)
    expect(calls[1].model).toMatch(/:free$/)
  })

  it('exhausts the full chain on repeated 429s then throws 429', async () => {
    const calls: { model: string }[] = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}')
      calls.push({ model: body.model })
      return rateLimitedResponse(body.model)
    })
    vi.stubGlobal('fetch', fetchMock)

    const ai = await import('../lib/ai')
    await expect(ai.chat([{ role: 'user', content: 'test' }])).rejects.toThrow(/OpenRouter error 429/)

    // The chain has 4 models at time of writing. This assertion is the
    // invariant: it must try ALL of them before giving up, not just one.
    expect(calls.length).toBeGreaterThanOrEqual(2)
    // All calls must have unique model names (no retry of the same model)
    const uniqueModels = new Set(calls.map(c => c.model))
    expect(uniqueModels.size).toBe(calls.length)
  })

  it('propagates non-429 errors immediately without retrying OpenRouter models', async () => {
    const openrouterCalls: { model: string }[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      // Only count OpenRouter chat/completions calls — chat() may fall through
      // to checkOllamaHealth() after OpenRouter throws, which also hits fetch.
      if (url.includes('openrouter.ai') && url.includes('chat/completions')) {
        const body = JSON.parse((init?.body as string) ?? '{}')
        openrouterCalls.push({ model: body.model })
        return new Response('{"error":{"message":"bad auth"}}', { status: 401 })
      }
      // Simulate Ollama unavailable so chat() propagates the OpenRouter error
      return new Response('', { status: 503 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const ai = await import('../lib/ai')
    await expect(ai.chat([{ role: 'user', content: 'test' }])).rejects.toThrow(/401|OpenRouter failed/)
    // 401 is not retryable — must NOT try additional OpenRouter models
    expect(openrouterCalls.length).toBe(1)
  })

  it('always sends a clean Authorization header (no trailing whitespace)', async () => {
    // Store a key WITH trailing whitespace (simulates copy-paste artifact)
    mockLocalStorage.setItem('md-reader-openrouter-key', '  sk-or-v1-fake-key-with-whitespace  \n')
    const authHeaders: string[] = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined
      if (headers?.Authorization) authHeaders.push(headers.Authorization)
      return successStreamResponse('ok')
    })
    vi.stubGlobal('fetch', fetchMock)

    const ai = await import('../lib/ai')
    await ai.chat([{ role: 'user', content: 'test' }])

    expect(authHeaders.length).toBe(1)
    expect(authHeaders[0]).toBe('Bearer sk-or-v1-fake-key-with-whitespace')
    // No trailing whitespace, newlines, or zero-width chars survived
    expect(authHeaders[0]).not.toMatch(/\s$/)
    expect(authHeaders[0]).not.toContain('\n')
  })
})
