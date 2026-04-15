import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useStore } from '../store/useStore'

// Mock the docstore cache API
vi.mock('../lib/docstore', async () => {
  const actual = await vi.importActual<typeof import('../lib/docstore')>('../lib/docstore')
  return {
    ...actual,
    getCollectionCache: vi.fn(),
    saveCollectionCache: vi.fn(),
  }
})

import { getCollectionCache } from '../lib/docstore'

describe('hydrateFolderFromCache', () => {
  beforeEach(() => {
    useStore.setState({
      folderHandle: null,
      folderFiles: null,
      folderFileContents: null,
      activeFilePath: null,
      markdown: '',
      fileName: null,
    })
    vi.clearAllMocks()
    // Clear any viewedFiles state
    if (typeof localStorage !== 'undefined') {
      Object.keys(localStorage).filter(k => k.includes('viewed')).forEach(k => localStorage.removeItem(k))
    }
  })

  it('restores folder session from cache when folderFiles is null', async () => {
    ;(getCollectionCache as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: 'my-docs',
      files: [
        { path: 'README.md', content: '# Readme' },
        { path: 'spec.md', content: '# Spec' },
      ],
      timestamp: Date.now(),
    })

    await useStore.getState().hydrateFolderFromCache()

    const s = useStore.getState()
    expect(s.folderFiles).toHaveLength(2)
    expect(s.activeFilePath).toBe('README.md')
    expect(s.markdown).toBe('# Readme')
  })

  it('no-op if cache is empty', async () => {
    ;(getCollectionCache as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await useStore.getState().hydrateFolderFromCache()
    expect(useStore.getState().folderFiles).toBeNull()
  })

  it('no-op if folderFiles is already populated (session already hydrated)', async () => {
    const getCacheMock = getCollectionCache as ReturnType<typeof vi.fn>
    useStore.getState().setFolderSession(null, [
      { path: 'x.md', name: 'x.md', content: '# X' },
    ])
    await useStore.getState().hydrateFolderFromCache()
    expect(getCacheMock).not.toHaveBeenCalled()
  })

  it('migrates legacy viewedFiles from index-keyed to path-keyed', async () => {
    // Seed old format: md-reader-collection-viewed-my-docs = [0, 2] (indices)
    localStorage.setItem('md-reader-collection-viewed-my-docs', JSON.stringify([0, 2]))
    ;(getCollectionCache as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: 'my-docs',
      files: [
        { path: 'a.md', content: '# A' },  // index 0 → viewed
        { path: 'b.md', content: '# B' },  // index 1 → unviewed
        { path: 'c.md', content: '# C' },  // index 2 → viewed
      ],
      timestamp: Date.now(),
    })

    await useStore.getState().hydrateFolderFromCache()

    // Legacy key should be gone
    expect(localStorage.getItem('md-reader-collection-viewed-my-docs')).toBeNull()
    // New path-keyed format should exist
    const migrated = JSON.parse(localStorage.getItem('md-reader-viewed-files:my-docs') ?? '{}')
    expect(migrated['a.md']).toBe(true)
    expect(migrated['b.md']).toBeUndefined()
    expect(migrated['c.md']).toBe(true)
  })

  it('migration is idempotent — running twice does not duplicate or regress', async () => {
    localStorage.setItem('md-reader-collection-viewed-my-docs', JSON.stringify([1]))
    ;(getCollectionCache as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: 'my-docs',
      files: [
        { path: 'a.md', content: '# A' },
        { path: 'b.md', content: '# B' },
      ],
      timestamp: Date.now(),
    })

    await useStore.getState().hydrateFolderFromCache()
    // Reset folder state but NOT localStorage
    useStore.setState({ folderFiles: null, folderFileContents: null, activeFilePath: null })
    await useStore.getState().hydrateFolderFromCache()

    const migrated = JSON.parse(localStorage.getItem('md-reader-viewed-files:my-docs') ?? '{}')
    expect(migrated['b.md']).toBe(true)
    expect(migrated['a.md']).toBeUndefined()
  })
})
