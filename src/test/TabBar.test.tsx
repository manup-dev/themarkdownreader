import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TabBar } from '../components/TabBar'
import { useStore } from '../store/useStore'

describe('TabBar', () => {
  beforeEach(() => {
    useStore.setState({
      tabs: [], activeTabId: null,
      markdown: '', fileName: null,
      folderHandle: null, folderFiles: null, folderFileContents: null, activeFilePath: null,
      viewMode: 'read',
    })
  })

  it('renders nothing when there are no tabs (empty initial state)', () => {
    const { container } = render(<TabBar />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a tab for each entry in store.tabs', () => {
    useStore.getState().openInNewTab({
      kind: 'folder', folderName: 'My Notes', handle: null,
      files: [{ path: 'a.md', name: 'a.md', content: '#' }],
    })
    useStore.getState().openInNewTab({
      kind: 'file', fileName: 'readme.md', content: '#',
    })
    render(<TabBar />)
    expect(screen.getByRole('tab', { name: /My Notes/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /readme\.md/ })).toBeInTheDocument()
  })

  it('clicking a tab makes it active', () => {
    useStore.getState().openInNewTab({
      kind: 'folder', folderName: 'A', handle: null,
      files: [{ path: 'x.md', name: 'x.md', content: '#' }],
    })
    const aId = useStore.getState().activeTabId!
    useStore.getState().openInNewTab({
      kind: 'folder', folderName: 'B', handle: null,
      files: [{ path: 'y.md', name: 'y.md', content: '#' }],
    })
    render(<TabBar />)
    fireEvent.click(screen.getByRole('tab', { name: /A/ }))
    expect(useStore.getState().activeTabId).toBe(aId)
  })

  it('clicking the × button closes the tab', () => {
    useStore.getState().openInNewTab({
      kind: 'file', fileName: 'x.md', content: '#',
    })
    render(<TabBar />)
    const closeBtn = screen.getByRole('button', { name: /close .*x\.md/i })
    fireEvent.click(closeBtn)
    // Closing the only tab synthesizes a fresh empty tab
    expect(useStore.getState().tabs).toHaveLength(1)
    expect(useStore.getState().tabs[0].kind).toBe('empty')
  })
})
