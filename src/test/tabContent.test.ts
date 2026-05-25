import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../lib/docstore'
import { putTabContent, getTabContent, deleteTabContent } from '../lib/tabContent'

describe('tabContent', () => {
  beforeEach(async () => {
    await db.tabContent.clear()
  })

  it('puts and gets a body by id', async () => {
    await putTabContent('t1', 'README.md', '# Hello')
    const row = await getTabContent('t1')
    expect(row?.body).toBe('# Hello')
    expect(row?.name).toBe('README.md')
  })

  it('overwrites on subsequent put of the same id', async () => {
    await putTabContent('t1', 'README.md', '# v1')
    await putTabContent('t1', 'README.md', '# v2')
    const row = await getTabContent('t1')
    expect(row?.body).toBe('# v2')
  })

  it('returns null for unknown id', async () => {
    expect(await getTabContent('missing')).toBeNull()
  })

  it('deletes by id', async () => {
    await putTabContent('t1', 'a.md', 'x')
    await deleteTabContent('t1')
    expect(await getTabContent('t1')).toBeNull()
  })
})
