// Daily "words read" metric (B13) + the streak gate that consumes it (B12).
// One localStorage key per day (`md-reader-words-today-<toDateString>`)
// holding a JSON map of docKey → MAX words read in that doc that day.
// The daily total is the sum over docs — the old format stored a single
// number that each doc overwrote with its own max, so switching documents
// reset the day's count. Legacy plain-number values are folded in under
// the '__legacy__' key. Dated keys are pruned after KEEP_DAYS.
const PREFIX = 'md-reader-words-today-'
const KEEP_DAYS = 14

function keyFor(now: Date): string {
  return `${PREFIX}${now.toDateString()}`
}

function readDay(now: Date): Record<string, number> {
  try {
    const raw = localStorage.getItem(keyFor(now))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'number') return { __legacy__: parsed }
    if (parsed && typeof parsed === 'object') return parsed as Record<string, number>
    return {}
  } catch {
    return {}
  }
}

/** Record the reader's current words-read high-water mark for one document. */
export function recordWordsRead(docKey: string, words: number, now: Date = new Date()): void {
  if (!docKey || !Number.isFinite(words) || words <= 0) return
  const day = readDay(now)
  if ((day[docKey] ?? 0) >= words) return
  day[docKey] = words
  try { localStorage.setItem(keyFor(now), JSON.stringify(day)) } catch { /* quota — non-fatal */ }
}

/** Total words read today, summed across documents. */
export function wordsReadToday(now: Date = new Date()): number {
  return Object.values(readDay(now)).reduce(
    (sum, n) => sum + (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0),
    0,
  )
}

/** Drop dated keys older than keepDays (and malformed dated keys). */
export function pruneWordsReadStorage(now: Date = new Date(), keepDays: number = KEEP_DAYS): void {
  const cutoff = now.getTime() - keepDays * 86400000
  const stale: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(PREFIX)) continue
    const stamp = Date.parse(key.slice(PREFIX.length))
    if (Number.isNaN(stamp) || stamp < cutoff) stale.push(key)
  }
  for (const key of stale) localStorage.removeItem(key)
}
