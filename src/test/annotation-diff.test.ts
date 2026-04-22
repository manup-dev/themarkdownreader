import { describe, it, expect } from 'vitest'
import { diffStates, diffEvents, isEmpty, buildPrTitle, buildPrBody } from '../lib/annotation-diff'
import {
  emptyState,
  reduce,
  SCHEMA_VERSION,
  type AnnotationEvent,
  type HighlightAddEvent,
  type CommentAddEvent,
} from '../lib/annotation-events'

const ts = (n: number) => Date.parse('2026-04-22T00:00:00Z') + n * 1000
const DOC = 'd'

const hAdd = (id: string, atTs: number, color = 'yellow', text = 'foo'): HighlightAddEvent => ({
  v: SCHEMA_VERSION, ts: atTs, id, op: 'highlight.add', docKey: DOC,
  anchor: { line: 0, word: 0, len: 1, text }, color,
})

const cAdd = (id: string, atTs: number, body = 'hi', sel = 'foo'): CommentAddEvent => ({
  v: SCHEMA_VERSION, ts: atTs, id, op: 'comment.add', docKey: DOC,
  anchor: { text: sel }, selectedText: sel, body, author: 'me', sectionId: 'intro',
})

describe('diffEvents — highlights', () => {
  it('detects an added highlight', () => {
    const diff = diffEvents([], [hAdd('h1', ts(1))])
    expect(diff.highlights.added.length).toBe(1)
    expect(diff.totals.additions).toBe(1)
  })

  it('detects a removed highlight', () => {
    const diff = diffEvents([hAdd('h1', ts(1))], [])
    expect(diff.highlights.removed.length).toBe(1)
    expect(diff.totals.removals).toBe(1)
  })

  it('detects an edited color', () => {
    const diff = diffEvents([hAdd('h1', ts(1), 'yellow')], [hAdd('h1', ts(1), 'green')])
    expect(diff.highlights.edited.length).toBe(1)
    expect(diff.totals.edits).toBe(1)
  })

  it('detects an edited note', () => {
    const base = reduce(emptyState(), hAdd('h1', ts(1)))
    const head = reduce(reduce(emptyState(), hAdd('h1', ts(1))),
      { v: SCHEMA_VERSION, ts: ts(2), id: 'h1', op: 'highlight.edit', docKey: DOC, note: 'cool' } as AnnotationEvent)
    const diff = diffStates(base, head)
    expect(diff.highlights.edited.length).toBe(1)
  })

  it('reports unchanged highlights as unchanged (not in any bucket)', () => {
    const diff = diffEvents([hAdd('h1', ts(1))], [hAdd('h1', ts(1))])
    expect(diff.totals.additions).toBe(0)
    expect(diff.totals.removals).toBe(0)
    expect(diff.totals.edits).toBe(0)
  })
})

describe('diffEvents — comments', () => {
  it('detects an added comment', () => {
    const diff = diffEvents([], [cAdd('c1', ts(1))])
    expect(diff.comments.added.length).toBe(1)
  })

  it('detects a body edit', () => {
    const diff = diffEvents([cAdd('c1', ts(1), 'old')], [cAdd('c1', ts(1), 'new')])
    expect(diff.comments.edited.length).toBe(1)
  })

  it('separates resolved transitions from edits', () => {
    const base = reduce(emptyState(), cAdd('c1', ts(1)))
    const head = reduce(base, { v: SCHEMA_VERSION, ts: ts(2), id: 'c1', op: 'comment.resolve', docKey: DOC, resolved: true } as AnnotationEvent)
    const diff = diffStates(base, head)
    expect(diff.comments.resolved.length).toBe(1)
    expect(diff.comments.edited.length).toBe(0)
  })

  it('treats reopened (resolved → false) as unresolved', () => {
    const start = reduce(reduce(emptyState(), cAdd('c1', ts(1))),
      { v: SCHEMA_VERSION, ts: ts(2), id: 'c1', op: 'comment.resolve', docKey: DOC, resolved: true } as AnnotationEvent)
    const head = reduce(start,
      { v: SCHEMA_VERSION, ts: ts(3), id: 'c1', op: 'comment.resolve', docKey: DOC, resolved: false } as AnnotationEvent)
    const diff = diffStates(start, head)
    expect(diff.comments.unresolved.length).toBe(1)
  })

  it('isEmpty returns true for identical states', () => {
    const diff = diffEvents([cAdd('c1', ts(1))], [cAdd('c1', ts(1))])
    expect(isEmpty(diff)).toBe(true)
  })
})

describe('PR body generator', () => {
  it('title encodes additions/removals/edits compactly', () => {
    const diff = diffEvents(
      [hAdd('h1', ts(1)), cAdd('c1', ts(2))],
      [hAdd('h2', ts(3)), cAdd('c1', ts(2), 'edited body')],
    )
    const title = buildPrTitle({ diff, fileName: 'paper.md' })
    expect(title).toMatch(/^Annotations on paper\.md/)
    expect(title).toContain('+1')   // h2 added
    expect(title).toContain('-1')   // h1 removed (was in base, not in head)
    expect(title).toContain('~1')   // c1 body edited
  })

  it('body has sections for each change type', () => {
    const diff = diffEvents(
      [],
      [hAdd('h1', ts(1), 'pink', 'paragraph one'), cAdd('c1', ts(2), 'note body', 'paragraph two')],
    )
    const body = buildPrBody({ diff, fileName: 'paper.md', sourceUrl: 'https://x/paper.md' })
    expect(body).toContain('# Annotation changes — `paper.md`')
    expect(body).toContain('## Highlights added')
    expect(body).toContain('paragraph one')
    expect(body).toContain('## Comments added')
    expect(body).toContain('note body')
    expect(body).toContain('source: https://x/paper.md')
    expect(body).toContain('Sidecar file: `.paper.md.annot`')
  })

  it('body skips sections that have no entries', () => {
    const diff = diffEvents([], [hAdd('h1', ts(1))])
    const body = buildPrBody({ diff, fileName: 'a.md' })
    expect(body).toContain('## Highlights added')
    expect(body).not.toContain('## Highlights removed')
    expect(body).not.toContain('## Comments added')
  })
})
