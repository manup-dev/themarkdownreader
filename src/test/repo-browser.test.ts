import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadRepoFolderFromHash } from '../lib/repo-browser'
import type { RemoteDocumentAdapter } from '../lib/remote-document'

const ORIGIN = 'https://mdreader.app'

function fakeAdapter(opts: {
  listFolder: NonNullable<RemoteDocumentAdapter['listFolder']>
}): RemoteDocumentAdapter {
  return {
    parseShareUrl: () => null,
    fetchDocument: async () => { throw new Error('not used') },
    fetchAnnotations: async () => [],
    listFolder: opts.listFolder,
  }
}

describe('loadRepoFolderFromHash', () => {
  let originalFetch: typeof fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns null for non-share URLs', async () => {
    expect(await loadRepoFolderFromHash({ href: 'https://x/' })).toBeNull()
  })

  it('returns null for url-pair shares', async () => {
    expect(await loadRepoFolderFromHash({ href: `${ORIGIN}/#url=https%3A%2F%2Fx%2Fa.md` })).toBeNull()
  })

  it('returns null for github-repo shares pointing at a single .md', async () => {
    const href = `${ORIGIN}/#repo=manu%2Fr&path=a.md`
    expect(await loadRepoFolderFromHash({ href })).toBeNull()
  })

  it('returns folder entries with pre-built share URLs', async () => {
    const adapter = fakeAdapter({
      listFolder: async () => [
        { path: 'docs/a.md', name: 'a.md', type: 'file', url: 'https://raw.x/manu/r/main/docs/a.md' },
        { path: 'docs/sub', name: 'sub', type: 'dir', url: 'https://api.x/manu/r/contents/docs/sub' },
      ],
    })
    globalThis.fetch = vi.fn(async () => new Response('null', { status: 200 })) as typeof fetch

    const result = await loadRepoFolderFromHash({
      href: `${ORIGIN}/#repo=manu%2Fr&path=docs`,
      adapter,
      origin: ORIGIN,
    })
    expect(result).not.toBeNull()
    expect(result!.entries.length).toBe(2)
    // dirs first
    expect(result!.entries[0].type).toBe('dir')
    expect(result!.entries[1].type).toBe('file')
    expect(result!.shareUrls['docs/a.md']).toContain('#url=')
    expect(result!.folderShareUrls['docs/sub']).toContain('#repo=')
    expect(result!.folderShareUrls['docs/sub']).toContain('path=docs%2Fsub')
  })

  it('honors pinned ordering from workspace config', async () => {
    const adapter = fakeAdapter({
      listFolder: async () => [
        { path: 'b.md', name: 'b.md', type: 'file', url: 'https://raw.x/b.md' },
        { path: 'a.md', name: 'a.md', type: 'file', url: 'https://raw.x/a.md' },
        { path: 'pin.md', name: 'pin.md', type: 'file', url: 'https://raw.x/pin.md' },
      ],
    })
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ pinned: ['pin.md'] }), { status: 200 }),
    ) as typeof fetch

    const result = await loadRepoFolderFromHash({
      href: `${ORIGIN}/#repo=manu%2Fr&path=docs`,
      adapter,
      origin: ORIGIN,
    })
    // pinned first, then alphabetical
    expect(result!.entries.map((e) => e.name)).toEqual(['pin.md', 'a.md', 'b.md'])
    expect(result!.config?.pinned).toEqual(['pin.md'])
  })
})
