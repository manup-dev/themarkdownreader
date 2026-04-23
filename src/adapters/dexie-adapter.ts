import type { StorageAdapter, AddDocumentResult, StoredDocument, Highlight, Comment, SearchHit, DocStats, DocumentAnalysis, CachedAudio, CollectionCache, DocLinkExpanded } from '../types/storage-adapter'
import * as ds from '../lib/docstore'
import type { AnnotationEvent, CheckpointEvent } from '../lib/annotation-events'
import { AnnotationLog, type StoredEvent, type CompactResult } from '../lib/annotation-log'

export class DexieAdapter implements StorageAdapter {
  async addDocument(fileName: string, markdown: string, opts?: { skipPostProcessing?: boolean }): Promise<AddDocumentResult> {
    return ds.addDocument(fileName, markdown, opts)
  }
  async getDocument(docId: number): Promise<StoredDocument | undefined> {
    return ds.getDocument(docId)
  }
  async removeDocument(docId: number): Promise<void> {
    await ds.removeDocument(docId)
  }
  async getAllDocuments(): Promise<StoredDocument[]> {
    return ds.getAllDocuments()
  }
  async getDocStats(): Promise<DocStats> {
    return ds.getDocStats()
  }
  async finalizeImport(): Promise<void> {
    return ds.finalizeImport()
  }
  async addHighlight(h: Omit<Highlight, 'id'>): Promise<number> {
    return ds.addHighlight(h as Omit<ds.Highlight, 'id'>)
  }
  async getHighlights(docId: number): Promise<Highlight[]> {
    return ds.getHighlights(docId)
  }
  async removeHighlight(id: number): Promise<void> {
    await ds.removeHighlight(id)
  }
  async updateHighlightNote(id: number, note: string): Promise<void> {
    await ds.updateHighlightNote(id, note)
  }
  async updateHighlightColor(id: number, color: string): Promise<void> {
    await ds.updateHighlightColor(id, color)
  }
  async addComment(c: Omit<Comment, 'id'>): Promise<number> {
    return ds.addComment(c as Omit<ds.Comment, 'id'>)
  }
  async getComments(docId: number): Promise<Comment[]> {
    return ds.getComments(docId)
  }
  async updateComment(id: number, updates: Partial<Pick<Comment, 'comment' | 'resolved'>>): Promise<void> {
    await ds.updateComment(id, updates)
  }
  async removeComment(id: number): Promise<void> {
    await ds.removeComment(id)
  }
  async getCommentCount(docId: number): Promise<number> {
    return ds.getCommentCount(docId)
  }
  async searchAcrossDocuments(query: string, topK?: number): Promise<SearchHit[]> {
    return ds.searchAcrossDocuments(query, topK)
  }
  async getAnalysis(docId: number, contentHash: string): Promise<DocumentAnalysis | undefined> {
    return ds.getAnalysis(docId, contentHash) as Promise<DocumentAnalysis | undefined>
  }
  async saveAnalysis(analysis: DocumentAnalysis): Promise<number> {
    return ds.saveAnalysis(analysis as ds.DocumentAnalysis)
  }
  async getAnalysisByDocId(docId: number): Promise<DocumentAnalysis | undefined> {
    return ds.getAnalysisByDocId(docId) as Promise<DocumentAnalysis | undefined>
  }
  async clearAnalyses(): Promise<void> {
    await ds.clearAnalyses()
  }
  async getCachedAudio(contentHash: string, segmentIndex: number): Promise<CachedAudio | undefined> {
    return ds.getCachedAudio(contentHash, segmentIndex)
  }
  async cacheAudioSegment(contentHash: string, segmentIndex: number, pcm: Float32Array, sampleRate: number): Promise<void> {
    await ds.cacheAudioSegment(contentHash, segmentIndex, pcm, sampleRate)
  }
  async getFullCachedAudio(contentHash: string): Promise<CachedAudio[]> {
    return ds.getFullCachedAudio(contentHash)
  }
  async saveCollectionCache(name: string, files: Array<{ path: string; content: string }>, currentFileIndex: number): Promise<void> {
    await ds.saveCollectionCache(name, files, currentFileIndex)
  }
  async loadCollectionCache(id?: string): Promise<CollectionCache | null> {
    return ds.loadCollectionCache(id)
  }
  async getDocLinks(): Promise<DocLinkExpanded[]> {
    return ds.getDocLinks()
  }
  async computeCommunities(): Promise<Map<number, number>> {
    return ds.computeCommunities()
  }
  async computeUmapProjection(): Promise<Array<{ docId: number; fileName: string; x: number; y: number; communityId: number }>> {
    return ds.computeUmapProjection()
  }
  async exportLibrary(): Promise<string> {
    return ds.exportLibrary()
  }
  async importLibrary(json: string): Promise<void> {
    await ds.importLibrary(json)
  }
  async clearAllData(): Promise<void> {
    await ds.clearAllData()
  }
  async requestPersistentStorage(): Promise<void> {
    await ds.requestPersistentStorage()
  }

  // ─── Annotation WAL ──────────────────────────────────────────────────────

  async appendEvents(docKey: string, events: AnnotationEvent[]): Promise<void> {
    await ds.dexieSink.append(docKey, events)
  }

  async listEvents(docKey: string, sinceSeq?: number): Promise<StoredEvent[]> {
    return ds.dexieSink.listEvents(docKey, sinceSeq)
  }

  async readCheckpoint(docKey: string): Promise<CheckpointEvent | null> {
    return ds.dexieSink.readCheckpoint(docKey)
  }

  async writeCheckpoint(docKey: string, cp: CheckpointEvent): Promise<void> {
    await ds.dexieSink.writeCheckpoint(docKey, cp)
  }

  async truncateBefore(docKey: string, seq: number): Promise<number> {
    return ds.dexieSink.truncateBefore(docKey, seq)
  }

  async compactLog(docKey: string): Promise<CompactResult> {
    const log = new AnnotationLog(docKey, ds.dexieSink, this.clientId())
    await log.hydrate()
    return log.compact()
  }

  /**
   * Stable client identifier for this browser/session pairing. We use
   * localStorage so the same browser is recognized across reloads, which
   * gives us a usable tiebreaker in compareEvents and a useful "by" field
   * for future attribution. Anonymous by default — no PII.
   */
  private clientId(): string {
    try {
      const key = 'md-reader.clientId'
      let id = localStorage.getItem(key)
      if (!id) {
        id = crypto.randomUUID()
        localStorage.setItem(key, id)
      }
      return id
    } catch {
      // SSR / test environments without localStorage: fall back to a
      // per-call uuid. That's fine — replay ordering doesn't require
      // persistence across calls.
      return crypto.randomUUID()
    }
  }
}
