import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the entire docstore module before importing the adapter
vi.mock('../lib/docstore', () => ({
  addDocument: vi.fn(),
  getDocument: vi.fn(),
  removeDocument: vi.fn(),
  getAllDocuments: vi.fn(),
  getDocStats: vi.fn(),
  finalizeImport: vi.fn(),
  addHighlight: vi.fn(),
  getHighlights: vi.fn(),
  removeHighlight: vi.fn(),
  updateHighlightNote: vi.fn(),
  updateHighlightColor: vi.fn(),
  addComment: vi.fn(),
  getComments: vi.fn(),
  updateComment: vi.fn(),
  removeComment: vi.fn(),
  getCommentCount: vi.fn(),
  searchAcrossDocuments: vi.fn(),
  getAnalysis: vi.fn(),
  saveAnalysis: vi.fn(),
  getAnalysisByDocId: vi.fn(),
  clearAnalyses: vi.fn(),
  getCachedAudio: vi.fn(),
  cacheAudioSegment: vi.fn(),
  getFullCachedAudio: vi.fn(),
  saveCollectionCache: vi.fn(),
  loadCollectionCache: vi.fn(),
  getDocLinks: vi.fn(),
  computeCommunities: vi.fn(),
  computeUmapProjection: vi.fn(),
  exportLibrary: vi.fn(),
  importLibrary: vi.fn(),
  clearAllData: vi.fn(),
  requestPersistentStorage: vi.fn(),
}))

import * as ds from '../lib/docstore'
import { DexieAdapter } from '../adapters/dexie-adapter'

