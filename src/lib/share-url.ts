/**
 * Share URL parsing and serializing. The hash carries everything we need
 * to open a remote annotated read — there is no backend.
 *
 * Three tiers, identified by which params are present:
 *   - inline      → `#url=<doc>&annot=<base64-jsonl>`         (≤ ~8KB annot)
 *   - url-pair    → `#url=<doc>&annot=<annot-url>`            (default)
 *   - github-repo → `#repo=<owner/name>&path=<sub>&ref=<sha>` (collection)
 *
 * Sibling auto-resolution: if `#url=` is given without `#annot=`, callers
 * derive the sidecar URL from the doc URL by inserting a leading dot
 * before the basename — e.g. `…/foo.md` → `…/.foo.md.annot`.
 *
 * SSRF safety lives here too so anything calling out over HTTP shares the
 * same guard. The Upload flow has its own copy that predates this module
 * — that copy stays untouched to keep the refactor surface tiny.
 */

export type ShareKind = 'url-pair' | 'inline' | 'github-repo' | 'unknown'

export interface ShareHandle {
  kind: ShareKind
  /** Direct URL to a markdown document (Tier 1/2). */
  docUrl?: string
  /** Direct URL to an annotation sidecar (Tier 2). */
  annotUrl?: string
  /** Inline base64url-encoded JSONL WAL (Tier 1). */
  inlineAnnot?: string
  /** Optional content-hash hint for staleness banner. */
  docHash?: string
  /** GitHub handshake (Tier 3). */
  repo?: { owner: string; name: string; ref: string; path: string }
}

export interface ParseShareUrlOptions {
  /** Defaults to window.location.href when running in a browser. */
  href?: string
}

/**
 * Returns null when the hash carries no shareable info. Callers can fall
 * through to other intake paths (file upload, Library) without a special
 * case.
 */
export function parseShareUrl(opts: ParseShareUrlOptions = {}): ShareHandle | null {
  const href = opts.href ?? (typeof window !== 'undefined' ? window.location.href : '')
  if (!href) return null

  let hash = ''
  try {
    const u = new URL(href)
    hash = u.hash
  } catch {
    return null
  }
  if (!hash || hash.length < 2) return null

  // The app already uses fragments like `#read/section=…` for routing, so
  // we tolerate non-share hashes by extracting only key=value pairs after
  // the first `?` or after a `&`-separated tail. The compatible shapes are:
  //   #url=…            → take the param tail
  //   #read?url=…       → take after the `?`
  //   #anything&url=…   → take after the first `&`
  let paramString = hash.slice(1)
  const qIdx = paramString.indexOf('?')
  if (qIdx >= 0) paramString = paramString.slice(qIdx + 1)
  // If the first segment isn't a known key, look past it.
  if (!/^(url|annot|repo|path|ref|hash)=/.test(paramString)) {
    const ampIdx = paramString.indexOf('&')
    if (ampIdx < 0) return null
    paramString = paramString.slice(ampIdx + 1)
    if (!/^(url|annot|repo|path|ref|hash)=/.test(paramString)) return null
  }

  const params = new URLSearchParams(paramString)
  const docUrl = params.get('url') ?? undefined
  const annot = params.get('annot') ?? undefined
  const repo = params.get('repo') ?? undefined
  const path = params.get('path') ?? ''
  const ref = params.get('ref') ?? 'main'
  const docHash = params.get('hash') ?? undefined

  if (repo) {
    const m = repo.match(/^([^/]+)\/([^/]+)$/)
    if (!m) return null
    return {
      kind: 'github-repo',
      repo: { owner: m[1], name: m[2], ref, path },
    }
  }

  if (!docUrl) return null

  // Tier discrimination: inline annot is base64url (no scheme), URL-pair
  // is an absolute http(s) URL.
  if (annot && /^https?:\/\//i.test(annot)) {
    return { kind: 'url-pair', docUrl, annotUrl: annot, docHash }
  }
  if (annot) {
    return { kind: 'inline', docUrl, inlineAnnot: annot, docHash }
  }
  return { kind: 'url-pair', docUrl, docHash }
}

/**
 * Build a Tier 2 (URL-pair) share URL. Annot is optional; if absent,
 * the recipient relies on sibling auto-resolution.
 */
export function buildUrlPairShare(args: {
  origin: string
  docUrl: string
  annotUrl?: string
  docHash?: string
}): string {
  const params = new URLSearchParams()
  params.set('url', args.docUrl)
  if (args.annotUrl) params.set('annot', args.annotUrl)
  if (args.docHash) params.set('hash', args.docHash)
  return `${args.origin}/#${params.toString()}`
}

