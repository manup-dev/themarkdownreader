import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeOutputsIfChanged } from '../src/apply'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mdr-apply-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('writeOutputsIfChanged', () => {
  it('creates a missing companion file', async () => {
    const changed = await writeOutputsIfChanged([
      { path: join(root, 'foo.md.comments.md'), content: 'hello\n' },
    ])
    expect(changed).toEqual([join(root, 'foo.md.comments.md')])
    expect(await readFile(join(root, 'foo.md.comments.md'), 'utf8')).toBe('hello\n')
  })

  it('skips writing when content is identical', async () => {
    const path = join(root, 'foo.md.comments.md')
    await writeFile(path, 'same\n')
    const changed = await writeOutputsIfChanged([{ path, content: 'same\n' }])
    expect(changed).toEqual([])
  })

  it('overwrites when content differs', async () => {
    const path = join(root, 'foo.md.comments.md')
    await writeFile(path, 'old\n')
    const changed = await writeOutputsIfChanged([{ path, content: 'new\n' }])
    expect(changed).toEqual([path])
    expect(await readFile(path, 'utf8')).toBe('new\n')
  })

  it('deletes existing file when content is empty string', async () => {
    const path = join(root, 'foo.md.comments.md')
    await writeFile(path, 'stale\n')
    const changed = await writeOutputsIfChanged([{ path, content: '' }])
    expect(changed).toEqual([path])
    await expect(readFile(path, 'utf8')).rejects.toThrow()
  })

  it('is a no-op when target is already absent and content is empty', async () => {
    const changed = await writeOutputsIfChanged([
      { path: join(root, 'never-existed.md.comments.md'), content: '' },
    ])
    expect(changed).toEqual([])
  })
})
