import type { TextAnchor } from '../lib/anchor'
import type { TocEntry } from '../store/useStore'

export interface StoredDocument {
  id?: number
  fileName: string
  markdown: string
  addedAt: number
  wordCount: number
  chunkCount: number
  toc: TocEntry[]
  contentHash: string
  simhash: number
  termVectorJson: string
  communityId?: number
}

export interface Highlight {
  id?: number
  docId: number
  text: string
  startOffset: number
  endOffset: number
  color: string
  note: string
  createdAt: number
  anchor?: TextAnchor
}

export interface Comment {
  id?: number
  docId: number
  selectedText: string
  comment: string
  author: string
  sectionId: string
  createdAt: number
  resolved: boolean
  anchor?: TextAnchor
}

export interface DocumentAnalysis {
  id?: number
  docId: number
  contentHash: string
  themes: Array<{ title: string; description: string; relevanceScore: number; chunkIds: number[] }>
  entities: Array<{ name: string; type: 'concept' | 'technology' | 'person' | 'process'; mentions: number }>
  chunks: Array<{ chunkId: number; contentType: 'prose' | 'code' | 'table' | 'list' | 'diagram' | 'heading' | 'mixed'; weight: number; summary?: string }>
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert'
  structure: 'tutorial' | 'reference' | 'narrative' | 'mixed'
  relatedDocIds: number[]
  crossDocThemes: string[]
  analyzedAt: number
  model: string
  version: number
}

export interface CachedAudio {
  id?: number
  contentHash: string
  segmentIndex: number
  pcm: ArrayBuffer
  sampleRate: number
  createdAt: number
}

export interface CollectionCache {
  id: string
  name: string
  files: Array<{ path: string; content: string }>
  currentFileIndex: number
  savedAt: number
}

export interface AddDocumentResult {
  docId: number
  nearDuplicates: StoredDocument[]
  isExactDuplicate: boolean
}

export interface DocLinkExpanded {
  source: StoredDocument
  target: StoredDocument
  strength: number
  sharedTerms: string[]
}

export interface SearchHit {
  docId: number
  docFileName: string
  sectionPath: string
  text: string
  score: number
}

export interface DocStats {
  totalDocs: number
  totalWords: number
  totalChunks: number
  totalHighlights: number
  storageEstimate: string
}

export interface StorageAdapter {
  addDocument(fileName: string, markdown: string, opts?: { skipPostProcessing?: boolean }): Promise<AddDocumentResult>
  getDocument(docId: number): Promise<StoredDocument | undefined>
  removeDocument(docId: number): Promise<void>
  getAllDocuments(): Promise<StoredDocument[]>
  getDocStats(): Promise<DocStats>
  finalizeImport(): Promise<void>
  addHighlight(h: Omit<Highlight, 'id'>): Promise<number>
  getHighlights(docId: number): Promise<Highlight[]>
  removeHighlight(id: number): Promise<void>
  updateHighlightNote(id: number, note: string): Promise<void>
  updateHighlightColor(id: number, color: string): Promise<void>
  addComment(c: Omit<Comment, 'id'>): Promise<number>
  getComments(docId: number): Promise<Comment[]>
  updateComment(id: number, updates: Partial<Pick<Comment, 'comment' | 'resolved'>>): Promise<void>
  removeComment(id: number): Promise<void>
  getCommentCount(docId: number): Promise<number>
  searchAcrossDocuments(query: string, topK?: number): Promise<SearchHit[]>
  getAnalysis(docId: number, contentHash: string): Promise<DocumentAnalysis | undefined>
  saveAnalysis(analysis: DocumentAnalysis): Promise<number>
  getAnalysisByDocId(docId: number): Promise<DocumentAnalysis | undefined>
  clearAnalyses(): Promise<void>
  getCachedAudio(contentHash: string, segmentIndex: number): Promise<CachedAudio | undefined>
  cacheAudioSegment(contentHash: string, segmentIndex: number, pcm: Float32Array, sampleRate: number): Promise<void>
  getFullCachedAudio(contentHash: string): Promise<CachedAudio[]>
  saveCollectionCache(name: string, files: Array<{ path: string; content: string }>, currentFileIndex: number): Promise<void>
  loadCollectionCache(id?: string): Promise<CollectionCache | null>
  getDocLinks(): Promise<DocLinkExpanded[]>
  computeCommunities(): Promise<Map<number, number>>
  computeUmapProjection(): Promise<Array<{ docId: number; fileName: string; x: number; y: number; communityId: number }>>
  exportLibrary(): Promise<string>
  importLibrary(json: string): Promise<void>
  clearAllData(): Promise<void>
  requestPersistentStorage(): Promise<void>
}
