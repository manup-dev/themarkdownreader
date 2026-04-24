/**
 * Build a portable share artifact from the current document state. Reads
 * legacy Highlight/Comment rows + any annotationLog events for the doc and
 * produces a JSONL WAL plus a pre-built share URL chosen from the smallest
 * tier that fits.
 *
 * No mutation of disk state — this is a pure read-then-derive helper that
 * the ShareDialog and the MCP `create_share_url` tool both call.
 */

import { encodeWal, materialize, type AnnotationEvent } from './annotation-events'
import { AnnotationLog, makeHeader } from './annotation-log'
import {
  buildInlineShare,
  buildUrlPairShare,
  type ShareHandle,
} from './share-url'
import {
  db,
  deriveDocKey,
  legacyEventsForDoc,
  dexieSink,
  type StoredDocument,
} from './docstore'

export interface ShareInputs {
  /** Document the share is for. */
  doc: StoredDocument
  /** Origin used to build the share URL — usually `window.location.origin`. */
  origin: string
  /** Public URL where the doc can be fetched. Optional — if omitted we
   *  produce a download-only share (no URL is meaningful). */
  publicDocUrl?: string
  /** Optional explicit author identifier for the WAL header. */
  createdBy?: string
  /** Soft cap for inline-tier overflow detection (default 8 KB). */
  maxInlineBytes?: number
}

export interface BuiltShare {
  /** The full JSONL WAL (header + events) ready to write to a sidecar. */
  wal: string
  /** Sidecar file basename (e.g. `.foo.md.annot`). */
  sidecarFileName: string
  /** Total event count (excluding header). */
  eventCount: number
  /** Materialized counts for UI display. */
  highlightCount: number
  commentCount: number
  /** A share URL when `publicDocUrl` was provided; null otherwise. */
  url: string | null
  /** Tier picked for the URL ('inline' or 'url-pair' or null). */
  urlKind: ShareHandle['kind'] | null
  /** True when we tried inline but it overflowed and fell back to url-pair. */
  inlineOverflowed: boolean
  /** Approximate gzip-uncompressed byte size of the WAL. */
  bytes: number
}

/**
 * Project the current document's annotations into a portable WAL and pick
 * the right share URL tier. The tier picker:
 *   1. If publicDocUrl + WAL ≤ inline cap → inline-encoded share.
 *   2. Else if publicDocUrl present → URL-pair share (recipient sibling-resolves).
 *   3. Else null URL — caller can still download the WAL.
 */
export async function buildShareForDocument(input: ShareInputs): Promise<BuiltShare> {
  const docKey = deriveDocKey(input.doc)
  const events = await collectAnnotationEvents(input.doc.id!, docKey)

  // Header carries doc identity so a recipient can detect drift between
  // the live doc and the version the share was authored against.
  const header = makeHeader({
    docKey,
    title: input.doc.fileName,
    contentHash: input.doc.contentHash,
    source: input.publicDocUrl,
    createdBy: input.createdBy,
  })

  const wal = encodeWal([header, ...events])
  const sidecarFileName = sidecarBasename(input.doc.fileName)

  let url: string | null = null
  let urlKind: ShareHandle['kind'] | null = null
  let inlineOverflowed = false

  if (input.publicDocUrl) {
    const inline = buildInlineShare({
      origin: input.origin,
      docUrl: input.publicDocUrl,
      walJsonl: wal,
      docHash: input.doc.contentHash ? `sha256:${input.doc.contentHash}` : undefined,
      maxBytes: input.maxInlineBytes,
    })
    if (!inline.overflow) {
      url = inline.url
      urlKind = 'inline'
    } else {
      inlineOverflowed = true
      url = buildUrlPairShare({
        origin: input.origin,
        docUrl: input.publicDocUrl,
        docHash: input.doc.contentHash ? `sha256:${input.doc.contentHash}` : undefined,
      })
      urlKind = 'url-pair'
    }
  }

  // Materialize for UI counts — pure in-memory replay, no Dexie I/O.
  const state = materialize([header, ...events])
  return {
    wal,
    sidecarFileName,
    eventCount: events.length,
    highlightCount: state.highlights.size,
    commentCount: state.comments.size,
    url,
    urlKind,
    inlineOverflowed,
    bytes: wal.length,
  }
}