/**
 * Build a Tier 1 (inline) share URL. Caller passes the JSONL WAL as a
 * raw string; we base64url-encode it. Bytes-aware to avoid surprising
 * inflation on multibyte characters.
 */
export function buildInlineShare(args: {
  origin: string
  docUrl: string
  walJsonl: string
  docHash?: string
  /** Soft cap on the encoded URL; default 8 KB to stay messenger-safe. */
  maxBytes?: number
}): { url: string; bytes: number; overflow: boolean } {
  const encoded = base64urlEncode(args.walJsonl)
  const params = new URLSearchParams()
  params.set('url', args.docUrl)
  params.set('annot', encoded)
  if (args.docHash) params.set('hash', args.docHash)
  const url = `${args.origin}/#${params.toString()}`
  const bytes = url.length
  const cap = args.maxBytes ?? 8192
  return { url, bytes, overflow: bytes > cap }
}

export function buildGithubRepoShare(args: {
  origin: string
  owner: string
  name: string
  path?: string
  ref?: string
}): string {
  const params = new URLSearchParams()
  params.set('repo', `${args.owner}/${args.name}`)
  if (args.path) params.set('path', args.path)
  if (args.ref) params.set('ref', args.ref)
  return `${args.origin}/#${params.toString()}`
}

/**
 * Derive the conventional sidecar URL for a markdown URL by inserting a
 * leading dot before the basename and appending `.annot`. Returns null
 * when the URL has no derivable basename (e.g. ends in `/`).
 */
export function siblingAnnotUrl(docUrl: string): string | null {
  try {
    const u = new URL(docUrl)
    const segments = u.pathname.split('/')
    const file = segments.pop()
    if (!file) return null
    segments.push(`.${file}.annot`)
    u.pathname = segments.join('/')
    return u.toString()
  } catch {
    return null
  }
}

/**
 * Auto-rewrite well-known GitHub HTML URLs to their raw equivalents so
 * recipients don't have to remember to paste the raw URL. Mirror of the
 * logic in Upload.tsx so the share path agrees with the manual fetch
 * path.
 */
export function normalizeGithubUrl(url: string): string {
  const m = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)/)
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}` : url
}

// ─── SSRF safety ────────────────────────────────────────────────────────────

const PRIVATE_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/,
  /^127\.0\.0\.1$/,
  /^0\.0\.0\.0$/,
  /^192\.168\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /\.local$/,
  /^::1$/,
  /^::$/,
  /^::ffff:127\./,
  /^::ffff:10\./,
  /^::ffff:192\.168\./,
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./,
  /^fe80:/,
  /^fc00:/,
  /^fd/,
]

export interface SafeUrlResult {
  ok: boolean
  url?: string
  reason?: string
}

/**
 * Validates and normalizes a URL for outbound fetch. Strips file://,
 * private/local hosts, and forces https when http was given. Returns the
 * sanitized URL string on success.
 */
export function ensureSafeFetchUrl(input: string): SafeUrlResult {
  let target = input.trim()
  if (!target) return { ok: false, reason: 'empty URL' }
  // Reject dangerous schemes before any protocol-prepending. Without this
  // check `file://x` would be rewritten to `https://file://x` and pass.
  if (/^(file|javascript|data|blob|chrome|chrome-extension):/i.test(target)) {
    return { ok: false, reason: `${target.split(':')[0]}: URLs not allowed` }
  }
  if (!target.startsWith('http://') && !target.startsWith('https://')) {
    target = 'https://' + target
  } else if (target.startsWith('http://')) {
    target = target.replace(/^http:\/\//, 'https://')
  }
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return { ok: false, reason: 'invalid URL' }
  }
  if (parsed.protocol === 'file:') return { ok: false, reason: 'file:// URLs not allowed' }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'only http(s) URLs allowed' }
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (PRIVATE_HOSTNAME_PATTERNS.some((p) => p.test(hostname))) {
    return { ok: false, reason: 'private/local hosts not allowed' }
  }
  return { ok: true, url: parsed.toString() }
}

// ─── base64url ──────────────────────────────────────────────────────────────

/**
 * UTF-8-aware base64url. Standard `btoa` only handles latin-1, so we
 * encode through TextEncoder first. Output is URL-safe (no +/=).
 */
export function base64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const std = typeof btoa !== 'undefined' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64')
  return std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64urlDecode(encoded: string): string {
  const std = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4)
  const bin = typeof atob !== 'undefined'
    ? atob(padded)
    : Buffer.from(padded, 'base64').toString('binary')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}
