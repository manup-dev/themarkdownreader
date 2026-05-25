import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store/useStore'
import { db } from '../lib/docstore'

describe('useStore — tabs basics', () => {
  beforeEach(() => {
    useStore.setState({
      tabs: [],
      activeTabId: null,
      markdown: '',
      fileName: null,
      folderHandle: null,
      folderFiles: null,
      folderFileContents: null,
      activeFilePath: null,
      viewMode: 'read',
    })
  })

  it('initializes with an empty tabs array (synthesized on first use)', () => {
    const { tabs, activeTabId } = useStore.getState()
    expect(Array.isArray(tabs)).toBe(true)
    expect(tabs.length).toBe(0)
    expect(activeTabId).toBeNull()
  })

  it('creates an empty tab via newEmptyTab', () => {
    const id = useStore.getState().newEmptyTab()
    const { tabs, activeTabId } = useStore.getState()
    expect(tabs).toHaveLength(1)
    expect(tabs[0].kind).toBe('empty')
    expect(activeTabId).toBe(id)
  })

  it('closes a tab and activates the adjacent one', () => {
    const a = useStore.getState().newEmptyTab()
    const b = useStore.getState().newEmptyTab()
    const c = useStore.getState().newEmptyTab()
    // active = c (last opened). Close b → active should remain c.
    useStore.getState().closeTab(b)
    expect(useStore.getState().tabs.map((t) => t.id)).toEqual([a, c])
    expect(useStore.getState().activeTabId).toBe(c)
    // Close active (c) → fall back to a (left neighbor, since no right).
    useStore.getState().closeTab(c)
    expect(useStore.getState().activeTabId).toBe(a)
  })

  it('synthesizes a fresh empty tab when the last tab is closed', () => {
    const a = useStore.getState().newEmptyTab()
    useStore.getState().closeTab(a)
    const { tabs, activeTabId } = useStore.getState()
    expect(tabs).toHaveLength(1)
    expect(tabs[0].kind).toBe('empty')
    expect(activeTabId).toBe(tabs[0].id)
  })
})

describe('useStore — tabs snapshot/restore', () => {
  beforeEach(() => {
    useStore.setState({
      tabs: [],
      activeTabId: null,
      markdown: '',
      fileName: null,
      folderHandle: null,
      folderFiles: null,
      folderFileContents: null,
      activeFilePath: null,
      viewMode: 'read',
    })
  })

  it('opens a folder payload into a fresh tab and populates singulars', () => {
    useStore.getState().openInNewTab({
      kind: 'folder',
      folderName: 'My Notes',
      handle: null,
      files: [
        { path: 'a.md', name: 'a.md', content: '# A' },
        { path: 'b.md', name: 'b.md', content: '# B' },
      ],
    })
    const s = useStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0].kind).toBe('folder')
    expect(s.tabs[0].folderName).toBe('My Notes')
    expect(s.markdown).toBe('# A')
    expect(s.fileName).toBe('a.md')
    expect(s.activeFilePath).toBe('a.md')
  })

  it('opens a file payload into a fresh tab and populates singulars', () => {
    useStore.getState().openInNewTab({
      kind: 'file', fileName: 'note.md', content: '# Note',
    })
    const s = useStore.getState()
    expect(s.tabs[0].kind).toBe('file')
    expect(s.markdown).toBe('# Note')
    expect(s.fileName).toBe('note.md')
  })

  it('preserves per-tab activeFilePath across switchTab', () => {
    useStore.getState().openInNewTab({
      kind: 'folder', folderName: 'A', handle: null,
      files: [
        { path: 'a1.md', name: 'a1.md', content: '# A1' },
        { path: 'a2.md', name: 'a2.md', content: '# A2' },
      ],
    })
    const tabA = useStore.getState().activeTabId!
    // Switch within tab A to a2.md
    useStore.getState().setActiveFile('a2.md')
    // Open a second folder tab
    useStore.getState().openInNewTab({
      kind: 'folder', folderName: 'B', handle: null,
      files: [{ path: 'b1.md', name: 'b1.md', content: '# B1' }],
    })
    // Switch back to A
    useStore.getState().switchTab(tabA)
    const s = useStore.getState()
    expect(s.activeFilePath).toBe('a2.md')
    expect(s.markdown).toBe('# A2')
    expect(s.fileName).toBe('a2.md')
  })

  it('preserves per-tab viewMode across switchTab', () => {
    useStore.getState().openInNewTab({
      kind: 'file', fileName: 'a.md', content: '# A',
    })
    const tabA = useStore.getState().activeTabId!
    useStore.getState().setViewMode('mindmap')
    useStore.getState().openInNewTab({
      kind: 'file', fileName: 'b.md', content: '# B',
    })
    useStore.getState().setViewMode('treemap')
    useStore.getState().switchTab(tabA)
    expect(useStore.getState().viewMode).toBe('mindmap')
  })
})

