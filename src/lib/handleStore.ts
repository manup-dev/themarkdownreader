const DB_NAME = 'md-reader-handles'
const STORE = 'handles'
const VERSION = 1

let cached: IDBDatabase | null = null
let opening: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (cached) return Promise.resolve(cached)
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
      req.onsuccess = () => { cached = req.result; resolve(req.result) }
      req.onerror = () => reject(req.error)
    })
  }
  return opening
}

export async function putHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(handle, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await open()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null)
    req.onerror = () => resolve(null)
  })
}

export async function deleteHandle(key: string): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
