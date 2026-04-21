import type { AnnotationEvent } from './annotation-events'

/**
 * Autosave trigger policy. See design doc 05-autosave-and-wal.md for the
 * reasoning behind each trigger and the chosen timings.
 */

/** Ops that flush immediately; typing a note is the main opcode that debounces. */
export const IMMEDIATE_OPS = new Set<string>([
  'highlight.add',
  'highlight.del',
  'highlight.edit',
  'comment.add',
  'comment.del',
  'comment.resolve',
])

/** Ops that coalesce over the debounce window. */
export const DEBOUNCED_OPS = new Set<string>(['comment.edit'])

export interface SchedulerOptions {
  debounceMs?: number
  periodicMs?: number
  flush: (events: AnnotationEvent[]) => Promise<void>
  /** Injected for tests — defaults to setTimeout/clearTimeout/setInterval. */
  timer?: TimerLike
  onError?: (err: unknown, events: AnnotationEvent[]) => void
}

export interface TimerLike {
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(handle: number): void
  setInterval(fn: () => void, ms: number): number
  clearInterval(handle: number): void
}

const defaultTimer: TimerLike = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (h) => globalThis.clearTimeout(h),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms) as unknown as number,
  clearInterval: (h) => globalThis.clearInterval(h),
}

/**
 * Batches annotation events for durable writes. Drives flush via five
 * triggers: immediate, debounced, periodic, visibility change, and
 * beforeunload. Callers connect triggers they care about; the scheduler
 * itself is stateless w.r.t. DOM events so it stays testable.
 */
export class SaveScheduler {
  private pending: AnnotationEvent[] = []
  private debounceHandle: number | null = null
  private periodicHandle: number | null = null
  private inFlight = false
  private destroyed = false

  private readonly debounceMs: number
  private readonly periodicMs: number
  private readonly flushFn: (events: AnnotationEvent[]) => Promise<void>
  private readonly timer: TimerLike
  private readonly onError?: (err: unknown, events: AnnotationEvent[]) => void

  constructor(opts: SchedulerOptions) {
    this.debounceMs = opts.debounceMs ?? 500
    this.periodicMs = opts.periodicMs ?? 30_000
    this.flushFn = opts.flush
    this.timer = opts.timer ?? defaultTimer
    this.onError = opts.onError
  }

  /**
   * Record one or more events for eventual flush. Immediate ops flush now;
   * debounced ops wait. A periodic safety net runs while anything is pending.
   */
  append(events: AnnotationEvent | AnnotationEvent[]): void {
    if (this.destroyed) return
    const batch = Array.isArray(events) ? events : [events]
    if (!batch.length) return
    this.pending.push(...batch)

    const immediate = batch.some((e) => IMMEDIATE_OPS.has(e.op))
    if (immediate) {
      this.cancelDebounce()
      void this.flushNow()
    } else {
      this.scheduleDebounced()
    }
    this.ensurePeriodic()
  }

  /** Drop pending without flushing — only for tests or error paths. */
  discard(): AnnotationEvent[] {
    const dropped = this.pending
    this.pending = []
    this.cancelDebounce()
    this.cancelPeriodic()
    return dropped
  }

  /**
   * Fires the flush callback with the currently-pending batch. If the batch
   * is empty, returns early. Reentrant calls while one flush is in flight
   * are serialized so callers don't see torn writes.
   */
  async flushNow(): Promise<void> {
    if (this.destroyed) return
    this.cancelDebounce()
    if (this.inFlight) return
    if (!this.pending.length) {
      this.cancelPeriodic()
      return
    }
    const batch = this.pending.splice(0)
    this.inFlight = true
    try {
      await this.flushFn(batch)
    } catch (err) {
      this.onError?.(err, batch)
      // Re-queue the failed batch at the head; next trigger retries.
      // We don't re-throw: callers of flushNow() use pendingCount and
      // onError to detect failure, and fire-and-forget triggers would
      // otherwise leak unhandled rejections.
      this.pending.unshift(...batch)
    } finally {
      this.inFlight = false
      if (!this.pending.length) this.cancelPeriodic()
    }
  }

  /** Call on `visibilitychange` (hidden) and `pagehide` / `beforeunload`. */
  async flushOnHide(): Promise<void> {
    try {
      await this.flushNow()
    } catch {
      // Suppress — page is unloading; best-effort only.
    }
  }

  get pendingCount(): number {
    return this.pending.length
  }

  destroy(): void {
    this.destroyed = true
    this.cancelDebounce()
    this.cancelPeriodic()
  }

  private scheduleDebounced(): void {
    this.cancelDebounce()
    this.debounceHandle = this.timer.setTimeout(() => {
      this.debounceHandle = null
      void this.flushNow()
    }, this.debounceMs)
  }

  private ensurePeriodic(): void {
    if (this.periodicHandle !== null) return
    this.periodicHandle = this.timer.setInterval(() => {
      if (this.pending.length) void this.flushNow()
    }, this.periodicMs)
  }

  private cancelDebounce(): void {
    if (this.debounceHandle !== null) {
      this.timer.clearTimeout(this.debounceHandle)
      this.debounceHandle = null
    }
  }

  private cancelPeriodic(): void {
    if (this.periodicHandle !== null) {
      this.timer.clearInterval(this.periodicHandle)
      this.periodicHandle = null
    }
  }
}

// ─── Test timer ─────────────────────────────────────────────────────────────

export interface FakeTimer extends TimerLike {
  tick(ms: number): void
  now(): number
}

export function createFakeTimer(): FakeTimer {
  type Scheduled = { handle: number; fireAt: number; fn: () => void; periodMs: number | null }
  let nextHandle = 1
  let now = 0
  const scheduled = new Map<number, Scheduled>()

  const fire = (limit: number) => {
    while (true) {
      // Find the next scheduled task that should fire at or before `limit`.
      let winner: Scheduled | undefined
      for (const s of scheduled.values()) {
        if (s.fireAt <= limit && (!winner || s.fireAt < winner.fireAt)) winner = s
      }
      if (!winner) break
      now = winner.fireAt
      if (winner.periodMs === null) {
        scheduled.delete(winner.handle)
      } else {
        winner.fireAt = now + winner.periodMs
      }
      winner.fn()
    }
    now = limit
  }

  return {
    setTimeout(fn, ms) {
      const h = nextHandle++
      scheduled.set(h, { handle: h, fireAt: now + ms, fn, periodMs: null })
      return h
    },
    clearTimeout(h) {
      scheduled.delete(h)
    },
    setInterval(fn, ms) {
      const h = nextHandle++
      scheduled.set(h, { handle: h, fireAt: now + ms, fn, periodMs: ms })
      return h
    },
    clearInterval(h) {
      scheduled.delete(h)
    },
    tick(ms) {
      fire(now + ms)
    },
    now() {
      return now
    },
  }
}
