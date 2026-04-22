import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { buildShareForDocument, sidecarBasename, importRemoteEventsToLocal } from '../lib/share-builder'
import { db, dexieSink } from '../lib/docstore'
import { decodeWal, SCHEMA_VERSION, highlightToEvent, type AnnotationEvent } from '../lib/annotation-events'
import type { Highlight } from '../lib/docstore'

const ts = Date.parse('2026-04-22T00:00:00Z')

const sampleDoc = {
  fileName: 'sample.md',
  markdown: '# Sample\n\nFirst paragraph.\n\nSecond paragraph.',
  addedAt: ts,
  wordCount: 6,
  chunkCount: 1,
  toc: [],
  contentHash: 'abc123',
  simhash: 0,
  termVectorJson: '{}',
}

async function reset() {
  await db.documents.clear()
  await db.highlights.clear()
  await db.comments.clear()
  await db.annotationLog.clear()
  await db.annotationCheckpoint.clear()
}

describe('sidecarBasename', () => {
  it('prefixes with dot and appends .annot', () => {
    expect(sidecarBasename('foo.md')).toBe('.foo.md.annot')
  })

  it('strips leading dots before re-prefixing (avoids ..foo.md.annot)', () => {
    expect(sidecarBasename('.foo.md')).toBe('.foo.md.annot')
  })
})

describe('buildShareForDocument', () => {
  beforeEach(async () => {
    await reset()
  })

  it('produces a valid WAL with a header for an empty doc', async () => {
    const docId = await db.documents.add(sampleDoc) as number
    const doc = (await db.documents.get(docId))!
    const built = await buildShareForDocument({
      doc,
      origin: 'https://mdreader.app',
      publicDocUrl: 'https://example.com/sample.md',
    })
    const events = decodeWal(built.wal)
    expect(events.length).toBe(1)
    expect(events[0].op).toBe('header')
    expect(built.eventCount).toBe(0)
    expect(built.url).not.toBeNull()
    expect(built.urlKind).toBe('inline')
  })

  it('projects legacy highlights and comments into the WAL', async () => {
    const docId = await db.documents.add(sampleDoc) as number
    const doc = (await db.documents.get(docId))!
    await db.highlights.add({
      docId,
      text: 'First',
      startOffset: 9,
      endOffset: 14,
      color: 'yellow',
      note: '',
      createdAt: ts,
    })
    await db.comments.add({
      docId,
      selectedText: 'Second',
      comment: 'why?',
      author: 'me',
      sectionId: 'sample',
      createdAt: ts + 1,
      resolved: false,
    })
    const built = await buildShareForDocument({
      doc,
      origin: 'https://mdreader.app',
      publicDocUrl: 'https://example.com/sample.md',
    })
    expect(built.highlightCount).toBe(1)
    expect(built.commentCount).toBe(1)
    expect(built.eventCount).toBe(2)
  })

  it('falls back to url-pair when inline overflows', async () => {
    const docId = await db.documents.add(sampleDoc) as number
    const doc = (await db.documents.get(docId))!
    // Pump ~50 highlights into the log to guarantee overflow at maxInline=512
    const events: AnnotationEvent[] = []
    for (let i = 0; i < 50; i++) {
      events.push({
        v: SCHEMA_VERSION,
        ts: ts + i,
        id: `h${i}`,
        op: 'highlight.add',
        docKey: 'abc123',
        anchor: { line: 0, word: 0, len: 1, text: 'foo' },
        color: 'yellow',
      } as AnnotationEvent)
    }
    await dexieSink.append('abc123', events)
    const built = await buildShareForDocument({
      doc,
      origin: 'https://mdreader.app',
      publicDocUrl: 'https://example.com/sample.md',
      maxInlineBytes: 512,
    })
    expect(built.inlineOverflowed).toBe(true)
    expect(built.urlKind).toBe('url-pair')
    expect(built.url).toContain('#url=')
    expect(built.url).not.toContain('annot=')
  })

  it('returns url=null when no public URL is provided', async () => {
    const docId = await db.documents.add(sampleDoc) as number
    const doc = (await db.documents.get(docId))!
    const built = await buildShareForDocument({
      doc,
      origin: 'https://mdreader.app',
    })
    expect(built.url).toBeNull()
    expect(built.urlKind).toBeNull()
    expect(built.wal.length).toBeGreaterThan(0)
  })

  it('dedupes when both legacy and persisted log have the same id', async () => {
    const docId = await db.documents.add(sampleDoc) as number
    const doc = (await db.documents.get(docId))!
    // Synthetic ids from the legacy projection are derived from docKey +
    // anchor coords (see highlightToEvent). Insert the row first, then
    // project it to get the id the persisted event should reuse to trigger
    // the dedup path.
    const legacyRow: Highlight = {
      docId,
      text: 'First',
      startOffset: 9,
      endOffset: 14,
      color: 'yellow',
      note: '',
      createdAt: ts,
    }
    const hRowId = await db.highlights.add(legacyRow) as number
    const legacyEvent = highlightToEvent({ ...legacyRow, id: hRowId }, 'abc123')
    await dexieSink.append('abc123', [{
      v: SCHEMA_VERSION,
      ts: ts + 100,
      id: legacyEvent.id,
      op: 'highlight.add',
      docKey: 'abc123',
      anchor: { byteOffset: 9, text: 'First' },
      color: 'pink',
    } as AnnotationEvent])
    const built = await buildShareForDocument({
      doc,
      origin: 'https://mdreader.app',
    })
    const events = decodeWal(built.wal).filter((e) => e.op === 'highlight.add')
    expect(events.length).toBe(1)
  })
})

