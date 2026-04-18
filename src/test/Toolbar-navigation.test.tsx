/**
 * Pins the Toolbar's "back to upload screen" navigation UX.
 *
 * Prior behavior: in folder mode, the X button called setActiveFile(null)
 * which left the user in a dead-end state — the folder stayed open but
 * nothing was rendered. They had to hunt for a second X inside the
 * sidebar to actually close the folder.
 *
 * New behavior (non-breaking):
 * 1. A Home button is always visible in the toolbar. One click returns
 *    to the upload screen regardless of mode.
 * 2. The X in folder mode now closes the folder (via a confirm dialog
 *    with a "Don't ask again" checkbox that persists to localStorage).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Toolbar } from '../components/Toolbar'
import { useStore } from '../store/useStore'
import { MdReaderProvider } from '../provider/MdReaderProvider'
import type { StorageAdapter } from '../types/storage-adapter'

const mockAdapter = {
  addDocument: vi.fn(),
} as unknown as StorageAdapter

function renderToolbar() {
  return render(
    <MdReaderProvider adapter={mockAdapter}>
      <Toolbar />
    </MdReaderProvider>,
  )
}

describe('<Toolbar> — back-to-upload navigation', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    // Reset the store to a known baseline
    useStore.setState({
      markdown: '',
      fileName: null,
      workspaceMode: false,
      folderHandle: null,
      folderFiles: null,
      folderFileContents: null,
      activeFilePath: null,
      activeDocId: null,
      viewMode: 'read',
      readingProgress: 0,
    })
    // jsdom doesn't drive location.hash on assignment cleanups; reset explicitly
    window.location.hash = ''
  })

  describe('Home button', () => {
    it('renders in the toolbar even when only a document is loaded', () => {
      useStore.setState({ markdown: '# hello', fileName: 'hello.md' })
      renderToolbar()
      expect(screen.getByRole('button', { name: /go to upload screen/i })).toBeInTheDocument()
    })

    it('renders in the toolbar when a folder is loaded', () => {
      useStore.getState().setFolderSession(null, [{ path: 'a.md', name: 'a.md', content: '# A' }])
      renderToolbar()
      expect(screen.getByRole('button', { name: /go to upload screen/i })).toBeInTheDocument()
    })

    it('clicking Home from a single document returns to the upload screen', () => {
      useStore.setState({ markdown: '# hello', fileName: 'hello.md', activeDocId: 42 })
      renderToolbar()
      fireEvent.click(screen.getByRole('button', { name: /go to upload screen/i }))
      const s = useStore.getState()
      // Upload screen gate: !markdown && !workspaceMode && !folderFiles
      expect(s.markdown).toBe('')
      expect(s.workspaceMode).toBe(false)
      expect(s.folderFiles).toBeNull()
      expect(s.activeDocId).toBeNull()
    })

    it('clicking Home from a folder returns to the upload screen (no dialog)', () => {
      useStore.getState().setFolderSession(null, [
        { path: 'a.md', name: 'a.md', content: '# A' },
        { path: 'b.md', name: 'b.md', content: '# B' },
      ])
      renderToolbar()
      fireEvent.click(screen.getByRole('button', { name: /go to upload screen/i }))
      const s = useStore.getState()
      expect(s.folderFiles).toBeNull()
      expect(s.markdown).toBe('')
      // No confirm dialog was opened
      expect(screen.queryByText(/close folder and return to home/i)).not.toBeInTheDocument()
    })

    it('clicking Home from workspace mode exits workspace', () => {
      useStore.setState({ workspaceMode: true })
      renderToolbar()
      fireEvent.click(screen.getByRole('button', { name: /go to upload screen/i }))
      expect(useStore.getState().workspaceMode).toBe(false)
    })
  })

  describe('Toolbar X in folder mode', () => {
    it('opens a confirm dialog on first use instead of silently clearing the active file', () => {
      useStore.getState().setFolderSession(null, [
        { path: 'a.md', name: 'a.md', content: '# A' },
        { path: 'b.md', name: 'b.md', content: '# B' },
      ])
      renderToolbar()
      const closeBtn = screen.getByRole('button', { name: /close folder/i })
      fireEvent.click(closeBtn)
      expect(screen.getByText(/close folder and return to home/i)).toBeInTheDocument()
      // Folder still open while dialog is up
      expect(useStore.getState().folderFiles).not.toBeNull()
    })

    it('confirming closes the folder and returns to upload screen', () => {
      useStore.getState().setFolderSession(null, [
        { path: 'a.md', name: 'a.md', content: '# A' },
      ])
      renderToolbar()
      fireEvent.click(screen.getByRole('button', { name: /close folder/i }))
      // Click the confirm button inside the dialog
      // Disambiguate from the toolbar X (which has title="Close folder"):
      // the dialog's confirm button renders the text "Close folder" as its child.
      fireEvent.click(screen.getByText(/^close folder$/i))
      expect(useStore.getState().folderFiles).toBeNull()
      expect(useStore.getState().markdown).toBe('')
    })

    it('cancelling keeps the folder open', () => {
      useStore.getState().setFolderSession(null, [
        { path: 'a.md', name: 'a.md', content: '# A' },
      ])
      renderToolbar()
      fireEvent.click(screen.getByRole('button', { name: /close folder/i }))
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(useStore.getState().folderFiles).not.toBeNull()
    })

    it('"Don\'t ask again" persists and skips the dialog on subsequent clicks', () => {
      useStore.getState().setFolderSession(null, [
        { path: 'a.md', name: 'a.md', content: '# A' },
      ])
      renderToolbar()
      fireEvent.click(screen.getByRole('button', { name: /close folder/i }))
      const checkbox = screen.getByRole('checkbox', { name: /don't ask me again/i }) as HTMLInputElement
      fireEvent.click(checkbox)
      expect(checkbox.checked).toBe(true)
      // Disambiguate from the toolbar X (which has title="Close folder"):
      // the dialog's confirm button renders the text "Close folder" as its child.
      fireEvent.click(screen.getByText(/^close folder$/i))
      expect(localStorage.getItem('md-reader-skip-folder-close-confirm')).toBe('true')

      // Reload a folder and click again — should close without a dialog
      useStore.getState().setFolderSession(null, [
        { path: 'a.md', name: 'a.md', content: '# A' },
      ])
      cleanup()
      renderToolbar()
      fireEvent.click(screen.getByRole('button', { name: /close folder/i }))
      expect(screen.queryByText(/close folder and return to home/i)).not.toBeInTheDocument()
      expect(useStore.getState().folderFiles).toBeNull()
    })
  })
})