describe('useStore — smart open routing', () => {
  beforeEach(() => {
    useStore.setState({
      tabs: [], activeTabId: null,
      markdown: '', fileName: null,
      folderHandle: null, folderFiles: null, folderFileContents: null, activeFilePath: null,
      viewMode: 'read',
    })
  })

  it('focuses an existing folder tab if the same folder is opened again', () => {
    useStore.getState().openInNewTab({
      kind: 'folder', folderName: 'X', handle: null,
      files: [{ path: 'a.md', name: 'a.md', content: '#' }],
    })
    const firstId = useStore.getState().activeTabId
    // Use openSmart to re-open the same folder
    useStore.getState().openSmart({
      kind: 'folder', folderName: 'X', handle: null,
      files: [{ path: 'a.md', name: 'a.md', content: '#' }],
    })
    expect(useStore.getState().activeTabId).toBe(firstId)
    expect(useStore.getState().tabs.filter((t) => t.folderName === 'X')).toHaveLength(1)
  })

  it('fills the current tab when it is empty', () => {
    const id = useStore.getState().newEmptyTab()
    useStore.getState().openSmart({
      kind: 'file', fileName: 'x.md', content: '#',
    })
    const s = useStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.activeTabId).toBe(id)
    expect(s.tabs[0].kind).toBe('file')
  })

  it('opens a new tab when current is non-empty and target differs', () => {
    useStore.getState().openInNewTab({ kind: 'file', fileName: 'a.md', content: '#' })
    useStore.getState().openSmart({ kind: 'file', fileName: 'b.md', content: '#' })
    expect(useStore.getState().tabs).toHaveLength(2)
    expect(useStore.getState().fileName).toBe('b.md')
  })
})

describe('useStore — legacy actions route through tabs', () => {
  beforeEach(() => {
    useStore.setState({
      tabs: [], activeTabId: null,
      markdown: '', fileName: null,
      folderHandle: null, folderFiles: null, folderFileContents: null, activeFilePath: null,
      viewMode: 'read',
    })
  })

  it('setFolderSession creates a folder tab', () => {
    useStore.getState().setFolderSession(null, [
      { path: 'a.md', name: 'a.md', content: '# A' },
    ])
    const s = useStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0].kind).toBe('folder')
    expect(s.markdown).toBe('# A')
  })

  it('setMarkdown creates a file tab', () => {
    useStore.getState().setMarkdown('# Hi', 'hi.md')
    const s = useStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0].kind).toBe('file')
    expect(s.tabs[0].fileName).toBe('hi.md')
  })

  it('setMarkdown without a fileName does not create a tab (chat/preview use)', () => {
    // Some call sites pass empty markdown or transient updates — those should not spawn tabs.
    useStore.getState().setMarkdown('', undefined)
    expect(useStore.getState().tabs).toHaveLength(0)
  })
})

describe('useStore — tabs persistence + legacy hydration', () => {
  beforeEach(() => {
    useStore.setState({
      tabs: [], activeTabId: null,
      markdown: '', fileName: null,
      folderHandle: null, folderFiles: null, folderFileContents: null, activeFilePath: null,
      viewMode: 'read',
    })
  })

  it('partialize includes tabs and activeTabId', () => {
    // Inspect the persist middleware's options via Zustand's persist API
    const persistApi = (useStore as unknown as { persist?: { getOptions: () => { partialize: (s: unknown) => Record<string, unknown> } } }).persist
    expect(persistApi).toBeDefined()
    const persisted = persistApi!.getOptions().partialize(useStore.getState())
    expect(persisted).toHaveProperty('tabs')
    expect(persisted).toHaveProperty('activeTabId')
  })
})

describe('useStore — recents persistence on open', () => {
  beforeEach(async () => {
    // Drain any fire-and-forget persistPayload writes from prior describes
    // that may still be inflight, then clear.
    await new Promise((r) => setTimeout(r, 20))
    await db.recents.clear()
    await db.tabContent.clear()
    useStore.setState({
      tabs: [], activeTabId: null,
      markdown: '', fileName: null,
      folderHandle: null, folderFiles: null, folderFileContents: null, activeFilePath: null,
      viewMode: 'read',
    })
  })

  it('records a folder in recents when openSmart is called with a folder payload', async () => {
    useStore.getState().openSmart({
      kind: 'folder', folderName: 'My Notes', handle: null,
      files: [{ path: 'a.md', name: 'a.md', content: '#' }],
    })
    // recents is written asynchronously; await microtask
    await new Promise((r) => setTimeout(r, 10))
    const all = await db.recents.toArray()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('My Notes')
    expect(all[0].kind).toBe('folder')
  })

  it('records a file in recents and persists its body to tabContent', async () => {
    useStore.getState().openSmart({
      kind: 'file', fileName: 'note.md', content: '# Hi',
    })
    await new Promise((r) => setTimeout(r, 10))
    const recents = await db.recents.toArray()
    expect(recents).toHaveLength(1)
    expect(recents[0].name).toBe('note.md')
    const contentKey = recents[0].contentKey!
    expect(contentKey).toBeTruthy()
    const body = await db.tabContent.get(contentKey)
    expect(body?.body).toBe('# Hi')
  })

  it('touches an existing folder recent on re-open instead of duplicating', async () => {
    useStore.getState().openSmart({
      kind: 'folder', folderName: 'A', handle: null,
      files: [{ path: 'a.md', name: 'a.md', content: '#' }],
    })
    await new Promise((r) => setTimeout(r, 10))
    // Close it
    useStore.getState().closeTab(useStore.getState().activeTabId!)
    // Re-open
    useStore.getState().openSmart({
      kind: 'folder', folderName: 'A', handle: null,
      files: [{ path: 'a.md', name: 'a.md', content: '#' }],
    })
    await new Promise((r) => setTimeout(r, 10))
    const all = await db.recents.toArray()
    expect(all).toHaveLength(1)
  })
})
