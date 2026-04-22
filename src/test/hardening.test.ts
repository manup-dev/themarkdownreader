/**
 * Regression coverage for the hardening pass (tasks B1/H1-H7/M1-M11).
 *
 * Each block below pins the observable behavior of one fix so a later
 * refactor can't silently re-open the gap. Comments cite the task id
 * for traceability back to the review notes.
 */
import { describe, it, expect } from 'vitest'
import { ensureSafeFetchUrl, parseShareUrl, buildInlineShare, MAX_INLINE_ANNOT_BYTES } from '../lib/share-url'
import { decodeWal, SCHEMA_VERSION } from '../lib/annotation-events'
import { SaveScheduler } from '../lib/save-scheduler'

describe('H1: SSRF — expanded private-range coverage', () => {
  // 169.254/16 link-local, 100.64/10 CG-NAT, 0.0.0.0/8 unspecified
  it('rejects 169.254.x (link-local)', () => {
    expect(ensureSafeFetchUrl('https://169.254.169.254/latest').ok).toBe(false)
  })
  it('rejects 100.64.x (carrier-grade NAT)', () => {
    expect(ensureSafeFetchUrl('https://100.64.1.2/x').ok).toBe(false)
  })
  it('rejects 0.0.0.0/8 unspecified', () => {
    expect(ensureSafeFetchUrl('https://0.0.0.0/x').ok).toBe(false)
    expect(ensureSafeFetchUrl('https://0.1.2.3/x').ok).toBe(false)
  })
})

describe('H2: inline annot payload cap', () => {
  it('rejects shares whose annot exceeds MAX_INLINE_ANNOT_BYTES', () => {
    const huge = 'a'.repeat(MAX_INLINE_ANNOT_BYTES + 1)
    const href = `https://x/#url=https%3A%2F%2Fy%2Fa.md&annot=${huge}`
    expect(parseShareUrl({ href })).toBeNull()
  })
  it('accepts payloads at the cap', () => {
    const ok = 'a'.repeat(MAX_INLINE_ANNOT_BYTES)
    const href = `https://x/#url=https%3A%2F%2Fy%2Fa.md&annot=${ok}`
    expect(parseShareUrl({ href })?.kind).toBe('inline')
  })
})

describe('H4: inline overflow measures annot payload, not full URL', () => {
  it('small WAL fits even on a long-origin deploy', () => {
    const wal = '{"v":1,"ts":1,"id":"h","op":"highlight.add","docKey":"d","anchor":{"text":"x"},"color":"y"}'
    const r = buildInlineShare({
      origin: 'https://some-long-subdomain.example.org',
      docUrl: 'https://raw.x/really/deep/path/to/my-doc.md',
      walJsonl: wal,
    })
    expect(r.overflow).toBe(false)
  })
})

describe('M1: forward-version events are preserved', () => {
  it('decodes a v=99 event with forwardCompat: true', () => {
    const line = JSON.stringify({ v: 99, ts: 1, id: 'x', op: 'unknown.op' })
    const parsed = decodeWal(line)
    expect(parsed.length).toBe(1)
    expect((parsed[0] as { forwardCompat?: boolean }).forwardCompat).toBe(true)
  })
})

describe('M4: SaveScheduler.flushNow serialization under reentry', () => {
  it('awaits an in-flight flush before returning', async () => {
    let resolveFirst!: () => void
    const firstCompleted = new Promise<void>((r) => { resolveFirst = r })
    const observed: number[] = []
    let callCount = 0
    const s = new SaveScheduler({
      flush: async (events) => {
        callCount++
        if (callCount === 1) {
          observed.push(events.length)
          await firstCompleted
        } else {
          observed.push(events.length)
        }
      },
    })
    // Burst: immediate op starts flush 1; while it hangs, queue another
    s.append({ v: SCHEMA_VERSION, ts: 1, id: 'h1', op: 'highlight.add', docKey: 'd', anchor: { text: 'x' }, color: 'y' } as never)
    // Microtask so flushNow picks up the first batch
    await Promise.resolve()
    s.append({ v: SCHEMA_VERSION, ts: 2, id: 'h2', op: 'highlight.add', docKey: 'd', anchor: { text: 'y' }, color: 'y' } as never)
    const flushed = s.flushNow()
    resolveFirst()
    await flushed
    expect(observed).toEqual([1, 1])
    expect(s.pendingCount).toBe(0)
  })
})

describe('H6: path-traversal in repo share', () => {
  it('rejects `..` and `.` path segments in #repo share URLs', () => {
    expect(parseShareUrl({ href: 'https://x/#repo=o/r&path=docs/../secrets&ref=main' })).toBeNull()
    expect(parseShareUrl({ href: 'https://x/#repo=o/r&path=./shh&ref=main' })).toBeNull()
  })
})
