import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../lib/docstore'
import { addOrTouchRecent, listRecents, removeRecent, RECENTS_CAP } from '../lib/recents'

describe('recents', () => {
  beforeEach(async () => {
    await db.recents.clear()
  })

  it('adds a folder recent and lists it', async () => {
    await addOrTouchRecent({ kind: 'folder', name: 'A', handleKey: 'h1' })
    const list = await listRecents()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('A')
  })

  it('touches an existing recent by (kind,name) instead of duplicating', async () => {
    await addOrTouchRecent({ kind: 'folder', name: 'A', handleKey: 'h1' })
    await new Promise((r) => setTimeout(r, 5))
    await addOrTouchRecent({ kind: 'folder', name: 'A', handleKey: 'h1' })
    const list = await listRecents()
    expect(list).toHaveLength(1)
  })

  it('lists in lastAccessedAt DESC order', async () => {
    await addOrTouchRecent({ kind: 'folder', name: 'A' })
    await new Promise((r) => setTimeout(r, 5))
    await addOrTouchRecent({ kind: 'folder', name: 'B' })
    const list = await listRecents()
    expect(list.map((r) => r.name)).toEqual(['B', 'A'])
  })

  it('evicts the least-recently-accessed entry beyond RECENTS_CAP', async () => {
    for (let i = 0; i < RECENTS_CAP + 3; i++) {
      await addOrTouchRecent({ kind: 'file', name: `F${i}`, contentKey: `c${i}` })
      await new Promise((r) => setTimeout(r, 1))
    }
    const list = await listRecents()
    expect(list).toHaveLength(RECENTS_CAP)
    expect(list[0].name).toBe(`F${RECENTS_CAP + 2}`)
    expect(list.find((r) => r.name === 'F0')).toBeUndefined()
  })

  it('removes a recent by id', async () => {
    const a = await addOrTouchRecent({ kind: 'folder', name: 'A' })
    await removeRecent(a)
    expect(await listRecents()).toHaveLength(0)
  })
})
