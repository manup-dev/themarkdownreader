import type { StorageAdapter, Highlight, Comment } from '../types/storage-adapter'
import { DexieAdapter } from './dexie-adapter'
import { AnnotationSinkRouter } from '../lib/annotation-sink-router'
import type { AnnotationEvent } from '../lib/annotation-events'
import { materialize } from '../lib/annotation-events'

export interface DocContext {
  docKey: string | null
  docId: number | null
  folderHandleAvailable: boolean
}

export interface FileRoutedAdapterOptions {
  base: DexieAdapter
  router: AnnotationSinkRouter
  docContextProvider: () => DocContext
}

/**
 * StorageAdapter that writes to the DB tables (so the UI's read path keeps
 * working) AND appends a WAL event to whichever sink the router picks. In
 * file mode the sidecar is the durable record; the DB tables are an
 * in-session cache rebuildable via hydrateFromSinkIfNeeded.
 *
 * Delegates every non-annotation method to the base DexieAdapter unchanged.
 */
export class FileRoutedAdapter implements StorageAdapter {
  constructor(private readonly opts: FileRoutedAdapterOptions) {}

  private get base(): DexieAdapter { return this.opts.base }

  private async activeSink(): Promise<{ sink: import('../lib/annotation-log').AnnotationSink | null; docKey: string | null }> {
    const ctx = this.opts.docContextProvider()
    if (!ctx.docKey) return { sink: null, docKey: null }
    const res = await this.opts.router.resolveSinkForDoc({
      docKey: ctx.docKey,
      folderHandleAvailable: ctx.folderHandleAvailable,
    })
    if (res.effectiveMode === 'db') return { sink: null, docKey: ctx.docKey }
    return { sink: res.sink, docKey: ctx.docKey }
  }

  async hydrateFromSinkIfNeeded(docId: number, docKey: string): Promise<void> {
    const ctx = this.opts.docContextProvider()
    const res = await this.opts.router.resolveSinkForDoc({
      docKey, folderHandleAvailable: ctx.folderHandleAvailable,
    })
    if (res.effectiveMode !== 'file') return

    const [existingHl, existingCm] = await Promise.all([
      this.base.getHighlights(docId),
      this.base.getComments(docId),
    ])
    if (existingHl.length || existingCm.length) return

    const stored = await res.sink.listEvents(docKey)
    const cp = await res.sink.readCheckpoint(docKey)
    const events: AnnotationEvent[] = []
    if (cp) events.push(cp)
    for (const s of stored) events.push(s.event)
    if (!events.length) return

    const state = materialize(events)
    for (const h of state.highlights.values()) {
      const start = h.anchor.markdownStart ?? h.anchor.byteOffset ?? 0
      const text = h.anchor.exact ?? h.anchor.text ?? ''
      const end = h.anchor.markdownEnd ?? start + text.length
      await this.base.addHighlight({
        docId, text, startOffset: start, endOffset: end,
        color: h.color, note: h.note ?? '', createdAt: h.createdAt,
        anchor: (typeof h.anchor.markdownStart === 'number' && typeof h.anchor.markdownEnd === 'number'
          && typeof h.anchor.exact === 'string') ? h.anchor as never : undefined,
      })
    }
    for (const c of state.comments.values()) {
      await this.base.addComment({
        docId, selectedText: c.selectedText, comment: c.body, author: c.author || 'Imported',
        sectionId: c.sectionId, createdAt: c.createdAt, resolved: c.resolved,
        anchor: (typeof c.anchor.markdownStart === 'number' && typeof c.anchor.markdownEnd === 'number'
          && typeof c.anchor.exact === 'string') ? c.anchor as never : undefined,
      })
    }
  }

  async addHighlight(h: Omit<Highlight, 'id'>): Promise<number> {
    const id = await this.base.addHighlight(h)
    const { sink, docKey } = await this.activeSink()
    if (sink && docKey) {
      await sink.append(docKey, [{
        v: 1, ts: h.createdAt, id: `h_${id}`, op: 'highlight.add',
        docKey,
        anchor: h.anchor ?? { markdownStart: h.startOffset, markdownEnd: h.endOffset, exact: h.text },
        color: h.color, note: h.note || undefined,
        clientId: this.base.clientId(),
      } as AnnotationEvent])
    }
    return id
  }

  async removeHighlight(id: number): Promise<void> {
    await this.base.removeHighlight(id)
    const { sink, docKey } = await this.activeSink()
    if (sink && docKey) {
      await sink.append(docKey, [{
        v: 1, ts: Date.now(), id: `h_${id}`, op: 'highlight.del',
        docKey,
        clientId: this.base.clientId(),
      } as AnnotationEvent])
    }
  }

  async updateHighlightNote(id: number, note: string): Promise<void> {
    await this.base.updateHighlightNote(id, note)
    const { sink, docKey } = await this.activeSink()
    if (sink && docKey) {
      await sink.append(docKey, [{
        v: 1, ts: Date.now(), id: `h_${id}`, op: 'highlight.edit',
        docKey,
        note, clientId: this.base.clientId(),
      } as AnnotationEvent])
    }
  }

  async updateHighlightColor(id: number, color: string): Promise<void> {
    await this.base.updateHighlightColor(id, color)
    const { sink, docKey } = await this.activeSink()
    if (sink && docKey) {
      await sink.append(docKey, [{
        v: 1, ts: Date.now(), id: `h_${id}`, op: 'highlight.edit',
        docKey,
        color, clientId: this.base.clientId(),
      } as AnnotationEvent])
    }
  }

