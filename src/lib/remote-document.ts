/**
 * Remote document fetch — turn a parsed ShareHandle into the markdown +
 * annotation events ready to materialize. The adapter is a small interface
 * so embedders can swap in their own transport (CDN, internal API, IPFS).
 */

import { decodeWal, type AnnotationEvent } from './annotation-events'
import {
  ensureSafeFetchUrl,
  normalizeGithubUrl,
  siblingAnnotUrl,
  base64urlDecode,
  parseShareUrl as parseHashShareUrl,
  type ShareHandle,
} from './share-url'

export interface RemoteDocument {
  markdown: string
  fileName: string
  contentHash?: string
  sourceUrl: string
}

export interface FolderEntry {
  path: string
  name: string
  type: 'file' | 'dir'
  url: string
}

export interface RemoteDocumentAdapter {
  parseShareUrl(href: string): ShareHandle | null
  fetchDocument(handle: ShareHandle): Promise<RemoteDocument>
  fetchAnnotations(handle: ShareHandle): Promise<AnnotationEvent[]>
  listFolder?(handle: ShareHandle): Promise<FolderEntry[]>
}

const FETCH_TIMEOUT_MS = 30_000
const MAX_DOC_BYTES = 10 * 1024 * 1024
const MAX_ANNOT_BYTES = 5 * 1024 * 1024

/**
 * HTTP-backed remote adapter. Handles Tier 1 (inline-encoded WAL) and
 * Tier 2 (URL pair, with sibling auto-resolve when annot is omitted).
 * Tier 3 (GitHub repo) lives in a sibling adapter so this file stays
 * narrow; the unified factory below picks the right one per share kind.
 */
export class HttpRemoteAdapter implements RemoteDocumentAdapter {
  parseShareUrl(href: string): ShareHandle | null {
    return parseHashShareUrl({ href })
  }

  async fetchDocument(handle: ShareHandle): Promise<RemoteDocument> {
    const docUrl = handle.docUrl
    if (!docUrl) throw new Error('Share handle has no document URL')

    const normalized = normalizeGithubUrl(docUrl)
    const safe = ensureSafeFetchUrl(normalized)
    if (!safe.ok) throw new Error(`Refusing to fetch: ${safe.reason}`)
    const target = safe.url!

    const res = await fetchWithLimits(target, MAX_DOC_BYTES)
    const text = await res.text()
    const fileName = guessFileName(target)
    return {
      markdown: text,
      fileName,
      sourceUrl: target,
      contentHash: handle.docHash,
    }
  }

  async fetchAnnotations(handle: ShareHandle): Promise<AnnotationEvent[]> {
    if (handle.kind === 'inline' && handle.inlineAnnot) {
      // Best-effort decode; corrupt inline data shouldn't block the doc
      // from rendering. We log and degrade.
      try {
        const text = base64urlDecode(handle.inlineAnnot)
        return decodeWal(text)
      } catch (e) {
        console.warn('[md-reader] failed to decode inline share annotations', e)
        return []
      }
    }

    const annotUrl = handle.annotUrl ?? (handle.docUrl ? siblingAnnotUrl(handle.docUrl) : null)
    if (!annotUrl) return []

    const safe = ensureSafeFetchUrl(annotUrl)
    if (!safe.ok) return []

    try {
      const res = await fetchWithLimits(safe.url!, MAX_ANNOT_BYTES, { allow404: true })
      if (!res || res.status === 404) return []
      const text = await res.text()
      return decodeWal(text)
    } catch (e) {
      // R4 from the design: missing/unreachable sidecar must NOT block the
      // doc render. Log and return empty.
      console.warn('[md-reader] sidecar annotation fetch failed; rendering without annotations', e)
      return []
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface FetchOpts {
  allow404?: boolean
}

async function fetchWithLimits(url: string, maxBytes: number, opts: FetchOpts = {}): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) {
    if (opts.allow404 && res.status === 404) return res
    throw new Error(`HTTP ${res.status} for ${url}`)
  }
  const lenHeader = res.headers.get('content-length')
  if (lenHeader) {
    const len = parseInt(lenHeader, 10)
    if (Number.isFinite(len) && len > maxBytes) {
      throw new Error(`Response too large: ${len} > ${maxBytes} bytes`)
    }
  }
  return res
}

function guessFileName(url: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').pop() || 'document.md'
    return last || 'document.md'
  } catch {
    return 'document.md'
  }
}

/**
 * GitHub-flavored remote adapter. Handles Tier 3: `#repo=owner/name&path=&ref=`.
 * Composes the raw URLs and reuses HttpRemoteAdapter for the actual fetch.
 */
export class GithubRemoteAdapter implements RemoteDocumentAdapter {
  private readonly http = new HttpRemoteAdapter()

  parseShareUrl(href: string): ShareHandle | null {
    return this.http.parseShareUrl(href)
  }

  async fetchDocument(handle: ShareHandle): Promise<RemoteDocument> {
    if (handle.kind !== 'github-repo' || !handle.repo) {
      return this.http.fetchDocument(handle)
    }
    const { owner, name, ref, path } = handle.repo
    const url = `https://raw.githubusercontent.com/${owner}/${name}/${ref}/${path}`
    return this.http.fetchDocument({ ...handle, kind: 'url-pair', docUrl: url })
  }

  async fetchAnnotations(handle: ShareHandle): Promise<AnnotationEvent[]> {
    if (handle.kind !== 'github-repo' || !handle.repo) {
      return this.http.fetchAnnotations(handle)
    }
    const { owner, name, ref, path } = handle.repo
    const docUrl = `https://raw.githubusercontent.com/${owner}/${name}/${ref}/${path}`
    return this.http.fetchAnnotations({ ...handle, kind: 'url-pair', docUrl })
  }

  async listFolder(handle: ShareHandle): Promise<FolderEntry[]> {
    if (handle.kind !== 'github-repo' || !handle.repo) return []
    const { owner, name, ref, path } = handle.repo
    // GitHub Contents API. Returns an array for directories, an object for files.
    const url = `https://api.github.com/repos/${owner}/${name}/contents/${path}?ref=${encodeURIComponent(ref)}`
    const safe = ensureSafeFetchUrl(url)
    if (!safe.ok) return []
    try {
      const res = await fetch(safe.url!, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) return []
      const data = await res.json() as Array<{ name: string; path: string; type: string; download_url?: string }>
      if (!Array.isArray(data)) return []
      return data
        .filter((e) => e.type === 'file' && e.name.endsWith('.md') || e.type === 'dir')
        .map((e) => ({
          path: e.path,
          name: e.name,
          type: e.type === 'dir' ? 'dir' : 'file',
          url: e.download_url ?? `https://raw.githubusercontent.com/${owner}/${name}/${ref}/${e.path}`,
        }))
    } catch {
      return []
    }
  }
}

/**
 * Default factory: returns the adapter that knows how to handle the share
 * kind. Embedders can override at provider time.
 */
export function defaultRemoteAdapter(): RemoteDocumentAdapter {
  const http = new HttpRemoteAdapter()
  const github = new GithubRemoteAdapter()
  return {
    parseShareUrl: (href) => http.parseShareUrl(href),
    fetchDocument: (handle) => (handle.kind === 'github-repo' ? github.fetchDocument(handle) : http.fetchDocument(handle)),
    fetchAnnotations: (handle) => (handle.kind === 'github-repo' ? github.fetchAnnotations(handle) : http.fetchAnnotations(handle)),
    listFolder: (handle) => github.listFolder(handle),
  }
}
