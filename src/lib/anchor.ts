import { extractToc, slugify } from './markdown'

export interface TextAnchor {
  markdownStart: number    // char offset in raw markdown (primary key)
  markdownEnd: number
  exact: string            // the selected text
  prefix: string           // up to 30 chars before selection in markdown
  suffix: string           // up to 30 chars after selection in markdown
  sectionId: string        // nearest heading ID (slug)
  offsetInSection: number  // char offset from section heading start
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

  return {
    markdownStart: start,
    markdownEnd: end,
    exact,
    prefix,
    suffix,
    sectionId,
    offsetInSection,
  }
}
