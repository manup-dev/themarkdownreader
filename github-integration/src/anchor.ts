import type { AnchorCoords } from './parser'

/**
 * Map an annotation anchor to a 1-based line number in the source markdown.
 * Returns null if no locator field resolves to a real line. Strategy:
 *   1. anchor.line if 1..lineCount
 *   2. literal text search for anchor.text (first match wins)
 *   3. give up
 *
 * We deliberately do NOT pull in a markdown AST or fuzzy matcher — anchors
 * created locally already include a precise `line` in 99% of cases, and the
 * text-search fallback keeps the Action self-contained and fast.
 */
export function resolveLine(anchor: AnchorCoords, source: string): number | null {
  const lines = source.split('\n')
  if (typeof anchor.line === 'number' && anchor.line >= 1 && anchor.line <= lines.length) {
    return anchor.line
  }
  if (typeof anchor.text === 'string' && anchor.text.length > 0) {
    const needle = anchor.text
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes(needle)) return i + 1
    }
  }
  return null
}
