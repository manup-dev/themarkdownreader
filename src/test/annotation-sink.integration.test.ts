/**
 * End-to-end test for the Dexie-backed annotation log. Uses fake-indexeddb
 * so we exercise real schema + real Dexie transactions without needing a
 * browser. Complements the in-memory-sink tests by proving the Dexie wiring
 * actually persists and retrieves events through the v9 tables.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { AnnotationLog } from '../lib/annotation-log'
import { SCHEMA_VERSION, type HighlightAddEvent, type CommentAddEvent } from '../lib/annotation-events'
import { db, dexieSink, deriveDocKey, legacyEventsForDoc } from '../lib/docstore'

const DOC_KEY = 'sha256:abc123'
const CLIENT = 'client-integration'
const baseTs = Date.parse('2026-04-21T00:00:00Z')

const hAdd = (id: string, t: number, color = 'yellow'): HighlightAddEvent => ({
  v: SCHEMA_VERSION,
  ts: t,
  id,
  op: 'highlight.add',
  docKey: DOC_KEY,
  anchor: { line: 1, word: 0, len: 3, text: 'foo' },
  color,
})

const cAdd = (id: string, t: number): CommentAddEvent => ({
  v: SCHEMA_VERSION,
  ts: t,
  id,
  op: 'comment.add',
  docKey: DOC_KEY,
  anchor: { text: 'foo' },
  selectedText: 'foo',
  body: 'hm',
  author: 'tester',
  sectionId: 'intro',
})

async function resetDb() {
  await db.annotationLog.clear()
  await db.annotationCheckpoint.clear()
  await db.highlights.clear()
  await db.comments.clear()
}

describe('DexieAnnotationSink integration', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('append + listEvents round-trips through Dexie', async () => {
    await dexieSink.append(DOC_KEY, [hAdd('h1', baseTs), hAdd('h2', baseTs + 1)])
    const rows = await dexieSink.listEvents(DOC_KEY)
    expect(rows.length).toBe(2)
    expect(rows[0].event.id).toBe('h1')
    expect(rows[1].event.id).toBe('h2')
    expect(rows[0].seq).toBeLessThan(rows[1].seq)
  })

  it('checkpoint round-trips', async () => {
    await dexieSink.writeCheckpoint(DOC_KEY, {
      v: SCHEMA_VERSION,
      ts: baseTs,
      id: 'cp1',
      op: 'checkpoint',
      priorEvents: 0,
      state: { highlights: [], comments: [] },
    })
    const cp = await dexieSink.readCheckpoint(DOC_KEY)
    expect(cp?.op).toBe('checkpoint')
    expect(cp?.id).toBe('cp1')
  })

  it('partitions logs per docKey', async () => {
    await dexieSink.append(DOC_KEY, [hAdd('h1', baseTs)])
    await dexieSink.append('other-doc', [hAdd('h2', baseTs + 1)])
    const one = await dexieSink.listEvents(DOC_KEY)
    const two = await dexieSink.listEvents('other-doc')
    expect(one.length).toBe(1)
    expect(two.length).toBe(1)
    expect(one[0].event.id).toBe('h1')
    expect(two[0].event.id).toBe('h2')
  })

  it('truncateBefore removes events below seq and returns count', async () => {
    await dexieSink.append(DOC_KEY, [hAdd('h1', baseTs), hAdd('h2', baseTs + 1)])
    const rows = await dexieSink.listEvents(DOC_KEY)
    const cutoff = rows[rows.length - 1].seq + 1
    const removed = await dexieSink.truncateBefore(DOC_KEY, cutoff)
    expect(removed).toBe(2)
    expect((await dexieSink.listEvents(DOC_KEY)).length).toBe(0)
  })

  it('AnnotationLog.compact end-to-end via dexieSink', async () => {
    const log = new AnnotationLog(DOC_KEY, dexieSink, CLIENT)
    await log.hydrate()
    await log.append([hAdd('h1', baseTs), cAdd('c1', baseTs + 1)])
    const result = await log.compact()
    expect(result.removedEvents).toBe(2)

    const log2 = new AnnotationLog(DOC_KEY, dexieSink, CLIENT)
    await log2.hydrate()
    expect(log2.highlights.length).toBe(1)
    expect(log2.comments.length).toBe(1)
  })
})

describe('deriveDocKey', () => {
  it('prefers contentHash', () => {
    expect(deriveDocKey({ contentHash: 'sha256:xyz', fileName: 'a.md' })).toBe('sha256:xyz')
  })

  it('falls back to fileName when hash is missing', () => {
    expect(deriveDocKey({ contentHash: '', fileName: 'a.md' })).toBe('name:a.md')
  })
})

describe('legacyEventsForDoc', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('projects legacy highlights and comments to synthetic events', async () => {
    await db.highlights.add({
      docId: 1,
      text: 'hello',
      startOffset: 0,
      endOffset: 5,
      color: 'yellow',
      note: '',
      createdAt: baseTs,
    })
    await db.comments.add({
      docId: 1,
      selectedText: 'hello',
      comment: 'what?',
      author: 'me',
      sectionId: 'intro',
      createdAt: baseTs + 1,
      resolved: false,
    })
    const events = await legacyEventsForDoc(1, DOC_KEY)
    expect(events.map((e) => e.op)).toEqual(['highlight.add', 'comment.add'])
  })

  it('preserves resolved flag as a comment.resolve event', async () => {
    await db.comments.add({
      docId: 7,
      selectedText: 'x',
      comment: 'y',
      author: 'me',
      sectionId: 's',
      createdAt: baseTs,
      resolved: true,
    })
    const events = await legacyEventsForDoc(7, DOC_KEY)
    expect(events.map((e) => e.op)).toEqual(['comment.add', 'comment.resolve'])
  })
})
