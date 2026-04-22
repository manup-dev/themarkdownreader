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
import { materialize, type HeaderEvent } from './annotation-events'
import type { RemoteShareState } from '../store/useStore'

export interface LoadShareResult {
  kind: 'doc'
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

/** Emitted when the share URL is a folder (repo + non-.md path). The
 *  caller routes these into the RepoBrowser UI — no doc load happens. */
export interface FolderShareResult {
  kind: 'folder'
  handle: ShareHandle
  /** The original href with share params intact, to seed RepoBrowser. */
  href: string
}

export type ShareIntakeResult = LoadShareResult | FolderShareResult

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
export async function loadShareFromHash(opts: LoadShareOptions = {}): Promise<ShareIntakeResult | null> {
  const adapter = opts.adapter ?? defaultRemoteAdapter()
  const href = opts.href ?? (typeof window !== 'undefined' ? window.location.href : '')
  const handle = parseShareUrl({ href })
  if (!handle) return null

  // Folder shares (github-repo with no `path` to a .md) return a tagged
  // result rather than null, so the caller can route them directly to
  // the RepoBrowser without duplicating the kind-sniff regex.
  if (handle.kind === 'github-repo' && !handle.repo?.path?.endsWith('.md')) {
    return { kind: 'folder', handle, href }
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
  // Full replay so a WAL starting with a checkpoint op contributes the
  // checkpointed highlights/comments to the banner count, not just the
  // tail add/del ops.
  const state = materialize(events)

  const banner: RemoteShareState = {
    sourceUrl: remoteDoc.sourceUrl,
    shareUrl: href,
    createdBy: header?.createdBy ?? null,
    highlightCount: state.highlights.size,
    commentCount: state.comments.size,
    forked: false,
    driftWarning,
    originalEvents: events,
    docId,
  }

  if (opts.consumeHash !== false && typeof window !== 'undefined') {
    try {
      const url = new URL(window.location.href)
      const SHARE_KEYS = new Set(['url', 'annot', 'repo', 'path', 'ref', 'hash'])
      // Strip *only* share params from the fragment; preserve any
      // app-level routing (e.g. `#read/section=intro`) the user arrived
      // with. Replacing the whole hash would nuke deep-linking state.
      const rawHash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
      const qIdx = rawHash.indexOf('?')
      let head = rawHash
      let tail = ''
      if (qIdx >= 0) { head = rawHash.slice(0, qIdx); tail = rawHash.slice(qIdx + 1) }
      // If there's no `?`, the whole hash might be a param string.
      const isParamOnly = /^(url|annot|repo|path|ref|hash)=/.test(rawHash)
      const params = new URLSearchParams(isParamOnly ? rawHash : tail)
      for (const k of [...params.keys()]) if (SHARE_KEYS.has(k)) params.delete(k)
      const remaining = params.toString()
      let newHash = ''
      if (isParamOnly) {
        newHash = remaining ? `#${remaining}` : ''
      } else {
        newHash = head
          ? (remaining ? `#${head}?${remaining}` : `#${head}`)
          : (remaining ? `#${remaining}` : '')
      }
      window.history.replaceState(null, '', url.pathname + url.search + newHash)
    } catch {
      // best-effort
    }
  }

  // Suppress unused-var warning until the field is wired downstream.
  void docKey

  return {
    kind: 'doc',
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
