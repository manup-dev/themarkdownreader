import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store/useStore'

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
