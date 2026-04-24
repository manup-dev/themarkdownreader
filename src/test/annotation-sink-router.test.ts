import { describe, it, expect, beforeEach } from 'vitest'
import { AnnotationSinkRouter } from '../lib/annotation-sink-router'
import { InMemorySink } from '../lib/annotation-log'
import type { AnnotationEvent } from '../lib/annotation-events'
import * as mode from '../lib/annotation-storage-mode'

function ev(id: string, ts: number): AnnotationEvent {
  return { v: 1, ts, id, op: 'highlight.add', docKey: 'k',
    anchor: { markdownStart: 0, markdownEnd: 5, exact: 'hello' }, color: 'yellow' } as AnnotationEvent
}

describe('AnnotationSinkRouter', () => {
  let dbSink: InMemorySink
  let fileFactoryCalls: number
  let fileSinks: Map<string, InMemorySink>

  beforeEach(() => {
    localStorage.clear()
    dbSink = new InMemorySink()
    fileFactoryCalls = 0
    fileSinks = new Map()
  })

  function router() {
    return new AnnotationSinkRouter({
      dbSink,
      fileSinkFactory: async (docKey: string) => {
        fileFactoryCalls++
        const existing = fileSinks.get(docKey)
        if (existing) return existing
        const s = new InMemorySink()
        fileSinks.set(docKey, s)
        return s
      },
    })
  }

  it('db mode: returns dbSink, fellBack=false', async () => {
    mode.setAnnotationStorageMode('db')
    const res = await router().resolveSinkForDoc({ docKey: 'x', folderHandleAvailable: true })
    expect(res.effectiveMode).toBe('db')
    expect(res.fellBack).toBe(false)
    expect(res.sink).toBe(dbSink)
  })

  it('file mode without folder handle: falls back to dbSink', async () => {
    mode.setAnnotationStorageMode('file')
    const res = await router().resolveSinkForDoc({ docKey: 'x', folderHandleAvailable: false })
    expect(res.effectiveMode).toBe('db')
    expect(res.fellBack).toBe(true)
    expect(res.sink).toBe(dbSink)
  })

  it('file mode with folder handle: returns file sink', async () => {
    mode.setAnnotationStorageMode('file')
    const res = await router().resolveSinkForDoc({ docKey: 'x', folderHandleAvailable: true })
    expect(res.effectiveMode).toBe('file')
    expect(res.fellBack).toBe(false)
    expect(res.sink).toBe(fileSinks.get('x'))
  })

  it('lazy migration: file mode, empty file + existing db events → copies to file', async () => {
    mode.setAnnotationStorageMode('file')
    await dbSink.append('x', [ev('a', 1), ev('b', 2)])
    const r = router()
    const res = await r.resolveSinkForDoc({ docKey: 'x', folderHandleAvailable: true })
    const copied = await (res.sink as InMemorySink).listEvents('x')
    expect(copied.map((s) => s.event.id)).toEqual(['a', 'b'])
    const dbStill = await dbSink.listEvents('x')
    expect(dbStill.length).toBe(2) // non-destructive
  })

  it('lazy migration: copies the source checkpoint to the target', async () => {
    mode.setAnnotationStorageMode('file')
    const checkpoint = {
      v: 1, ts: 10, id: 'cp1', op: 'checkpoint' as const, priorEvents: 0,
      state: { highlights: [], comments: [], unknown: [] },
      clientId: 'test',
    }
    await dbSink.append('x', [ev('a', 1)])
    await dbSink.writeCheckpoint('x', checkpoint)
    const r = router()
    const res = await r.resolveSinkForDoc({ docKey: 'x', folderHandleAvailable: true })
    const copiedCp = await res.sink.readCheckpoint('x')
    expect(copiedCp).toEqual(checkpoint)
  })

  it('lazy migration: db mode, empty db + existing file events → copies to db', async () => {
    mode.setAnnotationStorageMode('db')
    const fileSink = new InMemorySink()
    fileSinks.set('x', fileSink)
    await fileSink.append('x', [ev('a', 1)])
    const r = new AnnotationSinkRouter({
      dbSink,
      fileSinkFactory: async () => fileSink,
    })
    const res = await r.resolveSinkForDoc({ docKey: 'x', folderHandleAvailable: true })
    const copied = await dbSink.listEvents('x')
    expect(copied.map((s) => s.event.id)).toEqual(['a'])
    // Unchanged on subsequent open (idempotent)
    await r.resolveSinkForDoc({ docKey: 'x', folderHandleAvailable: true })
    expect((await dbSink.listEvents('x')).length).toBe(1)
    expect(res.effectiveMode).toBe('db')
  })

  it('no migration when both sinks have events (target wins)', async () => {
    mode.setAnnotationStorageMode('file')
    await dbSink.append('x', [ev('d', 1)])
    const fileSink = new InMemorySink()
    fileSinks.set('x', fileSink)
    await fileSink.append('x', [ev('f', 1)])
    const res = await router().resolveSinkForDoc({ docKey: 'x', folderHandleAvailable: true })
    const listed = await (res.sink as InMemorySink).listEvents('x')
    expect(listed.map((s) => s.event.id)).toEqual(['f'])
  })

  it('caches file sink per-docKey', async () => {
    mode.setAnnotationStorageMode('file')
    const r = router()
    await r.resolveSinkForDoc({ docKey: 'x', folderHandleAvailable: true })
    await r.resolveSinkForDoc({ docKey: 'x', folderHandleAvailable: true })
    expect(fileFactoryCalls).toBe(1)
  })

  it('does not stamp migrationsAttempted when source is unavailable (folder handle ungranted)', async () => {
    mode.setAnnotationStorageMode('db')
    const fileSink = new InMemorySink()
    fileSinks.set('x', fileSink)
    await fileSink.append('x', [ev('a', 1)])
    const r = new AnnotationSinkRouter({
      dbSink,
      fileSinkFactory: async () => fileSink,
    })
    // First resolve: no folder handle → nothing to migrate, don't stamp.
    await r.resolveSinkForDoc({ docKey: 'x', folderHandleAvailable: false })
    expect((await dbSink.listEvents('x')).length).toBe(0)
    // Second resolve: folder handle now available → migration proceeds.
    await r.resolveSinkForDoc({ docKey: 'x', folderHandleAvailable: true })
    expect((await dbSink.listEvents('x')).length).toBe(1)
  })

  it('un-stamps and rethrows when migration target.append fails', async () => {
    mode.setAnnotationStorageMode('file')
    await dbSink.append('x', [ev('a', 1)])
    let attempts = 0
    const failingFileSink: import('../lib/annotation-log').AnnotationSink = {
      async append() { attempts++; throw new Error('disk full') },
      async listEvents() { return [] },
      async readCheckpoint() { return null },
      async writeCheckpoint() {},
      async truncateBefore() { return 0 },
    }
    const r = new AnnotationSinkRouter({
      dbSink,
      fileSinkFactory: async () => failingFileSink,
    })
    await expect(r.resolveSinkForDoc({ docKey: 'x', folderHandleAvailable: true }))
      .rejects.toThrow('disk full')
    // Second call should retry (not stamped).
    await expect(r.resolveSinkForDoc({ docKey: 'x', folderHandleAvailable: true }))
      .rejects.toThrow('disk full')
    expect(attempts).toBe(2)
  })
})
