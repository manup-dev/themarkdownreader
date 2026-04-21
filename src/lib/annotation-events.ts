import type { TextAnchor } from './anchor'
import type { Highlight, Comment } from './docstore'

/**
 * JSONL WAL grammar v1. One event per line in the sidecar file.
 * See docs/design/shareable-annotations-2026-04-21/01-annotation-grammar.md.
 */

export const SCHEMA_VERSION = 1
export const SCHEMA_ID = 'mdreader.annot/1'

export type HighlightColor = string

export interface AnchorCoords extends Partial<TextAnchor> {
  line?: number
  word?: number
  len?: number
  byteOffset?: number
  text?: string
  ctx?: { pre: string; post: string }
  section?: string
}

export interface EventCommon {
  v: number
  ts: number
  id: string
  op: string
  by?: string
  clientId?: string
}

export interface HeaderEvent extends EventCommon {
  op: 'header'
  doc: {
    title?: string
    contentHash?: string
    source?: string
    docKey?: string
  }
  schema: string
  createdAt: number
  createdBy?: string
}

export interface HighlightAddEvent extends EventCommon {
  op: 'highlight.add'
  anchor: AnchorCoords
  color: HighlightColor
  note?: string
  docKey: string
}

export interface HighlightDelEvent extends EventCommon {
  op: 'highlight.del'
  docKey: string
}

export interface HighlightEditEvent extends EventCommon {
  op: 'highlight.edit'
  docKey: string
  color?: HighlightColor
  note?: string
}

export interface CommentAddEvent extends EventCommon {
  op: 'comment.add'
  anchor: AnchorCoords
  selectedText: string
  body: string
  author: string
  sectionId: string
  docKey: string
}

export interface CommentEditEvent extends EventCommon {
  op: 'comment.edit'
  docKey: string
  body: string
}

export interface CommentResolveEvent extends EventCommon {
  op: 'comment.resolve'
  docKey: string
  resolved: boolean
}

export interface CommentDelEvent extends EventCommon {
  op: 'comment.del'
  docKey: string
}

export interface CheckpointEvent extends EventCommon {
  op: 'checkpoint'
  state: {
    highlights: MaterializedHighlight[]
    comments: MaterializedComment[]
    unknown?: UnknownEvent[]
  }
  priorEvents: number
}

export interface UnknownEvent extends EventCommon {
  op: string
  [k: string]: unknown
}

export type AnnotationEvent =
  | HeaderEvent
  | HighlightAddEvent
  | HighlightDelEvent
  | HighlightEditEvent
  | CommentAddEvent
  | CommentEditEvent
  | CommentResolveEvent
  | CommentDelEvent
  | CheckpointEvent
  | UnknownEvent

export const KNOWN_OPS = new Set<string>([
  'header',
  'highlight.add',
  'highlight.del',
  'highlight.edit',
  'comment.add',
  'comment.edit',
  'comment.resolve',
  'comment.del',
  'checkpoint',
])

export interface MaterializedHighlight {
  id: string
  docKey: string
  anchor: AnchorCoords
  color: HighlightColor
  note?: string
  createdAt: number
  createdBy?: string
}

export interface MaterializedComment {
  id: string
  docKey: string
  anchor: AnchorCoords
  selectedText: string
  body: string
  author: string
  sectionId: string
  resolved: boolean
  createdAt: number
  createdBy?: string
}

export interface DocState {
  highlights: Map<string, MaterializedHighlight>
  comments: Map<string, MaterializedComment>
  unknown: UnknownEvent[]
}

export function emptyState(): DocState {
  return { highlights: new Map(), comments: new Map(), unknown: [] }
}

/**
 * Fold a single event into state. Unknown ops are preserved verbatim
 * so a future app that writes newer events doesn't lose data when an
 * older app compacts. Known ops that target a missing id are no-ops
 * (handles out-of-order delete/edit without crashing).
 */
export function reduce(state: DocState, event: AnnotationEvent): DocState {
  switch (event.op) {
    case 'header':
      return state

    case 'highlight.add': {
      const e = event as HighlightAddEvent
      const next = new Map(state.highlights)
      next.set(e.id, {
        id: e.id,
        docKey: e.docKey,
        anchor: e.anchor,
        color: e.color,
        note: e.note,
        createdAt: e.ts,
        createdBy: e.by,
      })
      return { ...state, highlights: next }
    }

    case 'highlight.del': {
      if (!state.highlights.has(event.id)) return state
      const next = new Map(state.highlights)
      next.delete(event.id)
      return { ...state, highlights: next }
    }

    case 'highlight.edit': {
      const e = event as HighlightEditEvent
      const prev = state.highlights.get(e.id)
      if (!prev) return state
      const next = new Map(state.highlights)
      next.set(e.id, {
        ...prev,
        color: e.color ?? prev.color,
        note: e.note !== undefined ? e.note : prev.note,
      })
      return { ...state, highlights: next }
    }

    case 'comment.add': {
      const e = event as CommentAddEvent
      const next = new Map(state.comments)
      next.set(e.id, {
        id: e.id,
        docKey: e.docKey,
        anchor: e.anchor,
        selectedText: e.selectedText,
        body: e.body,
        author: e.author,
        sectionId: e.sectionId,
        resolved: false,
        createdAt: e.ts,
        createdBy: e.by,
      })
      return { ...state, comments: next }
    }

    case 'comment.edit': {
      const e = event as CommentEditEvent
      const prev = state.comments.get(e.id)
      if (!prev) return state
      const next = new Map(state.comments)
      next.set(e.id, { ...prev, body: e.body })
      return { ...state, comments: next }
    }

    case 'comment.resolve': {
      const e = event as CommentResolveEvent
      const prev = state.comments.get(e.id)
      if (!prev) return state
      const next = new Map(state.comments)
      next.set(e.id, { ...prev, resolved: e.resolved })
      return { ...state, comments: next }
    }

    case 'comment.del': {
      if (!state.comments.has(event.id)) return state
      const next = new Map(state.comments)
      next.delete(event.id)
      return { ...state, comments: next }
    }

    case 'checkpoint': {
      const e = event as CheckpointEvent
      const highlights = new Map<string, MaterializedHighlight>()
      for (const h of e.state.highlights) highlights.set(h.id, h)
      const comments = new Map<string, MaterializedComment>()
      for (const c of e.state.comments) comments.set(c.id, c)
      return { highlights, comments, unknown: e.state.unknown ?? [] }
    }

    default: {
      // unknown op — preserve verbatim
      return { ...state, unknown: [...state.unknown, event as UnknownEvent] }
    }
  }
}

