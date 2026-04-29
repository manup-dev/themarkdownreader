import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPipeline } from '../src/index'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mdr-int-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('runPipeline', () => {
  it('writes a companion file for each .md+.annot pair and reports the changed paths', async () => {
    await writeFile(join(root, 'doc.md'), '# doc\n\nbody line\n')
    const event = JSON.stringify({
      v: 1, ts: Date.UTC(2026, 3, 30), id: 'c1', op: 'comment.add',
      docKey: 'd', anchor: { line: 2, text: 'body line' },
      selectedText: 'body line', body: 'note', author: 'manu', sectionId: 's',
    }) + '\n'
    await writeFile(join(root, '.doc.md.annot'), event)

    const result = await runPipeline({ workspace: root, suffix: '.comments.md' })

    expect(result.changed).toContain(join(root, 'doc.md.comments.md'))
    expect(result.processed).toBe(1)
    expect(result.skipped).toBe(0)
    const out = await readFile(join(root, 'doc.md.comments.md'), 'utf8')
    expect(out).toContain('# Comments on `doc.md`')
    expect(out).toContain('Line 3')
    expect(out).toContain('note')
  })

  it('removes a stale companion when all comments are deleted', async () => {
    await writeFile(join(root, 'doc.md'), '# doc\n')
    // Sidecar exists but has no comment.add events (only a header)
    await writeFile(join(root, '.doc.md.annot'),
      JSON.stringify({ v: 1, ts: 1, id: 'h', op: 'header', schema: 'mdreader.annot/1', doc: {}, createdAt: 1 }) + '\n')
    await writeFile(join(root, 'doc.md.comments.md'), 'stale stuff\n')

    const result = await runPipeline({ workspace: root, suffix: '.comments.md' })

    expect(result.changed).toContain(join(root, 'doc.md.comments.md'))
    expect(result.skipped).toBe(0)
    await expect(readFile(join(root, 'doc.md.comments.md'), 'utf8')).rejects.toThrow()
  })

  it('returns an empty changed list when nothing differs', async () => {
    const result = await runPipeline({ workspace: root, suffix: '.comments.md' })
    expect(result.changed).toEqual([])
    expect(result.processed).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it('rejects a suffix containing a path separator', async () => {
    await expect(runPipeline({ workspace: root, suffix: '../escape' })).rejects.toThrow(/invalid suffix/)
  })

  it('rejects a suffix containing path traversal', async () => {
    await expect(runPipeline({ workspace: root, suffix: '.foo/../bar.md' })).rejects.toThrow(/invalid suffix/)
  })

  it('isolates a single corrupt sidecar and continues with the rest', async () => {
    const { chmod } = await import('node:fs/promises')
    await writeFile(join(root, 'good.md'), '# good\n\nbody\n')
    await writeFile(join(root, '.good.md.annot'),
      JSON.stringify({ v:1, ts: Date.UTC(2026,3,30), id:'c1', op:'comment.add',
        docKey:'d', anchor:{ line: 2, text:'body' },
        selectedText:'body', body:'note', author:'a', sectionId:'s' }) + '\n')
    await writeFile(join(root, 'bad.md'), '# bad\n')
    // Create a sidecar file that is unreadable — readFile will fail with EACCES.
    await writeFile(join(root, '.bad.md.annot'), '{"v":1}\n')
    await chmod(join(root, '.bad.md.annot'), 0o000)

    const result = await runPipeline({ workspace: root, suffix: '.comments.md' })

    expect(result.processed).toBe(2)
    expect(result.skipped).toBe(1)
    expect(result.changed).toEqual([join(root, 'good.md.comments.md')])
  })
})
