import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HttpRemoteAdapter, GithubRemoteAdapter, defaultRemoteAdapter } from '../lib/remote-document'
import { buildInlineShare } from '../lib/share-url'

const ORIGIN = 'https://mdreader.app'

describe('HttpRemoteAdapter.parseShareUrl', () => {
  it('returns null when no share params', () => {
    expect(new HttpRemoteAdapter().parseShareUrl(`${ORIGIN}/`)).toBeNull()
  })
})

describe('HttpRemoteAdapter.fetchAnnotations — inline tier', () => {
  it('decodes inline base64url WAL and returns events', async () => {
    const wal =
      '{"v":1,"ts":1,"id":"h1","op":"highlight.add","docKey":"d","anchor":{"text":"x"},"color":"yellow"}'
    const { url } = buildInlineShare({ origin: ORIGIN, docUrl: 'https://x/a.md', walJsonl: wal })
    const handle = new HttpRemoteAdapter().parseShareUrl(url)!
    const events = await new HttpRemoteAdapter().fetchAnnotations(handle)
    expect(events.length).toBe(1)
    expect(events[0].id).toBe('h1')
  })

  it('returns [] on garbled inline payload (degrades gracefully)', async () => {
    const handle = { kind: 'inline' as const, docUrl: 'https://x/a.md', inlineAnnot: 'this-is-not-base64!@#' }
    // Spy console.warn to silence + assert — degradation should be observable
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const events = await new HttpRemoteAdapter().fetchAnnotations(handle)
    expect(events).toEqual([])
    warn.mockRestore()
  })
})

describe('HttpRemoteAdapter.fetchAnnotations — URL-pair sibling auto-resolve', () => {
  let originalFetch: typeof fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('fetches from the sibling URL when annot URL is absent', async () => {
    const calls: string[] = []
    const wal =
      '{"v":1,"ts":1,"id":"h1","op":"highlight.add","docKey":"d","anchor":{"text":"x"},"color":"yellow"}'
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      calls.push(url)
      if (url.endsWith('/.foo.md.annot')) {
        return new Response(wal, { status: 200, headers: { 'content-type': 'text/plain' } })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const handle = { kind: 'url-pair' as const, docUrl: 'https://example.com/foo.md' }
    const events = await new HttpRemoteAdapter().fetchAnnotations(handle)
    expect(events.length).toBe(1)
    expect(calls.some((c) => c.endsWith('/.foo.md.annot'))).toBe(true)
  })

  it('returns [] without throwing when sidecar 404s (R4)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('not found', { status: 404 }),
    ) as typeof fetch
    const handle = { kind: 'url-pair' as const, docUrl: 'https://example.com/foo.md' }
    const events = await new HttpRemoteAdapter().fetchAnnotations(handle)
    expect(events).toEqual([])
  })

  it('returns [] without throwing when fetch throws (R4)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as typeof fetch
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = { kind: 'url-pair' as const, docUrl: 'https://example.com/foo.md' }
    const events = await new HttpRemoteAdapter().fetchAnnotations(handle)
    expect(events).toEqual([])
    warn.mockRestore()
  })

  it('refuses to call private/local sidecar URLs (SSRF)', async () => {
    globalThis.fetch = vi.fn() as typeof fetch
    const handle = { kind: 'url-pair' as const, docUrl: 'https://example.com/foo.md', annotUrl: 'http://127.0.0.1/secret' }
    const events = await new HttpRemoteAdapter().fetchAnnotations(handle)
    expect(events).toEqual([])
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('HttpRemoteAdapter.fetchDocument', () => {
  let originalFetch: typeof fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('rejects file:// docs', async () => {
    const handle = { kind: 'url-pair' as const, docUrl: 'file:///etc/passwd' }
    await expect(new HttpRemoteAdapter().fetchDocument(handle)).rejects.toThrow(/Refusing to fetch/)
  })

  it('returns markdown body and guessed file name', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('# hello', { status: 200 }),
    ) as typeof fetch
    const handle = { kind: 'url-pair' as const, docUrl: 'https://example.com/notes/foo.md' }
    const doc = await new HttpRemoteAdapter().fetchDocument(handle)
    expect(doc.markdown).toBe('# hello')
    expect(doc.fileName).toBe('foo.md')
    expect(doc.sourceUrl).toBe('https://example.com/notes/foo.md')
  })

  it('rewrites GitHub blob URLs to raw URLs', async () => {
    let calledUrl = ''
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = typeof input === 'string' ? input : input.toString()
      return new Response('# x', { status: 200 })
    }) as typeof fetch
    const handle = { kind: 'url-pair' as const, docUrl: 'https://github.com/o/r/blob/main/a.md' }
    await new HttpRemoteAdapter().fetchDocument(handle)
    expect(calledUrl).toBe('https://raw.githubusercontent.com/o/r/main/a.md')
  })

  it('throws on HTTP non-2xx', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('error', { status: 500 }),
    ) as typeof fetch
    const handle = { kind: 'url-pair' as const, docUrl: 'https://example.com/a.md' }
    await expect(new HttpRemoteAdapter().fetchDocument(handle)).rejects.toThrow(/HTTP 500/)
  })

  it('throws on oversized content-length', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('x', {
        status: 200,
        headers: { 'content-length': String(20 * 1024 * 1024) },
      }),
    ) as typeof fetch
    const handle = { kind: 'url-pair' as const, docUrl: 'https://example.com/a.md' }
    await expect(new HttpRemoteAdapter().fetchDocument(handle)).rejects.toThrow(/too large/)
  })
})

describe('GithubRemoteAdapter', () => {
  let originalFetch: typeof fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('composes a raw URL from a github-repo handle', async () => {
    let calledUrl = ''
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = typeof input === 'string' ? input : input.toString()
      return new Response('# from repo', { status: 200 })
    }) as typeof fetch

    const handle = {
      kind: 'github-repo' as const,
      repo: { owner: 'manu', name: 'reading', ref: 'main', path: 'a.md' },
    }
    const doc = await new GithubRemoteAdapter().fetchDocument(handle)
    expect(calledUrl).toBe('https://raw.githubusercontent.com/manu/reading/main/a.md')
    expect(doc.markdown).toBe('# from repo')
  })

  it('listFolder returns .md siblings + dirs from the GitHub Contents API', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify([
          { name: 'a.md', path: 'docs/a.md', type: 'file', download_url: 'https://raw.x/a.md' },
          { name: 'b.txt', path: 'docs/b.txt', type: 'file' },
          { name: 'sub', path: 'docs/sub', type: 'dir' },
        ]),
        { status: 200 },
      ),
    ) as typeof fetch
    const handle = {
      kind: 'github-repo' as const,
      repo: { owner: 'o', name: 'r', ref: 'main', path: 'docs' },
    }
    const entries = await new GithubRemoteAdapter().listFolder(handle)
    expect(entries.map((e) => e.name)).toEqual(['a.md', 'sub'])
  })
})

describe('defaultRemoteAdapter', () => {
  it('routes github-repo handles to GithubRemoteAdapter', async () => {
    let calledUrl = ''
    const origFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = typeof input === 'string' ? input : input.toString()
      return new Response('# repo', { status: 200 })
    }) as typeof fetch
    const adapter = defaultRemoteAdapter()
    await adapter.fetchDocument({
      kind: 'github-repo',
      repo: { owner: 'o', name: 'r', ref: 'main', path: 'a.md' },
    })
    expect(calledUrl).toContain('raw.githubusercontent.com')
    globalThis.fetch = origFetch
  })
})