/**
 * Combine the persisted log + the legacy projection so a doc that's never
 * had a share yet still produces a useful WAL on first publish. Dedupe by
 * (id, op) so an event present in both sources is kept once.
 *
 * NOTE: reads from dexieSink only. In file mode the authoritative WAL
 * is in the `.annot` sidecar but this function still works because
 * FileRoutedAdapter keeps the legacy tables populated, so
 * legacyEventsForDoc captures the current state. Intermediate history
 * is lost; only the final snapshot is shareable. v1 tradeoff — fix by
 * resolving via AnnotationSinkRouter when share-flow needs full WAL.
 */
async function collectAnnotationEvents(docId: number, docKey: string): Promise<AnnotationEvent[]> {
  const [persisted, legacy] = await Promise.all([
    dexieSink.listEvents(docKey),
    legacyEventsForDoc(docId, docKey),
  ])
  const all = [...persisted.map((p) => p.event), ...legacy]
  const seen = new Map<string, AnnotationEvent>()
  for (const e of all) seen.set(`${e.id}|${e.op}`, e)
  return [...seen.values()].sort((a, b) => a.ts - b.ts)
}

/**
 * Convert `foo.md` → `.foo.md.annot`. The leading dot mirrors the
 * convention agreed in 03-storage-topology.md.
 */
export function sidecarBasename(docFileName: string): string {
  const cleaned = docFileName.replace(/^\.+/, '')
  return `.${cleaned}.annot`
}

/**
 * Trigger a download in the browser. Uses URL.createObjectURL +
 * temporary anchor — no DOM permanence.
 */
export function downloadSidecar(filename: string, content: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return
  const blob = new Blob([content], { type: 'application/x-ndjson' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 0)
}

/**
 * Import remote events into local Dexie so the existing UI (which reads
 * legacy tables) renders them. Used by the Fork action and by the share
 * URL loader. Idempotent: skips events whose materialized rows already
 * exist (matched by anchor+text for highlights, anchor+body for comments).
 */
export async function importRemoteEventsToLocal(args: {
  doc: StoredDocument
  events: AnnotationEvent[]
  defaultAuthor?: string
}): Promise<{ highlightsAdded: number; commentsAdded: number }> {
  const { doc, events, defaultAuthor } = args
  const docId = doc.id!
  const log = new AnnotationLog(deriveDocKey(doc), dexieSink, 'import')
  await log.hydrate(events)

  // Pull existing legacy rows for dedup.
  const [hRows, cRows] = await Promise.all([
    db.highlights.where('docId').equals(docId).toArray(),
    db.comments.where('docId').equals(docId).toArray(),
  ])
  const existingHl = new Set(hRows.map((h) => `${h.startOffset}|${h.endOffset}|${h.text}`))
  const existingCm = new Set(cRows.map((c) => `${c.sectionId}|${c.selectedText}|${c.comment}`))

  let highlightsAdded = 0
  let commentsAdded = 0

  for (const h of log.highlights) {
    const start = h.anchor.byteOffset ?? h.anchor.markdownStart ?? 0
    const text = h.anchor.exact ?? h.anchor.text ?? ''
    const end = h.anchor.markdownEnd ?? start + text.length
    const key = `${start}|${end}|${text}`
    if (existingHl.has(key)) continue
    await db.highlights.add({
      docId,
      text,
      startOffset: start,
      endOffset: end,
      color: h.color,
      note: h.note ?? '',
      createdAt: h.createdAt,
      anchor: hasFullAnchor(h.anchor) ? h.anchor : undefined,
    })
    highlightsAdded++
  }

  for (const c of log.comments) {
    const key = `${c.sectionId}|${c.selectedText}|${c.body}`
    if (existingCm.has(key)) continue
    await db.comments.add({
      docId,
      selectedText: c.selectedText,
      comment: c.body,
      author: c.author || defaultAuthor || 'Imported',
      sectionId: c.sectionId,
      createdAt: c.createdAt,
      resolved: c.resolved,
      anchor: hasFullAnchor(c.anchor) ? c.anchor : undefined,
    })
    commentsAdded++
  }

  return { highlightsAdded, commentsAdded }
}

function hasFullAnchor(a: { markdownStart?: number; markdownEnd?: number; exact?: string }): a is import('./anchor').TextAnchor {
  return typeof a.markdownStart === 'number' && typeof a.markdownEnd === 'number' && typeof a.exact === 'string'
}
