// Section deep-link hash read/write (B14). URLSearchParams percent-encodes
// values in toString(), so callers must NOT pre-encode — the old writer's
// encodeURIComponent + URLSearchParams double-encoded non-ASCII section ids,
// which the single-decode parser could then never resolve.

/** Build a `#read?…&section=…` hash, preserving existing query params (f=, tab=). */
export function buildSectionHash(currentHash: string, sectionId: string): string {
  const qIdx = currentHash.indexOf('?')
  const existingQuery = qIdx === -1 ? '' : currentHash.slice(qIdx + 1)
  const params = new URLSearchParams(existingQuery)
  params.set('section', sectionId) // URLSearchParams encodes exactly once
  return `#read?${params.toString()}`
}

/**
 * Extract the section id from a hash. Accepts the query form
 * (`#read?section=…`, `#read?f=…&section=…`) and the legacy path form
 * (`#read/section=…`). Returns the decoded id, or null.
 */
export function parseSectionFromHash(hash: string): string | null {
  const qIdx = hash.indexOf('?')
  if (qIdx !== -1) {
    const params = new URLSearchParams(hash.slice(qIdx + 1))
    const fromQuery = params.get('section')
    if (fromQuery) return fromQuery
  }
  const legacy = hash.match(/#read\/section=([^&]+)/)
  if (legacy) {
    try { return decodeURIComponent(legacy[1]) } catch { return legacy[1] }
  }
  return null
}
