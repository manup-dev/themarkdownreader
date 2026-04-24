import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FileSidecarSink } from '../lib/file-sidecar-sink'
import type { AnnotationEvent } from '../lib/annotation-events'
import { encodeWal } from '../lib/annotation-events'

function makeFakeFileHandle(initialText = '') {
  let text = initialText
  const writes: string[] = []
  const handle = {
    async getFile() {
      return new File([text], 'sidecar.annot', { type: 'application/x-ndjson' })
    },
    async createWritable() {
      return {
        write: vi.fn(async (chunk: string) => { writes.push(chunk); text = chunk }),
        close: vi.fn(async () => {}),
        truncate: vi.fn(async () => { text = '' }),
      }
    },
    _getText: () => text,
    _getWrites: () => writes,
  }
  return handle
}

function hl(id: string, ts: number): AnnotationEvent {
  return {
    v: 1, ts, id, op: 'highlight.add',
    anchor: { markdownStart: 0, markdownEnd: 5, exact: 'hello' },
    color: 'yellow',
    docKey: 'k',
  } as AnnotationEvent
}

describe('FileSidecarSink', () => {
  beforeEach(() => { vi.useFakeTimers() })

  it('load() from empty file yields empty state', async () => {
    const handle = makeFakeFileHandle('')
    const sink = new FileSidecarSink(handle as unknown as FileSystemFileHandle, 'k')
    await sink.load()
    expect(await sink.listEvents('k')).toEqual([])
    expect(await sink.readCheckpoint('k')).toBeNull()
  })

  it('load() parses existing WAL', async () => {
    const events = [hl('a', 1), hl('b', 2)]
    const handle = makeFakeFileHandle(encodeWal(events))
    const sink = new FileSidecarSink(handle as unknown as FileSystemFileHandle, 'k')
    await sink.load()
    const listed = await sink.listEvents('k')
    expect(listed.map((s) => s.event.id)).toEqual(['a', 'b'])
    expect(listed.map((s) => s.seq)).toEqual([0, 1])
  })

  it('append() updates shadow immediately and flushes to disk after debounce', async () => {
    const handle = makeFakeFileHandle('')
    const sink = new FileSidecarSink(handle as unknown as FileSystemFileHandle, 'k')
    await sink.load()
    await sink.append('k', [hl('a', 1)])
    expect((await sink.listEvents('k')).length).toBe(1)
    expect(handle._getWrites().length).toBe(0) // no flush yet
    await vi.advanceTimersByTimeAsync(300)
    expect(handle._getWrites().length).toBe(1)
    expect(handle._getText()).toContain('"id":"a"')
  })

  it('flushNow() bypasses debounce', async () => {
    const handle = makeFakeFileHandle('')
    const sink = new FileSidecarSink(handle as unknown as FileSystemFileHandle, 'k')
    await sink.load()
    await sink.append('k', [hl('a', 1)])
    await sink.flushNow()
    expect(handle._getWrites().length).toBe(1)
  })

  it('writeCheckpoint + truncateBefore removes events below ceiling', async () => {
    const handle = makeFakeFileHandle(encodeWal([hl('a', 1), hl('b', 2), hl('c', 3)]))
    const sink = new FileSidecarSink(handle as unknown as FileSystemFileHandle, 'k')
    await sink.load()
    const cp = { v: 1, ts: 4, id: 'cp1', op: 'checkpoint' as const, priorEvents: 2,
      state: { highlights: [], comments: [], unknown: [] }, clientId: 'test' }
    await sink.writeCheckpoint('k', cp)
    const removed = await sink.truncateBefore('k', 2)
    expect(removed).toBe(2)
    const remaining = await sink.listEvents('k')
    expect(remaining.map((s) => s.event.id)).toEqual(['c'])
  })

  it('compactAtomic is idempotent and writes checkpoint + clears events', async () => {
    const handle = makeFakeFileHandle(encodeWal([hl('a', 1), hl('b', 2)]))
    const sink = new FileSidecarSink(handle as unknown as FileSystemFileHandle, 'k')
    await sink.load()
    const cp = { v: 1, ts: 3, id: 'cp1', op: 'checkpoint' as const, priorEvents: 2,
      state: { highlights: [], comments: [], unknown: [] }, clientId: 'test' }
    const removed = await sink.compactAtomic('k', cp)
    expect(removed).toBe(2)
    expect(await sink.listEvents('k')).toEqual([])
    expect(await sink.readCheckpoint('k')).toEqual(cp)
  })

  it('corrupt WAL is quarantined: load succeeds, file is renamed', async () => {
    const parent = {
      removeEntry: vi.fn(async () => {}),
      getFileHandle: vi.fn(async () => makeFakeFileHandle('') as unknown as FileSystemFileHandle),
      resolve: vi.fn(),
    }
    const handle = makeFakeFileHandle('not valid jsonl{{{')
    const sink = new FileSidecarSink(
      handle as unknown as FileSystemFileHandle,
      'k',
      { parent: parent as unknown as FileSystemDirectoryHandle, basename: '.foo.md.annot' },
    )
    await sink.load() // must not throw
    expect(await sink.listEvents('k')).toEqual([])
    expect(parent.getFileHandle).toHaveBeenCalledWith(
      expect.stringMatching(/^\.foo\.md\.annot\.broken-\d+$/),
      { create: true },
    )
    expect(parent.removeEntry).toHaveBeenCalledWith('.foo.md.annot')
  })
})
