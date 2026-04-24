import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { DexieAdapter } from '../adapters/dexie-adapter'
import { FileRoutedAdapter } from '../adapters/file-routed-adapter'
import { AnnotationSinkRouter } from '../lib/annotation-sink-router'
import { InMemorySink } from '../lib/annotation-log'
import { setAnnotationStorageMode } from '../lib/annotation-storage-mode'
import { db } from '../lib/docstore'

describe('annotation storage mode — lifecycle', () => {
  let base: DexieAdapter
  let fileSink: InMemorySink
  let adapter: FileRoutedAdapter
  let docId: number

  beforeEach(async () => {
    // The docstore module holds a live singleton Dexie connection, so we
    // clear individual tables rather than Dexie.delete() (same approach as
    // file-routed-adapter.test.ts).
    await Promise.all([
      db.documents.clear(),
      db.highlights.clear(),
      db.comments.clear(),
      db.annotationLog.clear(),
      db.annotationCheckpoint.clear(),
    ])
    localStorage.clear()
    base = new DexieAdapter()
    fileSink = new InMemorySink()
    const router = new AnnotationSinkRouter({
      dbSink: new InMemorySink(),
      fileSinkFactory: async () => fileSink,
    })
    const res = await base.addDocument('foo.md', '# Title\n\nbody body')
    docId = res.docId
    adapter = new FileRoutedAdapter({
      base, router,
      docContextProvider: () => ({
        docKey: 'foo-key', docId, fileName: 'foo.md', folderHandleAvailable: true,
      }),
    })
  })

  it('file mode: add → clear legacy tables → hydrate from sink → highlights visible again', async () => {
    setAnnotationStorageMode('file')
    await adapter.addHighlight({ docId, text: 'body', startOffset: 8, endOffset: 12,
      color: 'yellow', note: '', createdAt: 1 })
    expect((await adapter.getHighlights(docId)).length).toBe(1)

    // Simulate a fresh session: wipe legacy tables, re-hydrate from sink.
    await db.highlights.clear()
    await db.comments.clear()
    await adapter.hydrateFromSinkIfNeeded(docId, 'foo-key')
    expect((await adapter.getHighlights(docId)).length).toBe(1)
    expect((await adapter.getHighlights(docId))[0].text).toBe('body')
  })

  it('db mode: add → no sink events written', async () => {
    setAnnotationStorageMode('db')
    await adapter.addComment({ docId, selectedText: 'body', comment: 'nice',
      author: 'u', sectionId: 'h1', createdAt: 1, resolved: false })
    expect((await fileSink.listEvents('foo-key')).length).toBe(0)
    expect((await adapter.getComments(docId)).length).toBe(1)
  })

  it('full lifecycle: add + edit + resolve + delete all replay correctly', async () => {
    setAnnotationStorageMode('file')
    const hid = await adapter.addHighlight({ docId, text: 'hi', startOffset: 0, endOffset: 2,
      color: 'yellow', note: '', createdAt: 1 })
    await adapter.updateHighlightColor(hid, 'pink')
    await adapter.updateHighlightNote(hid, 'the note')

    const cid = await adapter.addComment({ docId, selectedText: 's', comment: 'first body',
      author: 'me', sectionId: 'h1', createdAt: 2, resolved: false })
    await adapter.updateComment(cid, { comment: 'second body' })
    await adapter.updateComment(cid, { resolved: true })

    // Clear legacy tables — sink is the source of truth.
    await db.highlights.clear()
    await db.comments.clear()
    await adapter.hydrateFromSinkIfNeeded(docId, 'foo-key')

    const hl = await adapter.getHighlights(docId)
    expect(hl.length).toBe(1)
    expect(hl[0].color).toBe('pink')
    expect(hl[0].note).toBe('the note')

    const cm = await adapter.getComments(docId)
    expect(cm.length).toBe(1)
    expect(cm[0].comment).toBe('second body')
    expect(cm[0].resolved).toBe(true)
  })

  it('delete: hydrate reflects the removal', async () => {
    setAnnotationStorageMode('file')
    const hid = await adapter.addHighlight({ docId, text: 'x', startOffset: 0, endOffset: 1,
      color: 'yellow', note: '', createdAt: 1 })
    await adapter.removeHighlight(hid)

    await db.highlights.clear()
    await adapter.hydrateFromSinkIfNeeded(docId, 'foo-key')
    expect((await adapter.getHighlights(docId)).length).toBe(0)
  })
})