describe('DexieAdapter', () => {
  let adapter: DexieAdapter

  beforeEach(() => {
    adapter = new DexieAdapter()
    vi.clearAllMocks()
  })

  // --- Document methods ---
  describe('document management', () => {
    it('addDocument delegates to ds.addDocument', async () => {
      const result = { docId: 1, nearDuplicates: [], isExactDuplicate: false }
      vi.mocked(ds.addDocument).mockResolvedValue(result)

      const out = await adapter.addDocument('test.md', '# Hello', { skipPostProcessing: true })

      expect(ds.addDocument).toHaveBeenCalledWith('test.md', '# Hello', { skipPostProcessing: true })
      expect(out).toBe(result)
    })

    it('getDocument delegates to ds.getDocument', async () => {
      const doc = { id: 5, fileName: 'doc.md', markdown: '# Doc', addedAt: 0, wordCount: 1, chunkCount: 1, toc: [], contentHash: 'abc', simhash: 0, termVectorJson: '{}' }
      vi.mocked(ds.getDocument).mockResolvedValue(doc)

      const out = await adapter.getDocument(5)

      expect(ds.getDocument).toHaveBeenCalledWith(5)
      expect(out).toBe(doc)
    })

    it('removeDocument delegates to ds.removeDocument', async () => {
      vi.mocked(ds.removeDocument).mockResolvedValue(undefined)

      await adapter.removeDocument(3)

      expect(ds.removeDocument).toHaveBeenCalledWith(3)
    })

    it('getAllDocuments delegates to ds.getAllDocuments', async () => {
      const docs = [{ id: 1, fileName: 'a.md', markdown: '', addedAt: 0, wordCount: 0, chunkCount: 0, toc: [], contentHash: '', simhash: 0, termVectorJson: '{}' }]
      vi.mocked(ds.getAllDocuments).mockResolvedValue(docs)

      const out = await adapter.getAllDocuments()

      expect(ds.getAllDocuments).toHaveBeenCalledWith()
      expect(out).toBe(docs)
    })

    it('getDocStats delegates to ds.getDocStats', async () => {
      const stats = { totalDocs: 10, totalWords: 500, totalChunks: 50, totalHighlights: 3, storageEstimate: '1 MB' }
      vi.mocked(ds.getDocStats).mockResolvedValue(stats)

      const out = await adapter.getDocStats()

      expect(ds.getDocStats).toHaveBeenCalledWith()
      expect(out).toBe(stats)
    })

    it('finalizeImport delegates to ds.finalizeImport', async () => {
      vi.mocked(ds.finalizeImport).mockResolvedValue(undefined)

      await adapter.finalizeImport()

      expect(ds.finalizeImport).toHaveBeenCalledWith()
    })
  })

  // --- Highlight methods ---
  describe('highlight management', () => {
    it('addHighlight delegates to ds.addHighlight', async () => {
      vi.mocked(ds.addHighlight).mockResolvedValue(42)
      const h = { docId: 1, text: 'hello', startOffset: 0, endOffset: 5, color: 'yellow', note: '', createdAt: 0 }

      const out = await adapter.addHighlight(h)

      expect(ds.addHighlight).toHaveBeenCalledWith(h)
      expect(out).toBe(42)
    })

    it('getHighlights delegates to ds.getHighlights', async () => {
      const highlights = [{ id: 1, docId: 2, text: 'hi', startOffset: 0, endOffset: 2, color: 'blue', note: '', createdAt: 0 }]
      vi.mocked(ds.getHighlights).mockResolvedValue(highlights)

      const out = await adapter.getHighlights(2)

      expect(ds.getHighlights).toHaveBeenCalledWith(2)
      expect(out).toBe(highlights)
    })

    it('removeHighlight delegates to ds.removeHighlight', async () => {
      vi.mocked(ds.removeHighlight).mockResolvedValue(undefined)

      await adapter.removeHighlight(7)

      expect(ds.removeHighlight).toHaveBeenCalledWith(7)
    })

    it('updateHighlightNote delegates to ds.updateHighlightNote', async () => {
      vi.mocked(ds.updateHighlightNote).mockResolvedValue(undefined)

      await adapter.updateHighlightNote(7, 'my note')

      expect(ds.updateHighlightNote).toHaveBeenCalledWith(7, 'my note')
    })

    it('updateHighlightColor delegates to ds.updateHighlightColor', async () => {
      vi.mocked(ds.updateHighlightColor).mockResolvedValue(undefined)

      await adapter.updateHighlightColor(7, 'red')

      expect(ds.updateHighlightColor).toHaveBeenCalledWith(7, 'red')
    })
  })

  // --- Comment methods ---
  describe('comment management', () => {
    it('addComment delegates to ds.addComment', async () => {
      vi.mocked(ds.addComment).mockResolvedValue(99)
      const c = { docId: 1, selectedText: 'text', comment: 'note', author: 'me', sectionId: 'sec1', createdAt: 0, resolved: false }

      const out = await adapter.addComment(c)

      expect(ds.addComment).toHaveBeenCalledWith(c)
      expect(out).toBe(99)
    })

    it('getComments delegates to ds.getComments', async () => {
      const comments = [{ id: 1, docId: 3, selectedText: 'txt', comment: 'c', author: 'a', sectionId: 's', createdAt: 0, resolved: false }]
      vi.mocked(ds.getComments).mockResolvedValue(comments)

      const out = await adapter.getComments(3)

      expect(ds.getComments).toHaveBeenCalledWith(3)
      expect(out).toBe(comments)
    })

    it('updateComment delegates to ds.updateComment', async () => {
      vi.mocked(ds.updateComment).mockResolvedValue(undefined)

      await adapter.updateComment(5, { comment: 'updated', resolved: true })

      expect(ds.updateComment).toHaveBeenCalledWith(5, { comment: 'updated', resolved: true })
    })

    it('removeComment delegates to ds.removeComment', async () => {
      vi.mocked(ds.removeComment).mockResolvedValue(undefined)

      await adapter.removeComment(5)

      expect(ds.removeComment).toHaveBeenCalledWith(5)
    })

    it('getCommentCount delegates to ds.getCommentCount', async () => {
      vi.mocked(ds.getCommentCount).mockResolvedValue(4)

      const out = await adapter.getCommentCount(3)

      expect(ds.getCommentCount).toHaveBeenCalledWith(3)
      expect(out).toBe(4)
    })
  })

  // --- Search ---
  describe('search', () => {
    it('searchAcrossDocuments delegates to ds.searchAcrossDocuments', async () => {
      const hits = [{ docId: 1, docFileName: 'a.md', sectionPath: '', text: 'result', score: 0.9 }]
      vi.mocked(ds.searchAcrossDocuments).mockResolvedValue(hits)

      const out = await adapter.searchAcrossDocuments('query', 5)

      expect(ds.searchAcrossDocuments).toHaveBeenCalledWith('query', 5)
      expect(out).toBe(hits)
    })
  })

  // --- Analysis ---
  describe('analysis', () => {
    const analysis = {
      id: 1, docId: 2, contentHash: 'abc',
      themes: [], entities: [], chunks: [],
      difficulty: 'beginner' as const,
      structure: 'reference' as const,
      relatedDocIds: [], crossDocThemes: [],
      analyzedAt: 0, model: 'test', version: 1,
    }

    it('getAnalysis delegates to ds.getAnalysis', async () => {
      vi.mocked(ds.getAnalysis).mockResolvedValue(analysis)

      const out = await adapter.getAnalysis(2, 'abc')

      expect(ds.getAnalysis).toHaveBeenCalledWith(2, 'abc')
      expect(out).toBe(analysis)
    })

    it('saveAnalysis delegates to ds.saveAnalysis', async () => {
      vi.mocked(ds.saveAnalysis).mockResolvedValue(1)

      const out = await adapter.saveAnalysis(analysis)

      expect(ds.saveAnalysis).toHaveBeenCalledWith(analysis)
      expect(out).toBe(1)
    })

    it('getAnalysisByDocId delegates to ds.getAnalysisByDocId', async () => {
      vi.mocked(ds.getAnalysisByDocId).mockResolvedValue(analysis)

      const out = await adapter.getAnalysisByDocId(2)

      expect(ds.getAnalysisByDocId).toHaveBeenCalledWith(2)
      expect(out).toBe(analysis)
    })

    it('clearAnalyses delegates to ds.clearAnalyses', async () => {
      vi.mocked(ds.clearAnalyses).mockResolvedValue(undefined)

      await adapter.clearAnalyses()

      expect(ds.clearAnalyses).toHaveBeenCalledWith()
    })
  })

  // --- Audio ---
  describe('audio caching', () => {
    it('getCachedAudio delegates to ds.getCachedAudio', async () => {
      const audio = { id: 1, contentHash: 'h', segmentIndex: 0, pcm: new ArrayBuffer(4), sampleRate: 22050, createdAt: 0 }
      vi.mocked(ds.getCachedAudio).mockResolvedValue(audio)

      const out = await adapter.getCachedAudio('h', 0)

      expect(ds.getCachedAudio).toHaveBeenCalledWith('h', 0)
      expect(out).toBe(audio)
    })

    it('cacheAudioSegment delegates to ds.cacheAudioSegment', async () => {
      vi.mocked(ds.cacheAudioSegment).mockResolvedValue(undefined)
      const pcm = new Float32Array(10)

      await adapter.cacheAudioSegment('h', 0, pcm, 22050)

      expect(ds.cacheAudioSegment).toHaveBeenCalledWith('h', 0, pcm, 22050)
    })

    it('getFullCachedAudio delegates to ds.getFullCachedAudio', async () => {
      const segments = [{ id: 1, contentHash: 'h', segmentIndex: 0, pcm: new ArrayBuffer(4), sampleRate: 22050, createdAt: 0 }]
      vi.mocked(ds.getFullCachedAudio).mockResolvedValue(segments)

      const out = await adapter.getFullCachedAudio('h')

      expect(ds.getFullCachedAudio).toHaveBeenCalledWith('h')
      expect(out).toBe(segments)
    })
  })

  // --- Collections ---
  describe('collection cache', () => {
    it('saveCollectionCache delegates to ds.saveCollectionCache', async () => {
      vi.mocked(ds.saveCollectionCache).mockResolvedValue(undefined)
      const files = [{ path: 'a.md', content: '# A' }]

      await adapter.saveCollectionCache('My Coll', files, 0)

      expect(ds.saveCollectionCache).toHaveBeenCalledWith('My Coll', files, 0)
    })

    it('loadCollectionCache delegates to ds.loadCollectionCache', async () => {
      const cache = { id: 'abc', name: 'My Coll', files: [], currentFileIndex: 0, savedAt: 0 }
      vi.mocked(ds.loadCollectionCache).mockResolvedValue(cache)

      const out = await adapter.loadCollectionCache('abc')

      expect(ds.loadCollectionCache).toHaveBeenCalledWith('abc')
      expect(out).toBe(cache)
    })
  })

  // --- Graph / UMAP ---
  describe('doc links and graph', () => {
    it('getDocLinks delegates to ds.getDocLinks', async () => {
      vi.mocked(ds.getDocLinks).mockResolvedValue([])

      const out = await adapter.getDocLinks()

      expect(ds.getDocLinks).toHaveBeenCalledWith()
      expect(out).toEqual([])
    })

    it('computeCommunities delegates to ds.computeCommunities', async () => {
      const map = new Map([[1, 0], [2, 0]])
      vi.mocked(ds.computeCommunities).mockResolvedValue(map)

      const out = await adapter.computeCommunities()

      expect(ds.computeCommunities).toHaveBeenCalledWith()
      expect(out).toBe(map)
    })

    it('computeUmapProjection delegates to ds.computeUmapProjection', async () => {
      const proj = [{ docId: 1, fileName: 'a.md', x: 0.1, y: 0.2, communityId: 0 }]
      vi.mocked(ds.computeUmapProjection).mockResolvedValue(proj)

      const out = await adapter.computeUmapProjection()

      expect(ds.computeUmapProjection).toHaveBeenCalledWith()
      expect(out).toBe(proj)
    })
  })

  // --- Data management ---
  describe('data management', () => {
    it('exportLibrary delegates to ds.exportLibrary', async () => {
      vi.mocked(ds.exportLibrary).mockResolvedValue('{"docs":[]}')

      const out = await adapter.exportLibrary()

      expect(ds.exportLibrary).toHaveBeenCalledWith()
      expect(out).toBe('{"docs":[]}')
    })

    it('importLibrary delegates to ds.importLibrary', async () => {
      vi.mocked(ds.importLibrary).mockResolvedValue(undefined)

      await adapter.importLibrary('{"docs":[]}')

      expect(ds.importLibrary).toHaveBeenCalledWith('{"docs":[]}')
    })

    it('clearAllData delegates to ds.clearAllData', async () => {
      vi.mocked(ds.clearAllData).mockResolvedValue(undefined)

      await adapter.clearAllData()

      expect(ds.clearAllData).toHaveBeenCalledWith()
    })

    it('requestPersistentStorage delegates to ds.requestPersistentStorage', async () => {
      vi.mocked(ds.requestPersistentStorage).mockResolvedValue(undefined)

      await adapter.requestPersistentStorage()

      expect(ds.requestPersistentStorage).toHaveBeenCalledWith()
    })
  })
})
