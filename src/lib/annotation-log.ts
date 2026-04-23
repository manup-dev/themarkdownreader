import {
  SCHEMA_VERSION,
  SCHEMA_ID,
  emptyState,
  reduce,
  compareEvents,
  dedupeEvents,
  type AnnotationEvent,
  type CheckpointEvent,
  type DocState,
  type HeaderEvent,
  type MaterializedHighlight,
  type MaterializedComment,
} from './annotation-events'

/**
 * Persistence seam. The log doesn't talk to Dexie directly — callers inject
 * a sink so the core logic is testable with an in-memory fake. The DexieSink
 * lives in docstore.ts and talks to the v9 tables; the InMemorySink lives
 * here so tests don't need Dexie.
 */
export interface AnnotationSink {
  append(docKey: string, events: AnnotationEvent[]): Promise<void>
  listEvents(docKey: string, sinceSeq?: number): Promise<StoredEvent[]>
  readCheckpoint(docKey: string): Promise<CheckpointEvent | null>
  writeCheckpoint(docKey: string, cp: CheckpointEvent): Promise<void>
  truncateBefore(docKey: string, seq: number): Promise<number>
  /**
   * Optional atomic compaction: write checkpoint + truncate log in a
   * single transaction. When present, callers should prefer it over the
   * two-step path so a crash between steps can't leave a stale
   * checkpoint paired with unmerged tail events. Returns the number of
   * rows removed from the log.
   */
  compactAtomic?(docKey: string, cp: CheckpointEvent): Promise<number>
}

export interface StoredEvent {
  seq: number
  docKey: string
  event: AnnotationEvent
}

export interface CompactResult {
  removedEvents: number
  checkpointBytes: number
}

/**
 * Append-only, in-memory event log for a single document. Wraps a sink for
 * durability. This is the only object the rest of the app needs to know
 * about; reducers and codecs are implementation details.
 */
export class AnnotationLog {
  public readonly docKey: string
  private readonly sink: AnnotationSink
  private readonly clientId: string
  private state: DocState = emptyState()
  private hydrated = false

  constructor(docKey: string, sink: AnnotationSink, clientId: string) {
    this.docKey = docKey
    this.sink = sink
    this.clientId = clientId
  }

  /**
   * Lazy hydration. Loads checkpoint (if any) then replays events since
   * the checkpoint. Also pre-seeds with caller-provided events — used for
   * legacy pre-v9 rows that we want to surface without persisting.
   */
  async hydrate(preSeed: AnnotationEvent[] = []): Promise<DocState> {
    if (this.hydrated) return this.state
    const cp = await this.sink.readCheckpoint(this.docKey)
    const stored = await this.sink.listEvents(this.docKey)
    const storedEvents = stored.map((s) => s.event)

    // Checkpoint is the base: apply it first so its replaces-whole-state
    // semantics can't clobber newer events that happen to have older ts.
    // Legacy pre-seed and subsequent events then replay on top of it.
    this.state = emptyState()
    if (cp) this.state = reduce(this.state, cp)

    const tail = dedupeEvents([...preSeed, ...storedEvents]).sort(compareEvents)
    for (const e of tail) this.state = reduce(this.state, e)

    this.hydrated = true
    return this.state
  }

  get snapshot(): DocState {
    return this.state
  }

  get highlights(): MaterializedHighlight[] {
    return [...this.state.highlights.values()]
  }

  get comments(): MaterializedComment[] {
    return [...this.state.comments.values()]
  }

  /**
   * Append a batch of events. Updates materialized state eagerly so callers
   * see the change before the durable write finishes; if the write fails,
   * the sink rejects and callers can surface an error.
   */
  async append(events: AnnotationEvent[]): Promise<void> {
    if (!events.length) return
    const stamped = events.map((e) => ({
      ...e,
      v: e.v ?? SCHEMA_VERSION,
      clientId: e.clientId ?? this.clientId,
    }))
    for (const e of stamped) this.state = reduce(this.state, e)
    await this.sink.append(this.docKey, stamped)
  }

