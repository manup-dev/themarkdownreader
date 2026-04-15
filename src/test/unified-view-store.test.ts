/**
 * State-transition tests for the unified directory/file view.
 * Pins the store contract so downstream components can rely on the
 * shape of folder session state.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store/useStore'

describe('useStore — unified view state', () => {
  beforeEach(() => {
    // Reset store to initial state between tests
    useStore.setState({
      folderHandle: null,
      folderFiles: null,
      folderFileContents: null,
      activeFilePath: null,
      sidebarCollapsed: false,
      sidebarExpandedFile: null,
      markdown: '',
      fileName: null,
      viewMode: 'read',
    })
  })

  describe('setFolderSession', () => {
    it('populates folderFiles and folderFileContents from the files array', () => {
      const files = [
        { path: 'a.md', name: 'a.md', content: '# A' },
        { path: 'b.md', name: 'b.md', content: '# B' },
      ]
      useStore.getState().setFolderSession(null, files)
      const s = useStore.getState()
      expect(s.folderFiles).toEqual([
        { path: 'a.md', name: 'a.md' },
        { path: 'b.md', name: 'b.md' },
      ])
      expect(s.folderFileContents?.get('a.md')).toBe('# A')
      expect(s.folderFileContents?.get('b.md')).toBe('# B')
    })

    it('auto-selects the first file (no README.md present)', () => {
      const files = [
        { path: 'alpha.md', name: 'alpha.md', content: '# Alpha' },
        { path: 'beta.md', name: 'beta.md', content: '# Beta' },
      ]
      useStore.getState().setFolderSession(null, files)
      expect(useStore.getState().activeFilePath).toBe('alpha.md')
      expect(useStore.getState().markdown).toBe('# Alpha')
      expect(useStore.getState().fileName).toBe('alpha.md')
    })

    it('auto-selects README.md when present, regardless of order', () => {
      const files = [
        { path: 'alpha.md', name: 'alpha.md', content: '# Alpha' },
        { path: 'README.md', name: 'README.md', content: '# Readme' },
        { path: 'beta.md', name: 'beta.md', content: '# Beta' },
      ]
      useStore.getState().setFolderSession(null, files)
      expect(useStore.getState().activeFilePath).toBe('README.md')
      expect(useStore.getState().markdown).toBe('# Readme')
    })

    it('handles zero-file case by leaving activeFilePath null', () => {
      useStore.getState().setFolderSession(null, [])
      const s = useStore.getState()
      expect(s.folderFiles).toEqual([])
      expect(s.activeFilePath).toBeNull()
      expect(s.markdown).toBe('')
    })
  })

  describe('setActiveFile', () => {
    it('swaps the active file and loads its markdown into the main slot', () => {
      const files = [
        { path: 'a.md', name: 'a.md', content: '# A' },
        { path: 'b.md', name: 'b.md', content: '# B' },
      ]
      useStore.getState().setFolderSession(null, files)
      useStore.getState().setActiveFile('b.md')
      expect(useStore.getState().activeFilePath).toBe('b.md')
      expect(useStore.getState().markdown).toBe('# B')
      expect(useStore.getState().fileName).toBe('b.md')
    })

    it('no-op if path is not in folderFileContents', () => {
      const files = [{ path: 'a.md', name: 'a.md', content: '# A' }]
      useStore.getState().setFolderSession(null, files)
      const before = useStore.getState().activeFilePath
      useStore.getState().setActiveFile('nope.md')
      expect(useStore.getState().activeFilePath).toBe(before)
    })

    it('accepts null to clear the active file (keeps folder intact)', () => {
      const files = [{ path: 'a.md', name: 'a.md', content: '# A' }]
      useStore.getState().setFolderSession(null, files)
      useStore.getState().setActiveFile(null)
      const s = useStore.getState()
      expect(s.activeFilePath).toBeNull()
      expect(s.markdown).toBe('')
      expect(s.folderFiles).toHaveLength(1)  // folder still intact
    })
  })

  describe('closeFolderSession', () => {
    it('clears all folder-related state', () => {
      const files = [{ path: 'a.md', name: 'a.md', content: '# A' }]
      useStore.getState().setFolderSession(null, files)
      useStore.getState().closeFolderSession()
      const s = useStore.getState()
      expect(s.folderHandle).toBeNull()
      expect(s.folderFiles).toBeNull()
      expect(s.folderFileContents).toBeNull()
      expect(s.activeFilePath).toBeNull()
      expect(s.sidebarExpandedFile).toBeNull()
      expect(s.markdown).toBe('')
    })
  })

  describe('toggleSidebar', () => {
    it('flips sidebarCollapsed', () => {
      expect(useStore.getState().sidebarCollapsed).toBe(false)
      useStore.getState().toggleSidebar()
      expect(useStore.getState().sidebarCollapsed).toBe(true)
      useStore.getState().toggleSidebar()
      expect(useStore.getState().sidebarCollapsed).toBe(false)
    })
  })

  describe('navigateToPath (intra-folder link routing)', () => {
    it('resolves a relative path to an existing file and sets it active', () => {
      const files = [
        { path: 'intro.md', name: 'intro.md', content: '# Intro' },
        { path: 'api.md', name: 'api.md', content: '# API' },
      ]
      useStore.getState().setFolderSession(null, files)
      useStore.getState().setActiveFile('intro.md')
      // Link inside intro.md: [api](./api.md) → should jump to api.md
      const ok = useStore.getState().navigateToPath('./api.md')
      expect(ok).toBe(true)
      expect(useStore.getState().activeFilePath).toBe('api.md')
    })

    it('returns false for a path that does not resolve to a known file', () => {
      const files = [{ path: 'intro.md', name: 'intro.md', content: '# Intro' }]
      useStore.getState().setFolderSession(null, files)
      useStore.getState().setActiveFile('intro.md')
      const ok = useStore.getState().navigateToPath('./missing.md')
      expect(ok).toBe(false)
      expect(useStore.getState().activeFilePath).toBe('intro.md')  // unchanged
    })
  })
})
