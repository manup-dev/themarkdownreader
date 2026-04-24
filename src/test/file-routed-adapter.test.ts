import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { FileRoutedAdapter } from '../adapters/file-routed-adapter'
import { DexieAdapter } from '../adapters/dexie-adapter'
import { InMemorySink } from '../lib/annotation-log'
import { AnnotationSinkRouter } from '../lib/annotation-sink-router'
import { setAnnotationStorageMode } from '../lib/annotation-storage-mode'
import { db } from '../lib/docstore'

describe('FileRoutedAdapter', () => {
  let base: DexieAdapter
  let router: AnnotationSinkRouter
  let fileSink: InMemorySink
  let docId: number

  beforeEach(async () => {
    // Clear all tables — deleting the DB doesn't work since docstore holds
    // a live connection to the same singleton instance.
    await db.highlights.clear()
    await db.comments.clear()
    await db.annotationLog.clear()
    await db.annotationCheckpoint.clear()
    await db.documents.clear()
    await db.chunks.clear()
    localStorage.clear()
    base = new DexieAdapter()
    fileSink = new InMemorySink()
    router = new AnnotationSinkRouter({
      dbSink: new InMemorySink(),
      fileSinkFactory: async () => fileSink,
    })
    const res = await base.addDocument('foo.md', '# Hello world\n\nsome body.')
    docId = res.docId
  })

  function makeAdapter(folderHandleAvailable: boolean) {
    return new FileRoutedAdapter({
      base,
      router,
      docContextProvider: () => ({
        docKey: 'foo-key',
        docId,
        folderHandleAvailable,
      }),
    })
  }

  it('db mode: addHighlight delegates to base and does not write to file sink', async () => {
    setAnnotationStorageMode('db')
    const a = makeAdapter(true)
    await a.addHighlight({ docId, text: 'Hello', startOffset: 0, endOffset: 5,
      color: 'yellow', note: '', createdAt: Date.now() })
    const baseRows = await base.getHighlights(docId)
    expect(baseRows.length).toBe(1)
    expect((await fileSink.listEvents('foo-key')).length).toBe(0)
  })

  it('file mode: addHighlight writes legacy row AND sink event', async () => {
    setAnnotationStorageMode('file')
    const a = makeAdapter(true)
    await a.addHighlight({ docId, text: 'Hello', startOffset: 0, endOffset: 5,
      color: 'yellow', note: '', createdAt: Date.now() })
    expect((await base.getHighlights(docId)).length).toBe(1)
    const ev = await fileSink.listEvents('foo-key')
    expect(ev.length).toBe(1)
    expect(ev[0].event.op).toBe('highlight.add')
  })

  it('file mode + no folder handle: silent fallback to db-only write', async () => {
    setAnnotationStorageMode('file')
    const a = makeAdapter(false)
    await a.addHighlight({ docId, text: 'Hello', startOffset: 0, endOffset: 5,
      color: 'yellow', note: '', createdAt: Date.now() })
    expect((await base.getHighlights(docId)).length).toBe(1)
    expect((await fileSink.listEvents('foo-key')).length).toBe(0)
  })

  it('removeHighlight emits highlight.del event in file mode', async () => {
    setAnnotationStorageMode('file')
    const a = makeAdapter(true)
    const id = await a.addHighlight({ docId, text: 'Hi', startOffset: 0, endOffset: 2,
      color: 'yellow', note: '', createdAt: 1 })
    await a.removeHighlight(id)
    const ops = (await fileSink.listEvents('foo-key')).map((s) => s.event.op)
    expect(ops).toEqual(['highlight.add', 'highlight.del'])
  })

  it('comment lifecycle emits add/edit/resolve/del in file mode', async () => {
    setAnnotationStorageMode('file')
    const a = makeAdapter(true)
    const id = await a.addComment({ docId, selectedText: 's', comment: 'c',
      author: 'u', sectionId: 'h1', createdAt: 1, resolved: false })
    await a.updateComment(id, { comment: 'c2' })
    await a.updateComment(id, { resolved: true })
    await a.removeComment(id)
    const ops = (await fileSink.listEvents('foo-key')).map((s) => s.event.op)
    expect(ops).toEqual(['comment.add', 'comment.edit', 'comment.resolve', 'comment.del'])
  })

  it('hydrateFromSink: on open, replays sink into legacy tables when they are empty', async () => {
    setAnnotationStorageMode('file')
    await fileSink.append('foo-key', [{
      v: 1, ts: 1, id: 'h1', op: 'highlight.add', docKey: 'foo-key',
      anchor: { markdownStart: 0, markdownEnd: 5, exact: 'Hello' }, color: 'yellow',
    } as never])
    const a = makeAdapter(true)
    await a.hydrateFromSinkIfNeeded(docId, 'foo-key')
    expect((await base.getHighlights(docId)).length).toBe(1)
  })
})
