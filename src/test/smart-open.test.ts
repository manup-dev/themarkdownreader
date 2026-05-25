import { describe, it, expect } from 'vitest'
import { decideOpen } from '../lib/smart-open'
import { emptyTab, type Tab } from '../lib/tabs-types'

function folderTab(folderName: string): Tab {
  return { ...emptyTab(), kind: 'folder', folderName, title: folderName }
}

describe('smart-open decideOpen', () => {
  it('focuses an existing tab when the same folder is already open', () => {
    const t = folderTab('My Notes')
    const result = decideOpen([t], t.id, {
      kind: 'folder', folderName: 'My Notes', handle: null, files: [],
    })
    expect(result).toEqual({ action: 'focus', tabId: t.id })
  })

  it('fills the current tab when it is empty', () => {
    const empty = emptyTab()
    const result = decideOpen([empty], empty.id, {
      kind: 'folder', folderName: 'New', handle: null, files: [],
    })
    expect(result).toEqual({ action: 'fill', tabId: empty.id })
  })

  it('opens a new tab when current is non-empty and folder is different', () => {
    const t = folderTab('A')
    const result = decideOpen([t], t.id, {
      kind: 'folder', folderName: 'B', handle: null, files: [],
    })
    expect(result).toEqual({ action: 'new' })
  })

  it('fills the current tab when opening a file into an empty tab', () => {
    const empty = emptyTab()
    const result = decideOpen([empty], empty.id, {
      kind: 'file', fileName: 'note.md', content: '# x',
    })
    expect(result).toEqual({ action: 'fill', tabId: empty.id })
  })

  it('opens a new tab for a file when current tab already has content', () => {
    const t = folderTab('A')
    const result = decideOpen([t], t.id, {
      kind: 'file', fileName: 'note.md', content: '# x',
    })
    expect(result).toEqual({ action: 'new' })
  })

  it('focuses existing folder tab even if a different tab is currently active', () => {
    const a = folderTab('A')
    const b = folderTab('B')
    const result = decideOpen([a, b], b.id, {
      kind: 'folder', folderName: 'A', handle: null, files: [],
    })
    expect(result).toEqual({ action: 'focus', tabId: a.id })
  })
})