describe('importRemoteEventsToLocal', () => {
  beforeEach(async () => {
    await reset()
  })

  it('inserts new highlights + comments into Dexie', async () => {
    const docId = await db.documents.add(sampleDoc) as number
    const doc = (await db.documents.get(docId))!
    const events: AnnotationEvent[] = [
      {
        v: SCHEMA_VERSION,
        ts,
        id: 'h_remote',
        op: 'highlight.add',
        docKey: 'abc123',
        anchor: { byteOffset: 9, markdownStart: 9, markdownEnd: 14, exact: 'First', prefix: '', suffix: '', sectionId: 'sample', offsetInSection: 0 },
        color: 'green',
      } as AnnotationEvent,
      {
        v: SCHEMA_VERSION,
        ts: ts + 1,
        id: 'c_remote',
        op: 'comment.add',
        docKey: 'abc123',
        anchor: { text: 'Second', section: 'sample' },
        selectedText: 'Second',
        body: 'imported note',
        author: 'manu',
        sectionId: 'sample',
      } as AnnotationEvent,
    ]
    const result = await importRemoteEventsToLocal({ doc, events })
    expect(result).toEqual({ highlightsAdded: 1, commentsAdded: 1 })
    expect(await db.highlights.count()).toBe(1)
    expect(await db.comments.count()).toBe(1)
  })

  it('does not duplicate when called twice with the same event set', async () => {
    const docId = await db.documents.add(sampleDoc) as number
    const doc = (await db.documents.get(docId))!
    const events: AnnotationEvent[] = [
      {
        v: SCHEMA_VERSION,
        ts,
        id: 'h_x',
        op: 'highlight.add',
        docKey: 'abc123',
        anchor: { byteOffset: 9, markdownStart: 9, markdownEnd: 14, exact: 'First', prefix: '', suffix: '', sectionId: 's', offsetInSection: 0 },
        color: 'yellow',
      } as AnnotationEvent,
    ]
    await importRemoteEventsToLocal({ doc, events })
    const second = await importRemoteEventsToLocal({ doc, events })
    expect(second.highlightsAdded).toBe(0)
    expect(await db.highlights.count()).toBe(1)
  })

  it('falls back to defaultAuthor when event has no author', async () => {
    const docId = await db.documents.add(sampleDoc) as number
    const doc = (await db.documents.get(docId))!
    const events: AnnotationEvent[] = [
      {
        v: SCHEMA_VERSION,
        ts,
        id: 'c_anon',
        op: 'comment.add',
        docKey: 'abc123',
        anchor: { text: 'Second' },
        selectedText: 'Second',
        body: 'body',
        author: '',
        sectionId: 's',
      } as AnnotationEvent,
    ]
    await importRemoteEventsToLocal({ doc, events, defaultAuthor: 'Anon' })
    const all = await db.comments.toArray()
    expect(all[0].author).toBe('Anon')
  })
})
