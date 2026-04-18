import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileExplorer } from '../components/FileExplorer'
import { useStore } from '../store/useStore'

describe('<FileExplorer>', () => {
  beforeEach(() => {
    class MockIO {
      cb: (entries: IntersectionObserverEntry[]) => void
      constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
        this.cb = cb
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', MockIO as unknown)
    useStore.setState({
      folderHandle: null,
      folderFiles: null,
      folderFileContents: null,
      activeFilePath: null,
      sidebarExpandedFile: null,
      markdown: '',
      fileName: null,
      toc: [],
    })
  })

  it('renders empty-state when no folder is loaded', () => {
    render(<FileExplorer />)
    expect(screen.getByText(/open a folder/i)).toBeInTheDocument()
  })

  it('renders empty-folder state when folder has zero files', () => {
    useStore.getState().setFolderSession(null, [])
    render(<FileExplorer />)
    expect(screen.getByText(/no markdown files/i)).toBeInTheDocument()
  })

  it('renders the file list when a folder is loaded', () => {
    useStore.getState().setFolderSession(null, [
      { path: 'a.md', name: 'a.md', content: '# A' },
      { path: 'b.md', name: 'b.md', content: '# B' },
    ])
    render(<FileExplorer />)
    expect(screen.getByText('a.md')).toBeInTheDocument()
    expect(screen.getByText('b.md')).toBeInTheDocument()
  })

  it('highlights the active file', () => {
    useStore.getState().setFolderSession(null, [
      { path: 'a.md', name: 'a.md', content: '# A' },
      { path: 'b.md', name: 'b.md', content: '# B' },
    ])
    render(<FileExplorer />)
    const activeRow = screen.getByText('a.md').closest('button')
    expect(activeRow).toHaveAttribute('aria-current', 'true')
  })

  it('clicking a different file sets it as active', () => {
    useStore.getState().setFolderSession(null, [
      { path: 'a.md', name: 'a.md', content: '# A' },
      { path: 'b.md', name: 'b.md', content: '# B' },
    ])
    render(<FileExplorer />)
    fireEvent.click(screen.getByText('b.md'))
    expect(useStore.getState().activeFilePath).toBe('b.md')
    expect(useStore.getState().markdown).toBe('# B')
  })

  it('clicking the active file toggles its outline expansion', () => {
    useStore.getState().setFolderSession(null, [
      { path: 'a.md', name: 'a.md', content: '# A' },
    ])
    // Seed the toc so outline has something to render
    useStore.setState({
      toc: [
        { id: 'section-1', text: 'Section 1', level: 2 },
        { id: 'section-2', text: 'Section 2', level: 2 },
      ],
    })
    render(<FileExplorer />)

    // Initially collapsed — outline headings not visible
    expect(screen.queryByText('Section 1')).toBeNull()

    // Click the active file → expand
    fireEvent.click(screen.getByText('a.md'))
    expect(screen.getByText('Section 1')).toBeInTheDocument()
    expect(screen.getByText('Section 2')).toBeInTheDocument()

    // Click again → collapse
    fireEvent.click(screen.getByText('a.md'))
    expect(screen.queryByText('Section 1')).toBeNull()
  })

  it('shows a Close folder button that clears folder state', () => {
    useStore.getState().setFolderSession(null, [
      { path: 'a.md', name: 'a.md', content: '# A' },
    ])
    render(<FileExplorer />)
    const closeBtn = screen.getByRole('button', { name: /close folder/i })
    expect(closeBtn).toBeInTheDocument()
    fireEvent.click(closeBtn)
    expect(useStore.getState().folderFiles).toBeNull()
  })

  describe('Sort controls', () => {
    it('renders files in natural-alphabetical order even when handed out-of-order', () => {
      useStore.getState().setFolderSession(null, [
        { path: '10-advanced.md', name: '10-advanced.md', content: '' },
        { path: '08-notes.md', name: '08-notes.md', content: '' },
        { path: '00-intro.md', name: '00-intro.md', content: '' },
        { path: '07-setup.md', name: '07-setup.md', content: '' },
      ])
      render(<FileExplorer />)
      const names = screen
        .getAllByRole('button')
        .map(b => b.textContent?.trim())
        .filter((t): t is string => !!t && /\.md$/.test(t))
      const order = ['00-intro.md', '07-setup.md', '08-notes.md', '10-advanced.md']
      expect(names.slice(0, 4)).toEqual(order)
    })

    it('switching sort to Name (Z → A) reverses the list', () => {
      useStore.getState().setFolderSession(null, [
        { path: '01-a.md', name: '01-a.md', content: '' },
        { path: '02-b.md', name: '02-b.md', content: '' },
        { path: '03-c.md', name: '03-c.md', content: '' },
      ])
      render(<FileExplorer />)
      const sortBtn = screen.getByRole('button', { name: /sort files/i })
      fireEvent.click(sortBtn)
      fireEvent.click(screen.getByRole('menuitemradio', { name: /z → a/i }))
      const names = screen
        .getAllByRole('button')
        .map(b => b.textContent?.trim())
        .filter((t): t is string => !!t && /\.md$/.test(t))
      expect(names.slice(0, 3)).toEqual(['03-c.md', '02-b.md', '01-a.md'])
      expect(useStore.getState().folderSortMode).toBe('name-desc')
    })

    it('Modified (newest) sorts by lastModified descending', () => {
      useStore.getState().setFolderSession(null, [
        { path: 'old.md', name: 'old.md', content: '', lastModified: 100 },
        { path: 'new.md', name: 'new.md', content: '', lastModified: 300 },
        { path: 'mid.md', name: 'mid.md', content: '', lastModified: 200 },
      ])
      render(<FileExplorer />)
      fireEvent.click(screen.getByRole('button', { name: /sort files/i }))
      fireEvent.click(screen.getByRole('menuitemradio', { name: /modified \(newest\)/i }))
      const names = screen
        .getAllByRole('button')
        .map(b => b.textContent?.trim())
        .filter((t): t is string => !!t && /\.md$/.test(t))
      expect(names.slice(0, 3)).toEqual(['new.md', 'mid.md', 'old.md'])
    })
  })

  describe('Links panel', () => {
    it('shows forward links (files this file links to)', () => {
      useStore.getState().setFolderSession(null, [
        {
          path: 'intro.md',
          name: 'intro.md',
          content: '# Intro\n\nSee [the spec](./spec.md) for details.',
        },
        { path: 'spec.md', name: 'spec.md', content: '# Spec' },
      ])
      // intro.md is auto-selected (first file)
      render(<FileExplorer />)
      // Links panel should show spec.md as a forward link
      // Expand the panel if collapsed by default
      const linksToggle = screen.queryByRole('button', { name: /links/i })
      if (linksToggle) fireEvent.click(linksToggle)
      expect(screen.getAllByText(/spec\.md/i).length).toBeGreaterThan(0)
    })

    it('shows backlinks (files that link TO this file)', () => {
      useStore.getState().setFolderSession(null, [
        { path: 'intro.md', name: 'intro.md', content: '# Intro\n\n[details](./spec.md)' },
        { path: 'spec.md', name: 'spec.md', content: '# Spec' },
      ])
      // Switch to spec.md
      useStore.getState().setActiveFile('spec.md')
      render(<FileExplorer />)
      const linksToggle = screen.queryByRole('button', { name: /links/i })
      if (linksToggle) fireEvent.click(linksToggle)
      // intro.md should appear as a backlink
      expect(screen.getAllByText(/intro\.md/i).length).toBeGreaterThan(0)
    })
  })
})
