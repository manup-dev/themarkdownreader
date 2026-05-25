import { db, type StoredTabContent } from './docstore'

export async function putTabContent(id: string, name: string, body: string): Promise<void> {
  await db.tabContent.put({ id, name, body, savedAt: Date.now() })
}

export async function getTabContent(id: string): Promise<StoredTabContent | null> {
  return (await db.tabContent.get(id)) ?? null
}

export async function deleteTabContent(id: string): Promise<void> {
  await db.tabContent.delete(id)
}
