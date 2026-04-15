import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CollectionView } from '../components/CollectionView'
import { useStore } from '../store/useStore'

describe('<CollectionView>', () => {
  beforeEach(() => {
    class MockIO {
      cb: (entries: IntersectionObserverEntry[]) => void
      constructor(cb: (entries: IntersectionObserverEntry[]) => void) { this.cb = cb }
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
      markdown: '',
      fileName: null,
      viewMode: 'collection',
    })
  })

  it('shows empty state when no folder loaded', () => {
    render(<CollectionView />)
    expect(screen.getByText(/no folder open/i)).toBeInTheDocument()
  })

  it('shows file count and file list when folder loaded', () => {
    useStore.getState().setFolderSession(null, [
      { path: 'a.md', name: 'a.md', content: '# A\n\nSome content.' },
      { path: 'b.md', name: 'b.md', content: '# B\n\nMore content here.' },
    ])
    render(<CollectionView />)
    expect(screen.getByText(/2.*file/i)).toBeInTheDocument()
    expect(screen.getByText('a.md')).toBeInTheDocument()
    expect(screen.getByText('b.md')).toBeInTheDocument()
  })

  it('renders a View all as one button', () => {
    useStore.getState().setFolderSession(null, [
      { path: 'a.md', name: 'a.md', content: '# A' },
      { path: 'b.md', name: 'b.md', content: '# B' },
    ])
    render(<CollectionView />)
    expect(screen.getByRole('button', { name: /view all as one|merge|view merged/i })).toBeInTheDocument()
  })

  it('clicking View all as one swaps markdown to a concatenated synthetic doc and switches to Read', () => {
    useStore.getState().setFolderSession(null, [
      { path: 'a.md', name: 'a.md', content: '# Alpha\n\nFirst.' },
      { path: 'b.md', name: 'b.md', content: '# Beta\n\nSecond.' },
    ])
    render(<CollectionView />)
    fireEvent.click(screen.getByRole('button', { name: /view all as one|merge|view merged/i }))
    const s = useStore.getState()
    expect(s.markdown).toMatch(/Alpha/)
    expect(s.markdown).toMatch(/Beta/)
    expect(s.markdown).toMatch(/First/)
    expect(s.markdown).toMatch(/Second/)
    expect(s.fileName).toMatch(/merged|all|collection/i)
    expect(s.viewMode).toBe('read')
  })

  it('clicking a file in the per-file list sets it active and switches to Read', () => {
    useStore.getState().setFolderSession(null, [
      { path: 'a.md', name: 'a.md', content: '# A' },
      { path: 'b.md', name: 'b.md', content: '# B' },
    ])
    render(<CollectionView />)
    fireEvent.click(screen.getByText('b.md'))
    const s = useStore.getState()
    expect(s.activeFilePath).toBe('b.md')
    expect(s.markdown).toBe('# B')
    expect(s.viewMode).toBe('read')
  })
})
