import { describe, it, expect } from 'vitest'
import {
  SCHEMA_VERSION,
  emptyState,
  reduce,
  materialize,
  encodeWal,
  decodeWal,
  dedupeEvents,
  compareEvents,
  highlightToEvent,
  commentsToEvents,
  legacyToEvents,
  type AnnotationEvent,
  type HighlightAddEvent,
  type CommentAddEvent,
  type CheckpointEvent,
} from '../lib/annotation-events'
import type { Highlight, Comment } from '../lib/docstore'

const DOC = 'doc-key-1'
const ts = (n: number) => Date.parse('2026-04-21T00:00:00Z') + n * 1000

const hAdd = (id: string, atTs: number, color = 'yellow'): HighlightAddEvent => ({
  v: SCHEMA_VERSION,
  ts: atTs,
  id,
  op: 'highlight.add',
  docKey: DOC,
  anchor: { line: 1, word: 0, len: 3, text: 'foo bar baz' },
  color,
})

const cAdd = (id: string, atTs: number, body = 'hm'): CommentAddEvent => ({
  v: SCHEMA_VERSION,
  ts: atTs,
  id,
  op: 'comment.add',
  docKey: DOC,
  anchor: { text: 'foo' },
  selectedText: 'foo',
  body,
  author: 'Tester',
  sectionId: 'intro',
})

describe('reduce / materialize', () => {
  it('applies a highlight.add', () => {
    const s = materialize([hAdd('h1', ts(1))])
    expect(s.highlights.size).toBe(1)
    expect(s.highlights.get('h1')?.color).toBe('yellow')
  })

  it('applies a highlight.del', () => {
    const events: AnnotationEvent[] = [
      hAdd('h1', ts(1)),
      { v: SCHEMA_VERSION, ts: ts(2), id: 'h1', op: 'highlight.del', docKey: DOC },
    ]
    const s = materialize(events)
    expect(s.highlights.size).toBe(0)
  })

  it('del for unknown id is a no-op (does not crash)', () => {
    const events: AnnotationEvent[] = [
      { v: SCHEMA_VERSION, ts: ts(1), id: 'ghost', op: 'highlight.del', docKey: DOC },
    ]
    const s = materialize(events)
    expect(s.highlights.size).toBe(0)
  })

  it('highlight.edit patches color and note', () => {
    const s = materialize([
      hAdd('h1', ts(1), 'yellow'),
      { v: SCHEMA_VERSION, ts: ts(2), id: 'h1', op: 'highlight.edit', docKey: DOC, color: 'red', note: 'important' },
    ])
    expect(s.highlights.get('h1')?.color).toBe('red')
    expect(s.highlights.get('h1')?.note).toBe('important')
  })

  it('comment.add then comment.resolve toggles the flag', () => {
    const s = materialize([
      cAdd('c1', ts(1)),
      { v: SCHEMA_VERSION, ts: ts(2), id: 'c1', op: 'comment.resolve', docKey: DOC, resolved: true },
    ])
    expect(s.comments.get('c1')?.resolved).toBe(true)
  })

  it('comment.edit updates body but preserves author/created', () => {
    const s = materialize([
      cAdd('c1', ts(1), 'first'),
      { v: SCHEMA_VERSION, ts: ts(2), id: 'c1', op: 'comment.edit', docKey: DOC, body: 'second' },
    ])
    const c = s.comments.get('c1')!
    expect(c.body).toBe('second')
    expect(c.author).toBe('Tester')
    expect(c.createdAt).toBe(ts(1))
  })

  it('unknown op is preserved (forward-compat)', () => {
    const s = reduce(emptyState(), {
      v: SCHEMA_VERSION,
      ts: ts(1),
      id: 'r1',
      op: 'reaction.add',
    } as AnnotationEvent)
    expect(s.unknown.length).toBe(1)
    expect((s.unknown[0] as { op: string }).op).toBe('reaction.add')
  })

  it('header event has no visible effect on state', () => {
    const s = reduce(emptyState(), {
      v: SCHEMA_VERSION,
      ts: ts(0),
      id: 'hdr',
      op: 'header',
      doc: { title: 't' },
      schema: 'mdreader.annot/1',
      createdAt: ts(0),
    } as AnnotationEvent)
    expect(s.highlights.size).toBe(0)
    expect(s.comments.size).toBe(0)
  })
})

describe('checkpoint', () => {
  it('replaces state wholesale', () => {
    const cp: CheckpointEvent = {
      v: SCHEMA_VERSION,
      ts: ts(5),
      id: 'cp1',
      op: 'checkpoint',
      priorEvents: 3,
      state: {
        highlights: [{ id: 'h9', docKey: DOC, anchor: { text: 'x' }, color: 'blue', createdAt: ts(3) }],
        comments: [],
      },
    }
    const s = materialize([hAdd('h1', ts(1)), cp])
    expect(s.highlights.size).toBe(1)
    expect(s.highlights.has('h1')).toBe(false)
    expect(s.highlights.has('h9')).toBe(true)
  })
})

