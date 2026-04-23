import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fetchWorkspaceConfig, githubWorkspaceRootUrl } from '../lib/workspace-config'

describe('githubWorkspaceRootUrl', () => {
  it('builds the raw root URL', () => {
    expect(githubWorkspaceRootUrl({ owner: 'manu', name: 'r', ref: 'main' }))
      .toBe('https://raw.githubusercontent.com/manu/r/main/')
  })
})

describe('fetchWorkspaceConfig', () => {
  let originalFetch: typeof fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns parsed config when present', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ displayName: 'My Reads', defaultAuthor: 'manu', pinned: ['intro.md'] }), { status: 200 }),
    ) as typeof fetch
    const cfg = await fetchWorkspaceConfig('https://raw.x/o/r/main/')
    expect(cfg).toEqual({ displayName: 'My Reads', defaultAuthor: 'manu', pinned: ['intro.md'] })
  })

  it('returns null on 404', async () => {
    globalThis.fetch = vi.fn(async () => new Response('no', { status: 404 })) as typeof fetch
    expect(await fetchWorkspaceConfig('https://raw.x/o/r/main/')).toBeNull()
  })

  it('returns null on malformed JSON without throwing', async () => {
    globalThis.fetch = vi.fn(async () => new Response('not-json{', { status: 200 })) as typeof fetch
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await fetchWorkspaceConfig('https://raw.x/o/r/main/')).toBeNull()
    warn.mockRestore()
  })

  it('refuses to call private/local hosts (SSRF)', async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const cfg = await fetchWorkspaceConfig('http://localhost/')
    expect(cfg).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects oversized config files', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('x', { status: 200, headers: { 'content-length': String(200 * 1024) } }),
    ) as typeof fetch
    expect(await fetchWorkspaceConfig('https://raw.x/o/r/main/')).toBeNull()
  })

  it('drops unknown fields and keeps the typed shape', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ displayName: 'X', extra: { nope: true } }), { status: 200 }),
    ) as typeof fetch
    const cfg = await fetchWorkspaceConfig('https://raw.x/o/r/main/')
    expect(cfg).toEqual({ displayName: 'X' })
  })

  it('returns null when input has no shape', async () => {
    globalThis.fetch = vi.fn(async () => new Response('null', { status: 200 })) as typeof fetch
    expect(await fetchWorkspaceConfig('https://raw.x/o/r/main/')).toBeNull()
  })
})
