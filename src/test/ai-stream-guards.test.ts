import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock WebLLM so the A11 test can force the webllm branch to fail
// without downloading anything.
vi.mock('@mlc-ai/web-llm', () => ({
  MLCEngine: class {
    setInitProgressCallback() {}
    async reload() { throw new Error('webllm reload failed (test)') }
  },
}))

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
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function ndjsonResponse(tokens: string[]): Response {
  const body =
    tokens.map((t) => JSON.stringify({ message: { content: t } })).join('\n') +
    '\n' + JSON.stringify({ done: true }) + '\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
}

describe('createThinkTagFilter (A9 — unit)', () => {
  it('removes think blocks even when tags split across token boundaries', async () => {
    const { createThinkTagFilter } = await import('../lib/ai')
    const f = createThinkTagFilter()
    const visible: string[] = []
    for (const t of ['Hel', 'lo <th', 'ink>secret', ' chain of thought</thi', 'nk> wor', 'ld']) {
      const v = f.push(t)
      if (v) visible.push(v)
    }
    const tail = f.flush()
    if (tail) visible.push(tail)
    expect(visible.join('')).toBe('Hello  world')
    expect(visible.join('')).not.toContain('secret')
  })

  it('passes plain text through unchanged', async () => {
    const { createThinkTagFilter } = await import('../lib/ai')
    const f = createThinkTagFilter()
    expect(f.push('just a normal answer') + f.flush()).toBe('just a normal answer')
  })
})

describe('signalWithTimeout (A10 — unit)', () => {
  it('still times out when a caller signal is provided', async () => {
    const { signalWithTimeout } = await import('../lib/ai')
    const ctrl = new AbortController()
    const s = signalWithTimeout(ctrl.signal, 20)
    expect(s.aborted).toBe(false)
    await new Promise((r) => setTimeout(r, 60))
    expect(s.aborted).toBe(true) // timeout fired despite the caller signal
  })

  it('aborts when the caller signal aborts', async () => {
    const { signalWithTimeout } = await import('../lib/ai')
    const ctrl = new AbortController()
    const s = signalWithTimeout(ctrl.signal, 60_000)
    ctrl.abort()
    expect(s.aborted).toBe(true)
  })
})

describe('Ollama streaming (A9 — onToken must not leak <think> content)', () => {
  it('streams only the visible answer to onToken', async () => {
    mockLocalStorage.setItem('md-reader-preferred-backend', 'ollama')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/tags')) return new Response('{}', { status: 200 })
      if (url.endsWith('/api/chat')) return ndjsonResponse(['<think>', 'pondering deeply', '</think>', 'Final ', 'answer'])
      return new Response('not found', { status: 404 })
    }))

    const ai = await import('../lib/ai')
    ai.setPreferredBackend('ollama') // also resets cached detection state
    const streamed: string[] = []
    const result = await ai.chat([{ role: 'user', content: 'q' }], undefined, (t) => streamed.push(t))

    expect(result).toBe('Final answer')
    expect(streamed.join('')).toBe('Final answer')
    expect(streamed.join('')).not.toContain('pondering')
  })
})

describe('chat() webllm branch (A11 — OpenRouter fallback parity)', () => {
  it('falls back to OpenRouter when WebLLM fails and Ollama is down', async () => {
    mockLocalStorage.setItem('md-reader-openrouter-key', 'sk-or-v1-fake-test-key')
    mockLocalStorage.setItem('md-reader-preferred-backend', 'webllm')
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('openrouter.ai')) {
        const sse = 'data: {"choices":[{"delta":{"content":"recovered"}}]}\n\ndata: [DONE]\n\n'
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      return new Response('', { status: 503 }) // Ollama unreachable
    }))

    const ai = await import('../lib/ai')
    ai.setPreferredBackend('webllm')
    const result = await ai.chat([{ role: 'user', content: 'q' }])
    expect(result).toBe('recovered')
  })
})
