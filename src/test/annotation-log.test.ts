import { describe, it, expect, beforeEach } from 'vitest'
import { AnnotationLog, InMemorySink, makeHeader } from '../lib/annotation-log'
import {
  SCHEMA_VERSION,
  type AnnotationEvent,
  type HighlightAddEvent,
  type CommentAddEvent,
} from '../lib/annotation-events'

const DOC = 'doc-1'
const CLIENT = 'client-a'
const baseTs = Date.parse('2026-04-21T00:00:00Z')
const at = (offsetSec: number) => baseTs + offsetSec * 1000

const hAdd = (id: string, t: number, color = 'yellow'): HighlightAddEvent => ({
  v: SCHEMA_VERSION,
  ts: t,
  id,
  op: 'highlight.add',
  docKey: DOC,
  anchor: { line: 1, word: 0, len: 3, text: 'foo' },
  color,
})

const cAdd = (id: string, t: number, body = 'hm'): CommentAddEvent => ({
  v: SCHEMA_VERSION,
  ts: t,
  id,
  op: 'comment.add',
  docKey: DOC,
  anchor: { text: 'foo' },
  selectedText: 'foo',
  body,
  author: 'tester',
  sectionId: 'intro',
})

describe('AnnotationLog', () => {
  let sink: InMemorySink
  let log: AnnotationLog

  beforeEach(() => {
    sink = new InMemorySink()
    log = new AnnotationLog(DOC, sink, CLIENT)
  })

  it('hydrates from an empty sink', async () => {
    const state = await log.hydrate()
    expect(state.highlights.size).toBe(0)
    expect(state.comments.size).toBe(0)
  })

  it('appended events appear in snapshot and in sink', async () => {
    await log.hydrate()
    await log.append([hAdd('h1', at(1))])
    expect(log.highlights.length).toBe(1)
    const stored = await sink.listEvents(DOC)
    expect(stored.length).toBe(1)
  })

  it('stamps clientId when omitted', async () => {
    await log.hydrate()
    await log.append([{ ...hAdd('h1', at(1)), clientId: undefined }])
    const stored = await sink.listEvents(DOC)
    expect(stored[0].event.clientId).toBe(CLIENT)
  })

  it('preserves explicit clientId', async () => {
    await log.hydrate()
    await log.append([{ ...hAdd('h1', at(1)), clientId: 'other-client' }])
    const stored = await sink.listEvents(DOC)
    expect(stored[0].event.clientId).toBe('other-client')
  })

  it('replays events on a second hydrate', async () => {
    await log.hydrate()
    await log.append([hAdd('h1', at(1)), cAdd('c1', at(2))])
    const log2 = new AnnotationLog(DOC, sink, CLIENT)
    await log2.hydrate()
    expect(log2.highlights.length).toBe(1)
    expect(log2.comments.length).toBe(1)
  })

  it('pre-seeded legacy events surface without being persisted', async () => {
    const legacy: AnnotationEvent[] = [hAdd('h_legacy', at(1))]
    await log.hydrate(legacy)
    expect(log.highlights.length).toBe(1)
    // Legacy was not persisted
    const stored = await sink.listEvents(DOC)
    expect(stored.length).toBe(0)
  })

  it('del event removes the highlight from snapshot', async () => {
    await log.hydrate()
    await log.append([hAdd('h1', at(1))])
    await log.append([{ v: SCHEMA_VERSION, ts: at(2), id: 'h1', op: 'highlight.del', docKey: DOC }])
    expect(log.highlights.length).toBe(0)
  })

  it('compact produces checkpoint + empty tail', async () => {
    await log.hydrate()
    await log.append([hAdd('h1', at(1)), hAdd('h2', at(2)), cAdd('c1', at(3))])
    const result = await log.compact()
    expect(result.removedEvents).toBe(3)
    const cp = await sink.readCheckpoint(DOC)
    expect(cp?.state.highlights.length).toBe(2)
    expect(cp?.state.comments.length).toBe(1)
    const remaining = await sink.listEvents(DOC)
    expect(remaining.length).toBe(0)
  })

  it('hydrating after compact reconstructs state from checkpoint', async () => {
    await log.hydrate()
    await log.append([hAdd('h1', at(1)), cAdd('c1', at(2))])
    await log.compact()
    const log2 = new AnnotationLog(DOC, sink, CLIENT)
    await log2.hydrate()
    expect(log2.highlights.length).toBe(1)
    expect(log2.comments.length).toBe(1)
  })

  it('events appended after compact survive with the checkpoint', async () => {
    await log.hydrate()
    await log.append([hAdd('h1', at(1))])
    await log.compact()
    await log.append([hAdd('h2', at(2))])
    const log2 = new AnnotationLog(DOC, sink, CLIENT)
    await log2.hydrate()
    expect(log2.highlights.length).toBe(2)
  })

  it('empty append is a no-op', async () => {
    await log.hydrate()
    await log.append([])
    expect((await sink.listEvents(DOC)).length).toBe(0)
  })
})

describe('makeHeader', () => {
  it('carries metadata', () => {
    const h = makeHeader({ docKey: 'd', title: 't', contentHash: 'hash', source: 'https://x' })
    expect(h.op).toBe('header')
    expect(h.doc.title).toBe('t')
    expect(h.doc.contentHash).toBe('hash')
    expect(h.schema).toMatch(/mdreader\.annot/)
  })
})
