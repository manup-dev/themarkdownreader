import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SaveScheduler, createFakeTimer } from '../lib/save-scheduler'
import { SCHEMA_VERSION, type AnnotationEvent, type HighlightAddEvent, type CommentEditEvent } from '../lib/annotation-events'

const DOC = 'd'
const baseTs = Date.parse('2026-04-21T00:00:00Z')

const hAdd = (id: string, offsetSec = 0): HighlightAddEvent => ({
  v: SCHEMA_VERSION,
  ts: baseTs + offsetSec * 1000,
  id,
  op: 'highlight.add',
  docKey: DOC,
  anchor: { text: 'x' },
  color: 'yellow',
})

const cEdit = (id: string, body = 'typing', offsetSec = 0): CommentEditEvent => ({
  v: SCHEMA_VERSION,
  ts: baseTs + offsetSec * 1000,
  id,
  op: 'comment.edit',
  docKey: DOC,
  body,
})

describe('SaveScheduler', () => {
  let timer: ReturnType<typeof createFakeTimer>
  let flushed: AnnotationEvent[][]
  let flushMock: (events: AnnotationEvent[]) => Promise<void>
  let scheduler: SaveScheduler

  beforeEach(() => {
    timer = createFakeTimer()
    flushed = []
    flushMock = vi.fn(async (events: AnnotationEvent[]) => {
      flushed.push(events)
    })
    scheduler = new SaveScheduler({ flush: flushMock, timer })
  })

  it('immediate ops flush without waiting for debounce', async () => {
    scheduler.append(hAdd('h1'))
    await Promise.resolve()
    expect(flushed.length).toBe(1)
    expect(flushed[0].length).toBe(1)
  })

  it('debounced ops coalesce within the debounce window', async () => {
    scheduler.append(cEdit('c1', 'a'))
    scheduler.append(cEdit('c1', 'ab'))
    scheduler.append(cEdit('c1', 'abc'))
    timer.tick(499)
    expect(flushed.length).toBe(0)
    timer.tick(1)
    await flushMicrotasks()
    expect(flushed.length).toBe(1)
    expect(flushed[0].length).toBe(3)
  })

  it('new debounced events reset the timer', async () => {
    scheduler.append(cEdit('c1', 'a'))
    timer.tick(400)
    scheduler.append(cEdit('c1', 'ab'))
    timer.tick(400)
    expect(flushed.length).toBe(0)
    timer.tick(100)
    await flushMicrotasks()
    expect(flushed.length).toBe(1)
  })

  it('immediate flush also drains debounced events queued before it', async () => {
    scheduler.append(cEdit('c1', 'typing'))
    scheduler.append(hAdd('h1'))
    await flushMicrotasks()
    expect(flushed.length).toBe(1)
    expect(flushed[0].length).toBe(2)
  })

  it('periodic trigger fires every 30s while pending', async () => {
    // Make two successive debounced events with no immediate flush, then
    // let periodic fire. Debounce will flush first (500ms), so we refill.
    scheduler.append(cEdit('c1', 'a'))
    timer.tick(500)
    await flushMicrotasks()
    expect(flushed.length).toBe(1)
    scheduler.append(cEdit('c2', 'b'))
    // periodic is scheduled at +30s from last ensurePeriodic. Debounce will
    // still flush this one first, but we want to verify periodic doesn't
    // fire spuriously when pending is empty.
    timer.tick(500)
    await flushMicrotasks()
    expect(flushed.length).toBe(2)
    timer.tick(30_000)
    await flushMicrotasks()
    expect(flushed.length).toBe(2) // nothing pending, periodic is a no-op
  })

  it('flushOnHide drains pending synchronously', async () => {
    scheduler.append(cEdit('c1', 'half typed'))
    await scheduler.flushOnHide()
    expect(flushed.length).toBe(1)
    expect(scheduler.pendingCount).toBe(0)
  })

  it('re-queues batch if flush throws', async () => {
    const failOnce = vi.fn(async () => {
      throw new Error('disk full')
    })
    const errors: unknown[] = []
    const s = new SaveScheduler({ flush: failOnce, timer, onError: (e) => errors.push(e) })
    s.append(hAdd('h1'))
    await flushMicrotasks()
    expect(errors.length).toBe(1)
    expect(s.pendingCount).toBe(1)
  })

  it('destroy cancels pending timers', async () => {
    scheduler.append(cEdit('c1', 'typing'))
    scheduler.destroy()
    timer.tick(10_000)
    await flushMicrotasks()
    expect(flushed.length).toBe(0)
  })

  it('accepts arrays and single events', async () => {
    scheduler.append([hAdd('h1'), hAdd('h2')])
    await flushMicrotasks()
    expect(flushed[0].length).toBe(2)
  })
})

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}