describe('JSONL codec', () => {
  it('roundtrips a small WAL', () => {
    const events: AnnotationEvent[] = [hAdd('h1', ts(1)), cAdd('c1', ts(2))]
    const text = encodeWal(events)
    const parsed = decodeWal(text)
    expect(parsed).toEqual(events)
  })

  it('skips corrupt lines (R3)', () => {
    const good = JSON.stringify(hAdd('h1', ts(1)))
    const text = `${good}\n{not json\n${good}\n`
    const parsed = decodeWal(text)
    expect(parsed.length).toBe(2)
  })

  it('preserves events from a future schema version as forward-compat', () => {
    const future = JSON.stringify({ ...hAdd('h1', ts(1)), v: 99 })
    const parsed = decodeWal(future)
    expect(parsed.length).toBe(1)
    expect((parsed[0] as unknown as { forwardCompat?: boolean }).forwardCompat).toBe(true)
  })

  it('ignores malformed records without id/op/ts', () => {
    const text = JSON.stringify({ op: 'highlight.add' })
    expect(decodeWal(text).length).toBe(0)
  })

  it('encodes empty WAL as empty string (no trailing newline drama)', () => {
    expect(encodeWal([])).toBe('')
  })
})

describe('dedupe + compare', () => {
  it('later event wins when id+op collide', () => {
    const a = { ...hAdd('h1', ts(1)), color: 'yellow' }
    const b = { ...hAdd('h1', ts(2)), color: 'green' }
    const merged = dedupeEvents([a, b])
    expect(merged.length).toBe(1)
    expect((merged[0] as HighlightAddEvent).color).toBe('green')
  })

  it('different ops on same id are kept separately', () => {
    const add = hAdd('h1', ts(1))
    const del: AnnotationEvent = { v: SCHEMA_VERSION, ts: ts(2), id: 'h1', op: 'highlight.del', docKey: DOC }
    const merged = dedupeEvents([add, del])
    expect(merged.length).toBe(2)
  })

  it('compareEvents is deterministic across clients', () => {
    const a = { ...hAdd('h1', ts(1)), clientId: 'client-a' }
    const b = { ...hAdd('h2', ts(1)), clientId: 'client-b' }
    expect(compareEvents(a, b)).toBeLessThan(0)
  })
})

describe('legacy projection', () => {
  it('converts a Highlight row to a synthetic add event', () => {
    const h: Highlight = {
      id: 7,
      docId: 1,
      text: 'hello world',
      startOffset: 10,
      endOffset: 21,
      color: 'pink',
      note: 'cool',
      createdAt: ts(1),
    }
    const e = highlightToEvent(h, DOC)
    // Synthetic ids are content-derived (djb2 over docKey + offsets +
    // text) so two clients projecting the same legacy row converge.
    // Shape-check rather than pinning the literal hex.
    expect(e.id).toMatch(/^h_[0-9a-f]{8}$/)
    // Determinism: projecting again yields the same id.
    expect(highlightToEvent(h, DOC).id).toBe(e.id)
    expect(e.op).toBe('highlight.add')
    expect(e.anchor.byteOffset).toBe(10)
    expect(e.color).toBe('pink')
    expect(e.note).toBe('cool')
  })

  it('omits note when empty string', () => {
    const h: Highlight = {
      id: 8,
      docId: 1,
      text: 'x',
      startOffset: 0,
      endOffset: 1,
      color: 'y',
      note: '',
      createdAt: ts(1),
    }
    expect(highlightToEvent(h, DOC).note).toBeUndefined()
  })

  it('emits a resolve event for resolved comments', () => {
    const c: Comment = {
      id: 3,
      docId: 1,
      selectedText: 'foo',
      comment: 'why?',
      author: 'Me',
      sectionId: 'intro',
      createdAt: ts(1),
      resolved: true,
    }
    const events = commentsToEvents([c], DOC)
    expect(events.length).toBe(2)
    expect(events[0].op).toBe('comment.add')
    expect(events[1].op).toBe('comment.resolve')
  })

  it('legacyToEvents combines highlights and comments', () => {
    const h: Highlight = { id: 1, docId: 1, text: 't', startOffset: 0, endOffset: 1, color: 'y', note: '', createdAt: ts(1) }
    const c: Comment = { id: 1, docId: 1, selectedText: 't', comment: 'c', author: 'a', sectionId: 's', createdAt: ts(2), resolved: false }
    const events = legacyToEvents([h], [c], DOC)
    expect(events.map((e) => e.op)).toEqual(['highlight.add', 'comment.add'])
  })

  it('materializing legacy projection recovers rows shape', () => {
    const h: Highlight = { id: 1, docId: 1, text: 'hi', startOffset: 0, endOffset: 2, color: 'y', note: '', createdAt: ts(1) }
    const c: Comment = { id: 2, docId: 1, selectedText: 'hi', comment: 'body', author: 'a', sectionId: 's', createdAt: ts(2), resolved: true }
    const projected = legacyToEvents([h], [c], DOC)
    const s = materialize(projected)
    const hEvent = projected.find((e) => e.op === 'highlight.add')!
    const cEvent = projected.find((e) => e.op === 'comment.add')!
    expect(s.highlights.get(hEvent.id)?.color).toBe('y')
    expect(s.comments.get(cEvent.id)?.resolved).toBe(true)
    expect(s.comments.get(cEvent.id)?.body).toBe('body')
  })
})
