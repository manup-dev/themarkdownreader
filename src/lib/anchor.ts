import { extractToc, slugify } from './markdown'

export interface ResolvedRange {
  startNode: Text
  startOffset: number
  endNode: Text
  endOffset: number
  text: string  // the matched text for verification
}

export interface TextAnchor {
  markdownStart: number    // char offset in raw markdown (primary key)
  markdownEnd: number
  exact: string            // the selected text
  prefix: string           // up to 30 chars before selection in markdown
  suffix: string           // up to 30 chars after selection in markdown
  sectionId: string        // nearest heading ID (slug)
  offsetInSection: number  // char offset from section heading start
  // Diff-friendly coordinates added 2026-04 for the share/WAL system. All
  // optional so old anchors (and consumers that don't compute them) keep
  // working. line:word survives whitespace edits; len lets us cross-check
  // a recovered range without re-running the heavy fuzzy match.
  line?: number            // 0-indexed line in raw markdown
  word?: number            // 0-indexed word index within the line
  len?: number             // word count of the selection (1+)
}

/**
 * Compute (line, word, len) coordinates from a markdown char offset. Used
 * by captureAnchor and exposed for tests + the WAL legacy projection. A
 * "word" is a maximal run of non-whitespace characters; this matches the
 * design choice in 02-anchoring-model.md.
 */
