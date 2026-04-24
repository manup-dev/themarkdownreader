import type { AnnotationSink } from './annotation-log'
import { getAnnotationStorageMode, type AnnotationStorageMode } from './annotation-storage-mode'

export interface SinkResolution {
  sink: AnnotationSink
  effectiveMode: AnnotationStorageMode
  fellBack: boolean
}

export interface AnnotationSinkRouterOptions {
  dbSink: AnnotationSink
  fileSinkFactory: (docKey: string) => Promise<AnnotationSink>
}

export interface ResolveArgs {
  docKey: string
  folderHandleAvailable: boolean
}

/**
 * Routes annotation reads/writes to either the DB sink or a per-doc file
 * sink based on the user's mode preference. Performs lazy per-doc
 * migration the first time a doc is opened after a mode change.
 */
export class AnnotationSinkRouter {
  private fileSinkCache = new Map<string, AnnotationSink>()
  private migrationsAttempted = new Set<string>()

  constructor(private readonly options: AnnotationSinkRouterOptions) {}

  /**
   * Returns the durable sink for the given document, creating the file
   * sink on demand, running lazy per-doc migration (non-destructive), and
   * reporting whether a fall-back occurred (file-mode preferred but no
   * folder handle available).
   */
  async resolveSinkForDoc(args: ResolveArgs): Promise<SinkResolution> {
    const mode = getAnnotationStorageMode()
    const wantsFile = mode === 'file' && args.folderHandleAvailable
    if (!wantsFile) {
      const fellBack = mode === 'file' && !args.folderHandleAvailable
      // Migrate file → db on the first db-mode open per doc per session.
      if (!fellBack) await this.maybeMigrate(args.docKey, 'toDb', args.folderHandleAvailable)
      return { sink: this.options.dbSink, effectiveMode: 'db', fellBack }
    }
    const fileSink = await this.getFileSink(args.docKey)
    await this.maybeMigrate(args.docKey, 'toFile', true)
    return { sink: fileSink, effectiveMode: 'file', fellBack: false }
  }

  private async getFileSink(docKey: string): Promise<AnnotationSink> {
    const cached = this.fileSinkCache.get(docKey)
    if (cached) return cached
    const sink = await this.options.fileSinkFactory(docKey)
    this.fileSinkCache.set(docKey, sink)
    return sink
  }

  private async maybeMigrate(
    docKey: string,
    direction: 'toFile' | 'toDb',
    folderAvailable: boolean,
  ): Promise<void> {
    const source = direction === 'toFile'
      ? this.options.dbSink
      : (folderAvailable ? await this.getFileSink(docKey) : null)
    if (!source) return // no source available — allow retry later when it becomes available

    const key = `${docKey}:${direction}`
    if (this.migrationsAttempted.has(key)) return
    this.migrationsAttempted.add(key)

    const target = direction === 'toFile' ? await this.getFileSink(docKey) : this.options.dbSink

    const targetEvents = await target.listEvents(docKey)
    if (targetEvents.length > 0) return // target already has data — don't clobber

    const sourceEvents = await source.listEvents(docKey)
    if (!sourceEvents.length) return

    try {
      await target.append(docKey, sourceEvents.map((s) => s.event))
      const sourceCp = await source.readCheckpoint(docKey)
      if (sourceCp) await target.writeCheckpoint(docKey, sourceCp)
    } catch (err) {
      // Un-stamp so a future open can retry instead of silently skipping.
      this.migrationsAttempted.delete(key)
      // eslint-disable-next-line no-console
      console.warn(`[AnnotationSinkRouter] migration ${direction} failed for ${docKey}`, err)
      throw err
    }
  }

  /**
   * Test/helper hook: forget cached file sinks and the migrations-attempted
   * set so migration will re-run on the next open. Useful after a mode flip
   * or when integration-testing across sessions.
   */
  reset(): void {
    this.fileSinkCache.clear()
    this.migrationsAttempted.clear()
  }
}