/**
 * Replay a sequence of events into a final state. Events are applied in the
 * order they appear; callers should sort by ts+clientId+seq before replay
 * if they are merging from multiple sources.
 */
export function materialize(events: Iterable<AnnotationEvent>): DocState {
  let s = emptyState()
  for (const e of events) s = reduce(s, e)
  return s
}

/**
 * Deterministic ordering for merging event streams from multiple clients.
 * Primary: ts. Ties broken by clientId, then by id.
 */
export function compareEvents(a: AnnotationEvent, b: AnnotationEvent): number {
  if (a.ts !== b.ts) return a.ts - b.ts
  const ac = a.clientId ?? ''
  const bc = b.clientId ?? ''
  if (ac !== bc) return ac < bc ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Deduplicate events by (id, op). Later occurrences win.
 * Used when merging remote and local WALs before replay.
 */
export function dedupeEvents(events: AnnotationEvent[]): AnnotationEvent[] {
  const seen = new Map<string, AnnotationEvent>()
  for (const e of events) seen.set(`${e.id}|${e.op}`, e)
  return [...seen.values()].sort(compareEvents)
}

// ─── JSONL codec ────────────────────────────────────────────────────────────

export function encodeEvent(e: AnnotationEvent): string {
  return JSON.stringify(e)
}

export function encodeWal(events: AnnotationEvent[]): string {
  return events.map(encodeEvent).join('\n') + (events.length ? '\n' : '')
}

/**
 * Parse a JSONL string. Corrupt lines are silently skipped so a partially-
 * truncated file still yields all readable events (R3 from the spec).
 * Events from a future schema version are also dropped here; upgrading to a
 * newer version is future work.
 */
export function decodeWal(text: string): AnnotationEvent[] {
  const out: AnnotationEvent[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    try {
      const evt = JSON.parse(line) as AnnotationEvent
      if (!evt || typeof evt !== 'object') continue
      if (typeof evt.op !== 'string' || typeof evt.ts !== 'number' || typeof evt.id !== 'string') continue
      if (typeof evt.v !== 'number' || evt.v > SCHEMA_VERSION) continue
      out.push(evt)
    } catch {
      // R3: skip and keep going
    }
  }
  return out
}

// ─── Legacy projection (Dexie rows → synthetic events) ──────────────────────

/**
 * Map a legacy Highlight row to a synthetic `highlight.add` event. Used
 * when an older doc (pre-v9) is opened and we need to present the full
 * annotation history through the event-log lens.
 *
 * Stable id generation: the Dexie auto-increment id is deterministic within
 * a browser, so `h_<id>` produces the same synthetic event on every load.
 */
export function highlightToEvent(h: Highlight, docKey: string): HighlightAddEvent {
  return {
    v: SCHEMA_VERSION,
    ts: h.createdAt,
    id: `h_${h.id}`,
    op: 'highlight.add',
    docKey,
    anchor: {
      byteOffset: h.startOffset,
      text: h.text,
      ...(h.anchor ?? {}),
    },
    color: h.color,
    note: h.note || undefined,
  }
}

export function commentToEvent(c: Comment, docKey: string): CommentAddEvent {
  return {
    v: SCHEMA_VERSION,
    ts: c.createdAt,
    id: `c_${c.id}`,
    op: 'comment.add',
    docKey,
    anchor: {
      text: c.selectedText,
      section: c.sectionId,
      ...(c.anchor ?? {}),
    },
    selectedText: c.selectedText,
    body: c.comment,
    author: c.author,
    sectionId: c.sectionId,
    by: c.author,
  }
}

/**
 * Project legacy rows to a trailing `comment.resolve` event so materialize
 * reflects the resolved flag. Returned array is flat (add followed by
 * optional resolve).
 */
export function commentsToEvents(comments: Comment[], docKey: string): AnnotationEvent[] {
  const out: AnnotationEvent[] = []
  for (const c of comments) {
    out.push(commentToEvent(c, docKey))
    if (c.resolved) {
      out.push({
        v: SCHEMA_VERSION,
        ts: c.createdAt + 1,
        id: `c_${c.id}`,
        op: 'comment.resolve',
        docKey,
        resolved: true,
      } as CommentResolveEvent)
    }
  }
  return out
}

export function legacyToEvents(
  highlights: Highlight[],
  comments: Comment[],
  docKey: string,
): AnnotationEvent[] {
  return [
    ...highlights.map((h) => highlightToEvent(h, docKey)),
    ...commentsToEvents(comments, docKey),
  ]
}
