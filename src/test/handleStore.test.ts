import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { putHandle, getHandle, deleteHandle } from '../lib/handleStore'

describe('handleStore', () => {
  it('round-trips a value under a key', async () => {
    // Real FileSystemDirectoryHandle is not constructible in test env;
    // we store a plain structured-cloneable object as a proxy. The
    // store does not introspect the value, so this is sufficient.
    const fake = { name: 'folder-x', kind: 'directory' as const }
    await putHandle('k1', fake as unknown as FileSystemDirectoryHandle)
    const got = await getHandle('k1')
    expect(got).toEqual(fake)
  })

  it('returns null for an unknown key', async () => {
    const got = await getHandle('does-not-exist')
    expect(got).toBeNull()
  })

  it('deletes a handle', async () => {
    const fake = { name: 'folder-y', kind: 'directory' as const }
    await putHandle('k2', fake as unknown as FileSystemDirectoryHandle)
    await deleteHandle('k2')
    expect(await getHandle('k2')).toBeNull()
  })
})
