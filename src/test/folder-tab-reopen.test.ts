import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the FS-access + handle-store + toast surfaces that reopenFolderTab uses.
// (A real FileSystemDirectoryHandle can't be fabricated in jsdom, so we stub the
//  boundary and assert reopenFolderTab's behaviour: reload on success, flash an
//  error toast on a moved/denied/lost folder.)
vi.mock('../lib/handleStore', async () => {
  const actual = await vi.importActual<typeof import('../lib/handleStore')>('../lib/handleStore')
  return { ...actual, getHandle: vi.fn(), putHandle: vi.fn().mockResolvedValue(undefined) }
})
vi.mock('../lib/fs-access', async () => {
  const actual = await vi.importActual<typeof import('../lib/fs-access')>('../lib/fs-access')
  return { ...actual, reopenDirectory: vi.fn() }
})
vi.mock('../lib/toast', () => ({ showToast: vi.fn() }))

import { useStore } from '../store/useStore'
import { getHandle } from '../lib/handleStore'
import { reopenDirectory } from '../lib/fs-access'
import { showToast } from '../lib/toast'

const getHandleMock = getHandle as ReturnType<typeof vi.fn>
const reopenDirectoryMock = reopenDirectory as ReturnType<typeof vi.fn>
const showToastMock = showToast as ReturnType<typeof vi.fn>

function seedActiveFolderTab(overrides: Record<string, unknown> = {}) {
  const folderTab = {
    id: 'ft1', kind: 'folder', title: 'my-docs', folderName: 'my-docs',
    handleKey: 'hk1', activeFilePath: 'README.md',
    viewMode: 'read', scrollProgress: 0, createdAt: 1, lastAccessedAt: 1,
    ...overrides,
  }
  useStore.setState({
    tabs: [folderTab as never],
    activeTabId: 'ft1',
    folderFiles: null,
    folderHandle: null,
    folderFileContents: null,
    markdown: '',
  })
}

describe('reopenFolderTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedActiveFolderTab()
  })

  it('reloads the directory from the persisted handle (no Upload-screen fallback)', async () => {
    getHandleMock.mockResolvedValue({ name: 'my-docs' }) // fake handle
    reopenDirectoryMock.mockResolvedValue([
      { path: 'README.md', content: '# Readme', lastModified: 0 },
      { path: 'spec.md', content: '# Spec', lastModified: 0 },
    ])

    await useStore.getState().reopenFolderTab('ft1')

    const s = useStore.getState()
    expect(s.folderFiles).toHaveLength(2)          // folder restored → App shows folder view, not home
    expect(getHandleMock).toHaveBeenCalledWith('hk1')
    expect(showToastMock).not.toHaveBeenCalled()   // no error flash on success
  })

  it('restores the previously-viewed file within the folder (not just the first)', async () => {
    // tab was last viewing spec.md (not the first file)
    seedActiveFolderTab({ activeFilePath: 'spec.md' })
    getHandleMock.mockResolvedValue({ name: 'my-docs' })
    reopenDirectoryMock.mockResolvedValue([
      { path: 'README.md', content: '# Readme', lastModified: 0 },
      { path: 'spec.md', content: '# Spec', lastModified: 0 },
    ])

    await useStore.getState().reopenFolderTab('ft1')

    const s = useStore.getState()
    expect(s.activeFilePath).toBe('spec.md')   // returned to the file we were on
    expect(s.markdown).toBe('# Spec')          // and its content is loaded
  })

  it('falls back to the first file when the previously-viewed file is gone', async () => {
    seedActiveFolderTab({ activeFilePath: 'deleted.md' })
    getHandleMock.mockResolvedValue({ name: 'my-docs' })
    reopenDirectoryMock.mockResolvedValue([
      { path: 'README.md', content: '# Readme', lastModified: 0 },
      { path: 'spec.md', content: '# Spec', lastModified: 0 },
    ])

    await useStore.getState().reopenFolderTab('ft1')

    const s = useStore.getState()
    expect(s.folderFiles).toHaveLength(2)       // folder still restored
    expect(s.activeFilePath).toBe('README.md')  // gracefully on the first file
  })

  it('flashes an error toast (and stays unloaded) when the folder was moved / access denied', async () => {
    getHandleMock.mockResolvedValue({ name: 'my-docs' })
    reopenDirectoryMock.mockRejectedValue(new Error('Permission denied'))

    await useStore.getState().reopenFolderTab('ft1')

    expect(showToastMock).toHaveBeenCalledTimes(1)
    expect(String(showToastMock.mock.calls[0][0])).toMatch(/moved|denied/i)
    expect(useStore.getState().folderFiles).toBeNull()
  })

  it('flashes an error toast when the directory handle reference was lost', async () => {
    getHandleMock.mockResolvedValue(null)

    await useStore.getState().reopenFolderTab('ft1')

    expect(reopenDirectoryMock).not.toHaveBeenCalled()
    expect(showToastMock).toHaveBeenCalledTimes(1)
    expect(useStore.getState().folderFiles).toBeNull()
  })

  it('flashes an error toast when the tab has no handle key at all', async () => {
    seedActiveFolderTab({ handleKey: undefined })

    await useStore.getState().reopenFolderTab('ft1')

    expect(getHandleMock).not.toHaveBeenCalled()
    expect(showToastMock).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when the target tab is not the active one (guards stale calls)', async () => {
    useStore.setState({ activeTabId: 'someOtherTab' })
    await useStore.getState().reopenFolderTab('ft1')
    expect(getHandleMock).not.toHaveBeenCalled()
    expect(showToastMock).not.toHaveBeenCalled()
  })
})