  async addComment(c: Omit<Comment, 'id'>): Promise<number> {
    const id = await this.base.addComment(c)
    const { sink, docKey } = await this.activeSink()
    if (sink && docKey) {
      await sink.append(docKey, [{
        v: 1, ts: c.createdAt, id: `c_${id}`, op: 'comment.add',
        docKey,
        selectedText: c.selectedText, body: c.comment, author: c.author,
        sectionId: c.sectionId,
        anchor: c.anchor ?? { markdownStart: 0, markdownEnd: c.selectedText.length, exact: c.selectedText },
        clientId: this.base.clientId(),
      } as AnnotationEvent])
    }
    return id
  }

  async updateComment(id: number, updates: Partial<Pick<Comment, 'comment' | 'resolved'>>): Promise<void> {
    await this.base.updateComment(id, updates)
    const { sink, docKey } = await this.activeSink()
    if (!sink || !docKey) return
    if (typeof updates.comment === 'string') {
      await sink.append(docKey, [{
        v: 1, ts: Date.now(), id: `c_${id}`, op: 'comment.edit',
        docKey,
        body: updates.comment, clientId: this.base.clientId(),
      } as AnnotationEvent])
    }
    if (typeof updates.resolved === 'boolean') {
      await sink.append(docKey, [{
        v: 1, ts: Date.now(), id: `c_${id}`, op: 'comment.resolve',
        docKey,
        resolved: updates.resolved, clientId: this.base.clientId(),
      } as AnnotationEvent])
    }
  }

  async removeComment(id: number): Promise<void> {
    await this.base.removeComment(id)
    const { sink, docKey } = await this.activeSink()
    if (sink && docKey) {
      await sink.append(docKey, [{
        v: 1, ts: Date.now(), id: `c_${id}`, op: 'comment.del',
        docKey,
        clientId: this.base.clientId(),
      } as AnnotationEvent])
    }
  }

  // Straight delegation for everything else
  addDocument: StorageAdapter['addDocument'] = (...a) => this.base.addDocument(...a)
  getDocument: StorageAdapter['getDocument'] = (...a) => this.base.getDocument(...a)
  removeDocument: StorageAdapter['removeDocument'] = (...a) => this.base.removeDocument(...a)
  getAllDocuments: StorageAdapter['getAllDocuments'] = () => this.base.getAllDocuments()
  getDocStats: StorageAdapter['getDocStats'] = () => this.base.getDocStats()
  finalizeImport: StorageAdapter['finalizeImport'] = () => this.base.finalizeImport()
  getHighlights: StorageAdapter['getHighlights'] = (...a) => this.base.getHighlights(...a)
  getComments: StorageAdapter['getComments'] = (...a) => this.base.getComments(...a)
  getCommentCount: StorageAdapter['getCommentCount'] = (...a) => this.base.getCommentCount(...a)
  searchAcrossDocuments: StorageAdapter['searchAcrossDocuments'] = (...a) => this.base.searchAcrossDocuments(...a)
  getAnalysis: StorageAdapter['getAnalysis'] = (...a) => this.base.getAnalysis(...a)
  saveAnalysis: StorageAdapter['saveAnalysis'] = (...a) => this.base.saveAnalysis(...a)
  getAnalysisByDocId: StorageAdapter['getAnalysisByDocId'] = (...a) => this.base.getAnalysisByDocId(...a)
  clearAnalyses: StorageAdapter['clearAnalyses'] = () => this.base.clearAnalyses()
  getCachedAudio: StorageAdapter['getCachedAudio'] = (...a) => this.base.getCachedAudio(...a)
  cacheAudioSegment: StorageAdapter['cacheAudioSegment'] = (...a) => this.base.cacheAudioSegment(...a)
  getFullCachedAudio: StorageAdapter['getFullCachedAudio'] = (...a) => this.base.getFullCachedAudio(...a)
  saveCollectionCache: StorageAdapter['saveCollectionCache'] = (...a) => this.base.saveCollectionCache(...a)
  loadCollectionCache: StorageAdapter['loadCollectionCache'] = (...a) => this.base.loadCollectionCache(...a)
  getDocLinks: StorageAdapter['getDocLinks'] = () => this.base.getDocLinks()
  computeCommunities: StorageAdapter['computeCommunities'] = () => this.base.computeCommunities()
  computeUmapProjection: StorageAdapter['computeUmapProjection'] = () => this.base.computeUmapProjection()
  exportLibrary: StorageAdapter['exportLibrary'] = () => this.base.exportLibrary()
  importLibrary: StorageAdapter['importLibrary'] = (...a) => this.base.importLibrary(...a)
  clearAllData: StorageAdapter['clearAllData'] = () => this.base.clearAllData()
  requestPersistentStorage: StorageAdapter['requestPersistentStorage'] = () => this.base.requestPersistentStorage()
  appendEvents: StorageAdapter['appendEvents'] = (...a) => this.base.appendEvents(...a)
  listEvents: StorageAdapter['listEvents'] = (...a) => this.base.listEvents(...a)
  readCheckpoint: StorageAdapter['readCheckpoint'] = (...a) => this.base.readCheckpoint(...a)
  writeCheckpoint: StorageAdapter['writeCheckpoint'] = (...a) => this.base.writeCheckpoint(...a)
  truncateBefore: StorageAdapter['truncateBefore'] = (...a) => this.base.truncateBefore(...a)
  compactLog: StorageAdapter['compactLog'] = (...a) => this.base.compactLog(...a)
}