  /**
   * Rewrite the log as a single checkpoint + empty tail. Safe to call any
   * time the log is hydrated. Returns how many events were collapsed and
   * the approximate checkpoint size for observability.
   */
  async compact(): Promise<CompactResult> {
    if (!this.hydrated) await this.hydrate()
    const stored = await this.sink.listEvents(this.docKey)
    const priorEvents = stored.length
    const checkpoint: CheckpointEvent = {
      v: SCHEMA_VERSION,
      ts: Date.now(),
      id: `cp_${Date.now().toString(36)}`,
      op: 'checkpoint',
      priorEvents,
      state: {
        highlights: [...this.state.highlights.values()],
        comments: [...this.state.comments.values()],
        unknown: this.state.unknown,
      },
      clientId: this.clientId,
    }
    // Prefer atomic compaction when the sink supports it — a crash
    // between writeCheckpoint and truncateBefore could otherwise leave
    // a stale checkpoint while the log still carries pre-checkpoint
    // events, leading to double-apply on next hydrate.
    let removed: number
    if (this.sink.compactAtomic) {
      removed = await this.sink.compactAtomic(this.docKey, checkpoint)
    } else {
      await this.sink.writeCheckpoint(this.docKey, checkpoint)
      // Defensive max: don't trust array ordering — use the actual max seq.
      const highestSeq = stored.length ? Math.max(...stored.map((s) => s.seq)) + 1 : 0
      removed = await this.sink.truncateBefore(this.docKey, highestSeq)
    }
    return {
      removedEvents: removed,
      checkpointBytes: JSON.stringify(checkpoint).length,
    }
  }
}

/**
 * Builds a header event for a fresh WAL. Callers pass any doc metadata they
 * have; unknown fields are fine.
 */
export function makeHeader(args: {
  title?: string
  contentHash?: string
  source?: string
  docKey: string
  createdBy?: string
}): HeaderEvent {
  return {
    v: SCHEMA_VERSION,
    ts: Date.now(),
    id: `hdr_${Date.now().toString(36)}`,
    op: 'header',
    doc: {
      title: args.title,
      contentHash: args.contentHash,
      source: args.source,
      docKey: args.docKey,
    },
    schema: SCHEMA_ID,
    createdAt: Date.now(),
    createdBy: args.createdBy,
  }
}

// ─── In-memory sink for tests and ephemeral readers ─────────────────────────

export class InMemorySink implements AnnotationSink {
  private logs = new Map<string, StoredEvent[]>()
  private checkpoints = new Map<string, CheckpointEvent>()
  private seq = 0

  async append(docKey: string, events: AnnotationEvent[]): Promise<void> {
    const list = this.logs.get(docKey) ?? []
    for (const event of events) {
      list.push({ seq: this.seq++, docKey, event })
    }
    this.logs.set(docKey, list)
  }

  async listEvents(docKey: string, sinceSeq?: number): Promise<StoredEvent[]> {
    const list = this.logs.get(docKey) ?? []
    if (sinceSeq === undefined) return [...list]
    return list.filter((s) => s.seq >= sinceSeq)
  }

  async readCheckpoint(docKey: string): Promise<CheckpointEvent | null> {
    return this.checkpoints.get(docKey) ?? null
  }

  async writeCheckpoint(docKey: string, cp: CheckpointEvent): Promise<void> {
    this.checkpoints.set(docKey, cp)
  }

  async truncateBefore(docKey: string, seq: number): Promise<number> {
    const list = this.logs.get(docKey) ?? []
    const kept = list.filter((s) => s.seq >= seq)
    this.logs.set(docKey, kept)
    return list.length - kept.length
  }

  // Test helpers
  get seqCounter(): number {
    return this.seq
  }
}
