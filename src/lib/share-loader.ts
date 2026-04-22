/**
 * Share intake — given the browser's current URL, fetch the doc and any
 * accompanying annotations and bring them into the local store. Decoupled
 * from React so the same code path is reachable from MCP, the URL bar,
 * and tests.
 */

import {
  defaultRemoteAdapter,
  type RemoteDocumentAdapter,
} from './remote-document'
import { parseShareUrl, type ShareHandle } from './share-url'
import { addDocument, getDocument, deriveDocKey } from './docstore'
import { importRemoteEventsToLocal } from './share-builder'
import type { AnnotationEvent, HeaderEvent } from './annotation-events'
import type { RemoteShareState } from '../store/useStore'

export interface LoadShareResult {
  /** The handle that was parsed and acted on. */
  handle: ShareHandle
  /** Local Dexie id for the (possibly newly imported) document. */
  docId: number
  /** Markdown body of the loaded document. */
  markdown: string
  fileName: string
  /** Imported event count (after dedup against existing local rows). */
  eventsImported: number
  highlightsAdded: number
  commentsAdded: number
  /** Banner data ready to drop into the store. */
  banner: RemoteShareState
}

export interface LoadShareOptions {
  href?: string
  adapter?: RemoteDocumentAdapter
  /** When true, drop the URL hash after a successful load so a refresh
   *  doesn't re-prompt the same import. Default true. */
  consumeHash?: boolean
}

/**
 * Returns null when the current URL has no share params — caller should
 * fall through to its existing intake (Upload, library list, …).
 */
export async function loadShareFromHash(opts: LoadShareOptions = {}): Promise<LoadShareResult | null> {
  const adapter = opts.adapter ?? defaultRemoteAdapter()
  const href = opts.href ?? (typeof window !== 'undefined' ? window.location.href : '')
  const handle = parseShareUrl({ href })
  if (!handle) return null

  // Folder shares (github-repo with no `path` to a .md) are out of scope
  // for v1 — caller routes those through the collection UI later.
  if (handle.kind === 'github-repo' && !handle.repo?.path?.endsWith('.md')) {
    return null
  }

  const remoteDoc = await adapter.fetchDocument(handle)
  const events = await adapter.fetchAnnotations(handle)

  // Add (or dedupe to existing) the doc into Dexie. addDocument's
  // contentHash dedupe means re-opening a share doesn't multiply rows.
  const { docId } = await addDocument(remoteDoc.fileName, remoteDoc.markdown, { skipPostProcessing: true })
  const doc = await getDocument(docId)
  if (!doc) throw new Error('Document insert succeeded but lookup failed — Dexie state inconsistent')

  // Import remote events as local rows so the existing UI renders them.
  const importResult = await importRemoteEventsToLocal({ doc, events })

  // Drift detection: if the share carried a contentHash but the fetched
  // doc hashes to something else, surface it on the banner.
  const docKey = deriveDocKey(doc)
  const driftWarning = !!handle.docHash && !!doc.contentHash &&
    handle.docHash.replace(/^sha256:/, '') !== doc.contentHash

  // Pull header info if present so the banner can show "by Manu".
  const header = events.find((e) => e.op === 'header') as HeaderEvent | undefined
  const counts = countMaterialized(events)

  const banner: RemoteShareState = {
    sourceUrl: remoteDoc.sourceUrl,
    shareUrl: href,
    createdBy: header?.createdBy ?? null,
    highlightCount: counts.highlights,
    commentCount: counts.comments,
    forked: false,
    driftWarning,
  }

  if (opts.consumeHash !== false && typeof window !== 'undefined') {
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    } catch {
      // best-effort
    }
  }

  // Suppress unused-var warning until the field is wired downstream.
  void docKey

  return {
    handle,
    docId,
    markdown: remoteDoc.markdown,
    fileName: remoteDoc.fileName,
    eventsImported: events.length,
    highlightsAdded: importResult.highlightsAdded,
    commentsAdded: importResult.commentsAdded,
    banner,
  }
}

function countMaterialized(events: AnnotationEvent[]): { highlights: number; comments: number } {
  let highlights = 0
  let comments = 0
  // Cheap counter: tally adds minus dels. Replay would be safer but we
  // already replayed via importRemoteEventsToLocal — this is just for the
  // banner display.
  const hAlive = new Set<string>()
  const cAlive = new Set<string>()
  for (const e of events) {
    if (e.op === 'highlight.add') hAlive.add(e.id)
    else if (e.op === 'highlight.del') hAlive.delete(e.id)
    else if (e.op === 'comment.add') cAlive.add(e.id)
    else if (e.op === 'comment.del') cAlive.delete(e.id)
  }
  highlights = hAlive.size
  comments = cAlive.size
  return { highlights, comments }
}
