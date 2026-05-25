import { db, type StoredRecent } from './docstore'

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
  await db.recents.delete(id)
}

async function enforceCap(): Promise<void> {
  const count = await db.recents.count()
  if (count <= RECENTS_CAP) return
  const toDrop = await db.recents.orderBy('lastAccessedAt').limit(count - RECENTS_CAP).toArray()
  await db.recents.bulkDelete(toDrop.map((r) => r.id!).filter((x) => x !== undefined))
}
