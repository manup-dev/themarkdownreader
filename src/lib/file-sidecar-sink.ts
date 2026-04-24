import type { AnnotationEvent, CheckpointEvent } from './annotation-events'
import { decodeWal, encodeWal } from './annotation-events'
import type { AnnotationSink, StoredEvent } from './annotation-log'

export interface FileSidecarSinkOptions {
  /** Used for corrupt-file quarantine: rename-and-recreate. Omit if rename-on-corrupt isn't needed (tests). */
  parent?: FileSystemDirectoryHandle
  basename?: string
  /** Override the debounce window (ms). Default 250. */
  debounceMs?: number
}

/**
 * Append-only `.annot` sidecar sink. On load we parse the entire JSONL WAL
 * into an in-memory shadow; subsequent reads are O(1). Writes coalesce via
 * a short debounce and a full-file rewrite — WAL files are small (KB-range)
 * so streaming append isn't worth the complexity.
 */
export class FileSidecarSink implements AnnotationSink {
  private shadow: StoredEvent[] = []
  private checkpoint: CheckpointEvent | null = null
  private seqCounter = 0
  private dirty = false
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private writeInflight: Promise<void> | null = null
  private debounceMs: number

  constructor(
    private fileHandle: FileSystemFileHandle,
    public readonly docKey: string,
    private readonly opts: FileSidecarSinkOptions = {},
  ) {
    this.debounceMs = opts.debounceMs ?? 250
  }

  /** Parse the sidecar into memory. Must be called before any read/write. */
  async load(): Promise<void> {
    const file = await this.fileHandle.getFile()
    const text = await file.text()
    if (!text.trim()) {
      this.shadow = []
      this.checkpoint = null
      this.seqCounter = 0
      return
    }
    try {
      const events = decodeWal(text)
      this.ingest(events)
    } catch (err) {
      await this.quarantineCorrupt(err)
      this.shadow = []
      this.checkpoint = null
      this.seqCounter = 0
    }
  }

  private ingest(events: AnnotationEvent[]): void {
    this.shadow = []
    this.checkpoint = null
    this.seqCounter = 0
    for (const e of events) {
      if (e.op === 'checkpoint') { this.checkpoint = e as CheckpointEvent; continue }
      if (e.op === 'header') continue // header is transport metadata, not a log event
      this.shadow.push({ seq: this.seqCounter++, docKey: this.docKey, event: e })
    }
  }

  async append(docKey: string, events: AnnotationEvent[]): Promise<void> {
    if (!events.length) return
    for (const event of events) {
      this.shadow.push({ seq: this.seqCounter++, docKey, event })
    }
    this.markDirty()
  }

  async listEvents(_docKey: string, sinceSeq?: number): Promise<StoredEvent[]> {
    if (sinceSeq === undefined) return [...this.shadow]
    return this.shadow.filter((s) => s.seq >= sinceSeq)
  }

  async readCheckpoint(_docKey: string): Promise<CheckpointEvent | null> {
    return this.checkpoint
  }

  async writeCheckpoint(_docKey: string, cp: CheckpointEvent): Promise<void> {
    this.checkpoint = cp
    this.markDirty()
  }

  async truncateBefore(_docKey: string, seq: number): Promise<number> {
    const before = this.shadow.length
    this.shadow = this.shadow.filter((s) => s.seq >= seq)
    const removed = before - this.shadow.length
    if (removed) this.markDirty()
    return removed
  }

  async compactAtomic(_docKey: string, cp: CheckpointEvent): Promise<number> {
    const removed = this.shadow.length
    this.checkpoint = cp
    this.shadow = []
    this.markDirty()
    return removed
  }

  /** Flush pending writes immediately. Call on doc close or tab blur. */
  async flushNow(): Promise<void> {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }
    await this.doFlush()
  }

  private markDirty(): void {
    this.dirty = true
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.doFlush()
    }, this.debounceMs)
  }

  private async doFlush(): Promise<void> {
    if (!this.dirty) return
    if (this.writeInflight) { await this.writeInflight; return this.doFlush() }
    this.writeInflight = (async () => {
      const events: AnnotationEvent[] = []
      if (this.checkpoint) events.push(this.checkpoint)
      for (const row of this.shadow) events.push(row.event)
      const text = encodeWal(events)
      const writable = await this.fileHandle.createWritable()
      try {
        await writable.write(text)
      } finally {
        await writable.close()
      }
      this.dirty = false
    })()
    try { await this.writeInflight } finally { this.writeInflight = null }
  }

  private async quarantineCorrupt(err: unknown): Promise<void> {
    // eslint-disable-next-line no-console
    console.warn('[FileSidecarSink] corrupt WAL, quarantining', err)
    if (!this.opts.parent || !this.opts.basename) return
    const broken = `${this.opts.basename}.broken-${Date.now()}`
    try {
      const brokenHandle = await this.opts.parent.getFileHandle(broken, { create: true })
      const srcFile = await this.fileHandle.getFile()
      const srcText = await srcFile.text()
      const w = await brokenHandle.createWritable()
      try { await w.write(srcText) } finally { await w.close() }
      await this.opts.parent.removeEntry(this.opts.basename)
      this.fileHandle = await this.opts.parent.getFileHandle(this.opts.basename, { create: true })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[FileSidecarSink] quarantine failed, continuing with empty shadow', e)
    }
  }
}
