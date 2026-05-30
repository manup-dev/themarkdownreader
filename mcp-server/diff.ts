export interface SectionDiff {
  title: string
  status: 'added' | 'removed' | 'changed' | 'unchanged'
  added: number
  removed: number
}

const HEADING_RE = /^#{1,6}\s+(.+?)\s*$/

// Split markdown into heading -> body lines. Content before the first heading
// lives under the '' key. Insertion order is preserved.
function splitSections(md: string): Map<string, string[]> {
  const sections = new Map<string, string[]>()
  let current = ''
  sections.set('', [])
  for (const line of md.split('\n')) {
    const h = HEADING_RE.exec(line)
    if (h) {
      current = h[1].trim()
      if (!sections.has(current)) sections.set(current, [])
    } else {
      sections.get(current)!.push(line)
    }
  }
  return sections
}

const nonBlank = (lines: string[]) => lines.filter((l) => l.trim().length > 0)

export function diffMarkdown(oldMd: string, newMd: string): SectionDiff[] {
  const a = splitSections(oldMd)
  const b = splitSections(newMd)
  const titles = new Set<string>([...a.keys(), ...b.keys()])
  const out: SectionDiff[] = []
  for (const title of titles) {
    if (title === '') continue // ignore the pre-heading preamble bucket
    const inA = a.has(title)
    const inB = b.has(title)
    if (inA && !inB) {
      out.push({ title, status: 'removed', added: 0, removed: nonBlank(a.get(title)!).length })
    } else if (!inA && inB) {
      out.push({ title, status: 'added', added: nonBlank(b.get(title)!).length, removed: 0 })
    } else {
      const la = a.get(title)!
      const lb = b.get(title)!
      const setA = new Set(la)
      const setB = new Set(lb)
      const added = nonBlank(lb).filter((l) => !setA.has(l)).length
      const removed = nonBlank(la).filter((l) => !setB.has(l)).length
      out.push({ title, status: added || removed ? 'changed' : 'unchanged', added, removed })
    }
  }
  return out
}

export function buildDiffSummary(diffs: SectionDiff[], nameA: string, nameB: string): string {
  const changed = diffs.filter((d) => d.status !== 'unchanged')
  if (changed.length === 0) return `No section-level changes between ${nameA} and ${nameB}.`
  const lines = changed.map((d) => {
    if (d.status === 'added') return `+ Added: ${d.title} (${d.added} line${d.added === 1 ? '' : 's'})`
    if (d.status === 'removed') return `- Removed: ${d.title} (${d.removed} line${d.removed === 1 ? '' : 's'})`
    return `~ Changed: ${d.title} (+${d.added}/-${d.removed})`
  })
  return `Changes from ${nameA} → ${nameB}:\n\n${lines.join('\n')}`
}
