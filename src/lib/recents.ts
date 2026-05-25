import { db, type StoredRecent } from './docstore'
import { deleteTabContent } from './tabContent'

export const RECENTS_CAP = 20

export async function addOrTouchRecent(
  entry: { kind: 'folder' | 'file'; name: string; handleKey?: string; contentKey?: string },
): Promise<number> {
  const now = Date.now()
  const id = await db.transaction('rw', db.recents, async () => {
    const existing = await db.recents.where({ kind: entry.kind, name: entry.name }).first()
    if (existing && existing.id !== undefined) {
      await db.recents.update(existing.id, {
        lastAccessedAt: now,
        handleKey: entry.handleKey ?? existing.handleKey,
        contentKey: entry.contentKey ?? existing.contentKey,
      })
      return existing.id
    }
    const newId = await db.recents.add({
      kind: entry.kind,
      name: entry.name,
      handleKey: entry.handleKey,
      contentKey: entry.contentKey,
      addedAt: now,
      lastAccessedAt: now,
    })
    return newId as number
  })
  await enforceCap()
  return id
}

export async function listRecents(): Promise<StoredRecent[]> {
  const all = await db.recents.orderBy('lastAccessedAt').reverse().toArray()
  return all
}

export async function removeRecent(id: number): Promise<void> {
  const row = await db.recents.get(id)
  await db.recents.delete(id)
  if (row?.contentKey) {
    await deleteTabContent(row.contentKey)
  }
}

async function enforceCap(): Promise<void> {
  const count = await db.recents.count()
  if (count <= RECENTS_CAP) return
  const toDrop = await db.recents.orderBy('lastAccessedAt').limit(count - RECENTS_CAP).toArray()
  // Collect contentKeys so we can clean up tabContent rows too — the orphan
  // would otherwise persist forever (closeTab no longer reaps it).
  const keysToDelete = toDrop.map((r) => r.id!).filter((x) => x !== undefined)
  const contentKeysToDelete = toDrop.map((r) => r.contentKey).filter((k): k is string => !!k)
  await db.recents.bulkDelete(keysToDelete)
  for (const k of contentKeysToDelete) await deleteTabContent(k)
}
