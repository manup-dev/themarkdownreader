import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveImageBlobUrl } from '../lib/fs-access'

// Build an in-memory directory tree that mimics the FileSystemDirectoryHandle
// surface (getDirectoryHandle / getFileHandle) used by resolveImageBlobUrl.
type Tree = { [name: string]: Tree | 'file' }

function makeDir(tree: Tree): FileSystemDirectoryHandle {
  const handle = {
    async getDirectoryHandle(name: string) {
      const child = tree[name]
      if (child && child !== 'file') return makeDir(child)
      throw new DOMException('not a directory', 'NotFoundError')
    },
    async getFileHandle(name: string) {
      if (tree[name] === 'file') {
        return { async getFile() { return new Blob(['x'], { type: 'image/png' }) as unknown as File } }
      }
      throw new DOMException('not a file', 'NotFoundError')
    },
  }
  return handle as unknown as FileSystemDirectoryHandle
}

describe('resolveImageBlobUrl', () => {
  let created: string[] = []

  beforeEach(() => {
    created = []
    // jsdom lacks createObjectURL — stub it.
    globalThis.URL.createObjectURL = vi.fn(() => {
      const url = `blob:mock-${created.length}`
      created.push(url)
      return url
    })
  })

  const tree: Tree = {
    'readme.md': 'file',
    'logo.png': 'file',
    docs: {
      'api.md': 'file',
      images: { 'diagram.png': 'file' },
    },
    assets: { 'shared.png': 'file' },
  }

  it('resolves a bare relative path against the file directory', async () => {
    const url = await resolveImageBlobUrl(makeDir(tree), 'docs/api.md', 'images/diagram.png')
    expect(url).toBe('blob:mock-0')
  })

  it('resolves a ./ relative path', async () => {
    const url = await resolveImageBlobUrl(makeDir(tree), 'docs/api.md', './images/diagram.png')
    expect(url).toBe('blob:mock-0')
  })

  it('resolves a ../ parent-relative path', async () => {
    const url = await resolveImageBlobUrl(makeDir(tree), 'docs/api.md', '../assets/shared.png')
    expect(url).toBe('blob:mock-0')
  })

  it('resolves a root-relative path from the folder root', async () => {
    const url = await resolveImageBlobUrl(makeDir(tree), 'docs/api.md', '/logo.png')
    expect(url).toBe('blob:mock-0')
  })

  it('resolves relative to root when the file is at top level', async () => {
    const url = await resolveImageBlobUrl(makeDir(tree), 'readme.md', 'logo.png')
    expect(url).toBe('blob:mock-0')
  })

  it('strips query string and hash before lookup', async () => {
    const url = await resolveImageBlobUrl(makeDir(tree), 'readme.md', 'logo.png?v=2#frag')
    expect(url).toBe('blob:mock-0')
  })

  it('returns null for a missing file', async () => {
    const url = await resolveImageBlobUrl(makeDir(tree), 'docs/api.md', 'images/missing.png')
    expect(url).toBeNull()
  })

  it('returns null for a missing intermediate directory', async () => {
    const url = await resolveImageBlobUrl(makeDir(tree), 'docs/api.md', 'nope/diagram.png')
    expect(url).toBeNull()
  })

  it('returns null for an empty source', async () => {
    const url = await resolveImageBlobUrl(makeDir(tree), 'readme.md', '')
    expect(url).toBeNull()
  })
})