export function lineWordFromOffset(
  markdown: string,
  start: number,
  end: number,
): { line: number; word: number; len: number } {
  const safeStart = Math.max(0, Math.min(start, markdown.length))
  const safeEnd = Math.max(safeStart, Math.min(end, markdown.length))

  // Line index: count newlines before start
  let line = 0
  let lineStart = 0
  for (let i = 0; i < safeStart; i++) {
    if (markdown.charCodeAt(i) === 10 /* \n */) {
      line++
      lineStart = i + 1
    }
  }

  // Word index within the line: index of the word containing safeStart.
  // A word starts at a non-whitespace char that's at lineStart or preceded
  // by whitespace. We count word starts at positions ≤ safeStart and
  // return that count − 1 (so the first word on the line is index 0).
  let word = -1
  for (let i = lineStart; i <= safeStart && i < markdown.length; i++) {
    const ch = markdown.charCodeAt(i)
    if (ch === 10 /* \n */) break
    const isWs = ch === 32 || ch === 9 /* space or tab */
    if (!isWs) {
      const prevCh = i > lineStart ? markdown.charCodeAt(i - 1) : 0
      const prevIsWs = prevCh === 32 || prevCh === 9
      if (i === lineStart || prevIsWs) word++
    }
  }
  if (word < 0) word = 0

  // Length: number of words in the selection
  const selection = markdown.slice(safeStart, safeEnd)
  const trimmed = selection.trim()
  const len = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length

  return { line, word, len }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Find all positions of a pattern in a string.
 */
function findAllPositions(haystack: string, needle: string): number[] {
  const positions: number[] = []
  let start = 0
  while (true) {
    const idx = haystack.indexOf(needle, start)
    if (idx === -1) break
    positions.push(idx)
    start = idx + 1
  }
  return positions
}

/**
 * Build a map of heading positions in the markdown: an array of
 * { start: number, id: string } sorted by start position.
 */
function buildSectionMap(markdown: string): Array<{ start: number; id: string }> {
  const toc = extractToc(markdown)
  const sections: Array<{ start: number; id: string }> = []
  const slugCounts = new Map<string, number>()

  // extractToc uses the same slug dedup logic — we need to replicate
  // the heading-level dedup as we scan raw positions.
  const headingRegex = /^#{1,6}\s+(.+)$/gm
  let match: RegExpExecArray | null

  // We track slug dedup ourselves to match extractToc exactly
  const localSlugCounts = new Map<string, number>()

  while ((match = headingRegex.exec(markdown)) !== null) {
    const text = match[1].trim()
    let slug = slugify(text)
    const count = localSlugCounts.get(slug) ?? 0
    localSlugCounts.set(slug, count + 1)
    if (count > 0) slug = `${slug}-${count}`
    sections.push({ start: match.index, id: slug })
  }

  // Suppress unused variable warning — toc is only used for its side-effect
  void toc
  void slugCounts

  return sections
}

/**
 * Given a position in the markdown, return the nearest preceding section id
 * and the offset from that section's heading start.
 */
function resolveSection(
  position: number,
  sections: Array<{ start: number; id: string }>,
): { sectionId: string; offsetInSection: number } {
  let best: { start: number; id: string } | null = null
  for (const section of sections) {
    if (section.start <= position) {
      best = section
    }
  }
  if (!best) {
    return { sectionId: '', offsetInSection: 0 }
  }
  return { sectionId: best.id, offsetInSection: position - best.start }
}

/**
 * Whitespace-normalize a string: collapse all \s+ runs into a single space.
 */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Try to find `searchText` in `markdown` after collapsing whitespace.
 * Returns the raw markdown start/end of the match, or null if not found.
 */
function normalizedSearch(markdown: string, searchText: string): { start: number; end: number } | null {
  const normalizedSearch = normalize(searchText)
  if (!normalizedSearch) return null

  // Build a regex that matches the normalized words with arbitrary whitespace between
  const words = normalizedSearch.split(' ').map(escapeRegex)
  const pattern = words.join('\\s+')
  const regex = new RegExp(pattern)
  const m = regex.exec(markdown)
  if (!m) return null
  return { start: m.index, end: m.index + m[0].length }
}

/**
 * captureAnchor: create a TextAnchor for `selectedText` within `markdown`.
 *
 * @param markdown       The full raw markdown string
 * @param selectedText   The text the user selected
 * @param sectionIdHint  Optional: the section id the selection is believed to be in.
 *                       Used to disambiguate when the same text appears multiple times.
 */
export function captureAnchor(
  markdown: string,
  selectedText: string,
  sectionIdHint?: string,
): TextAnchor {
  const sections = buildSectionMap(markdown)

  // --- Step 1: Try exact match ---
  let start: number
  let end: number
  let exact: string

  const exactPositions = findAllPositions(markdown, selectedText)

  if (exactPositions.length > 0) {
    let chosen = exactPositions[0]

    // Disambiguate using sectionIdHint if provided and text appears multiple times
    if (sectionIdHint && exactPositions.length > 1) {
      for (const pos of exactPositions) {
        const { sectionId } = resolveSection(pos, sections)
        if (sectionId === sectionIdHint) {
          chosen = pos
          break
        }
      }
    }

    start = chosen
    end = chosen + selectedText.length
    exact = selectedText
  } else {
    // --- Step 2: Whitespace-normalized search ---
    const normalizedResult = normalizedSearch(markdown, selectedText)
    if (normalizedResult) {
      start = normalizedResult.start
      end = normalizedResult.end
      exact = markdown.slice(start, end)
    } else {
      // --- Step 3: Fallback ---
      start = 0
      end = 0
      exact = selectedText
    }
  }

  // --- Compute prefix / suffix ---
  const prefix = markdown.slice(Math.max(0, start - 30), start)
  const suffix = markdown.slice(end, end + 30)

  // --- Compute section info ---
  const { sectionId, offsetInSection } = resolveSection(start, sections)

  // --- Compute diff-friendly line/word coords ---
  const { line, word, len } = lineWordFromOffset(markdown, start, end)

  return {
    markdownStart: start,
    markdownEnd: end,
    exact,
    prefix,
    suffix,
    sectionId,
    offsetInSection,
    line,
    word,
    len,
  }
}

// ---------------------------------------------------------------------------
// resolveAnchor helpers
// ---------------------------------------------------------------------------

interface TextNodeEntry {
  node: Text
  /** Start position of this node's content in the concatenated normalized string */
  normStart: number
  /** End position (exclusive) in the normalized string */
  normEnd: number
  /** Mapping from each normalized-string position (relative to normStart) to
   *  the raw offset in node.textContent */
  normToRaw: number[]
}

/**
 * Walk all text nodes under `root` and build a normalized index over them.
 * Returns: { normText, entries } where normText is the whitespace-collapsed
 * concatenation of all text nodes' contents, and entries maps positions in
 * normText back to (node, rawOffset) pairs.
 */
function buildNormIndex(root: HTMLElement): { normText: string; entries: TextNodeEntry[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const entries: TextNodeEntry[] = []
  let normText = ''

  let node = walker.nextNode() as Text | null
  while (node !== null) {
    const raw = node.textContent ?? ''
    // Build normToRaw: for each char position in the normalized output of this
    // node's text, record the corresponding raw index.
    // We collapse \s+ runs into a single space, trimming leading space only if
    // normText already ends with a space.
    const normToRaw: number[] = []
    let normChunk = ''
    let prevWasSpace = normText.length > 0 && normText[normText.length - 1] === ' '

    for (let i = 0; i < raw.length; i++) {
      if (/\s/.test(raw[i])) {
        if (!prevWasSpace) {
          normToRaw.push(i)
          normChunk += ' '
          prevWasSpace = true
        }
        // else skip — collapse the space run
      } else {
        normToRaw.push(i)
        normChunk += raw[i]
        prevWasSpace = false
      }
    }

    const normStart = normText.length
    normText += normChunk
    entries.push({
      node,
      normStart,
      normEnd: normText.length,
      normToRaw,
    })

    node = walker.nextNode() as Text | null
  }

  return { normText, entries }
}

/**
 * Given a position in the normalized text and the entries index, return the
 * corresponding { node, rawOffset }.
 *
 * `isEnd` signals that this is an exclusive end position: prefer ending at the
 * last char of the previous node rather than the first char of the next one.
 */
function normPosToNodeOffset(
  normPos: number,
  entries: TextNodeEntry[],
  isEnd = false,
): { node: Text; rawOffset: number } | null {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (normPos >= entry.normStart && normPos < entry.normEnd) {
      const localNorm = normPos - entry.normStart
      return { node: entry.node, rawOffset: entry.normToRaw[localNorm] }
    }
    // When isEnd and normPos is exactly at this entry's normEnd, end here
    // rather than stepping into the next node.
    if (isEnd && normPos === entry.normEnd && entry.normToRaw.length > 0) {
      const raw = entry.node.textContent ?? ''
      return { node: entry.node, rawOffset: raw.length }
    }
  }
  // normPos == normText.length (end of last node)
  const last = entries[entries.length - 1]
  if (last && normPos === last.normEnd) {
    const raw = last.node.textContent ?? ''
    return { node: last.node, rawOffset: raw.length }
  }
  return null
}

/**
 * Try context search: find `prefix + exact + suffix` in normText (all
 * whitespace-normalised), then extract the exact portion.
 * Returns a ResolvedRange or null.
 */
function contextSearch(
  normText: string,
  entries: TextNodeEntry[],
  anchor: TextAnchor,
): ResolvedRange | null {
  const normPrefix = normalize(anchor.prefix)
  const normExact = normalize(anchor.exact)
  const normSuffix = normalize(anchor.suffix)

  if (!normExact) return null

  // Build a pattern that requires prefix immediately before exact and suffix after.
  // Allow zero or one space at boundaries (the normalizer may or may not emit one).
  const parts: string[] = []
  if (normPrefix) parts.push(escapeRegex(normPrefix))
  parts.push(`(${escapeRegex(normExact)})`)
  if (normSuffix) parts.push(escapeRegex(normSuffix))

  const pattern = parts.join('\\s?')
  const regex = new RegExp(pattern)
  const m = regex.exec(normText)
  if (!m) return null

  // Capture group 1 is the exact portion
  const exactStart = m.index + (m[0].indexOf(m[1]))
  const exactEnd = exactStart + m[1].length

  const startResult = normPosToNodeOffset(exactStart, entries)
  const endResult = normPosToNodeOffset(exactEnd, entries, true)
  if (!startResult || !endResult) return null

  return {
    startNode: startResult.node,
    startOffset: startResult.rawOffset,
    endNode: endResult.node,
    endOffset: endResult.rawOffset,
    text: m[1],
  }
}

/**
 * Plain text fallback: find `exact` (whitespace-normalised) anywhere in
 * normText using a simple indexOf.
 */
function plainTextSearch(
  normText: string,
  entries: TextNodeEntry[],
  anchor: TextAnchor,
): ResolvedRange | null {
  const normExact = normalize(anchor.exact)
  if (!normExact) return null

  const idx = normText.indexOf(normExact)
  if (idx === -1) return null

  const exactEnd = idx + normExact.length
  const startResult = normPosToNodeOffset(idx, entries)
  const endResult = normPosToNodeOffset(exactEnd, entries, true)
  if (!startResult || !endResult) return null

  return {
    startNode: startResult.node,
    startOffset: startResult.rawOffset,
    endNode: endResult.node,
    endOffset: endResult.rawOffset,
    text: normExact,
  }
}

/**
 * resolveAnchor: find the DOM range for a stored anchor.
 *
 * Tries in order:
 *   1. Context search  — prefix + exact + suffix pattern in normalized DOM text.
 *   2. Plain text search — simple indexOf(exact) on normalized DOM text.
 *   3. Returns null if nothing found.
 *
 * The `markdown` parameter is reserved for future use.
 */
export function resolveAnchor(
  article: HTMLElement,
  _markdown: string,
  anchor: TextAnchor,
): ResolvedRange | null {
  const { normText, entries } = buildNormIndex(article)
  if (entries.length === 0) return null

  return (
    contextSearch(normText, entries, anchor) ??
    plainTextSearch(normText, entries, anchor)
  )
}
