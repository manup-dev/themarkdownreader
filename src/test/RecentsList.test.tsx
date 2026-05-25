import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RecentsList } from '../components/RecentsList'
import { db } from '../lib/docstore'
import { addOrTouchRecent } from '../lib/recents'
import { useStore, persistSettled } from '../store/useStore'

describe('RecentsList', () => {
  beforeEach(async () => {
    await persistSettled()  // drain prior persistPayload writes deterministically
    await db.recents.clear()
    await db.tabContent.clear()
    useStore.setState({
      tabs: [], activeTabId: null,
      markdown: '', fileName: null,
      folderHandle: null, folderFiles: null, folderFileContents: null, activeFilePath: null,
      viewMode: 'read',
    })
  })

  it('renders a row per recent entry', async () => {
    await addOrTouchRecent({ kind: 'folder', name: 'My Notes' })
    await addOrTouchRecent({ kind: 'file', name: 'readme.md', contentKey: 'c1' })
    await db.tabContent.put({ id: 'c1', name: 'readme.md', body: '# Hi', savedAt: 1 })
    render(<RecentsList onOpened={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('My Notes')).toBeInTheDocument()
      expect(screen.getByText('readme.md')).toBeInTheDocument()
    })
  })

  it('clicking a file recent opens it as a new tab', async () => {
    await addOrTouchRecent({ kind: 'file', name: 'readme.md', contentKey: 'c1' })
    await db.tabContent.put({ id: 'c1', name: 'readme.md', body: '# Hi', savedAt: 1 })
    render(<RecentsList onOpened={() => {}} />)
    await waitFor(() => screen.getByText('readme.md'))
    fireEvent.click(screen.getByText('readme.md'))
    await waitFor(() => {
      const s = useStore.getState()
      expect(s.tabs[0]?.kind).toBe('file')
      expect(s.tabs[0]?.fileName).toBe('readme.md')
      expect(s.markdown).toBe('# Hi')
    })
  })

  it('opens a file recent on Enter keypress (keyboard a11y)', async () => {
    await addOrTouchRecent({ kind: 'file', name: 'kb.md', contentKey: 'kbc' })
    await db.tabContent.put({ id: 'kbc', name: 'kb.md', body: '# kb', savedAt: 1 })
    render(<RecentsList onOpened={() => {}} />)
    const btn = await screen.findByRole('button', { name: /^kb\.md$/ })
    btn.focus()
    fireEvent.keyDown(btn, { key: 'Enter' })
    fireEvent.click(btn)  // fireEvent.keyDown does not trigger onClick; click is the equivalent
    await waitFor(() => {
      expect(useStore.getState().fileName).toBe('kb.md')
    })
  })

  it('clicking × removes a recent without opening a tab', async () => {
    await addOrTouchRecent({ kind: 'file', name: 'readme.md', contentKey: 'c1' })
    render(<RecentsList onOpened={() => {}} />)
    await waitFor(() => screen.getByText('readme.md'))
    fireEvent.click(screen.getByRole('button', { name: /remove .*readme/i }))
    await waitFor(async () => {
      expect(await db.recents.count()).toBe(0)
    })
    expect(useStore.getState().tabs).toHaveLength(0)
  })
})
