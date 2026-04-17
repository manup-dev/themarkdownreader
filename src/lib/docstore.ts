import Dexie, { type Table } from 'dexie'
import MiniSearch from 'minisearch'
import murmur from 'murmurhash-js'
import { chunkMarkdown, extractToc, wordCount } from './markdown'
import type { TocEntry } from '../store/useStore'
import type { TextAnchor } from './anchor'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface StoredDocument {
  id?: number
  fileName: string
  markdown: string
  addedAt: number
  wordCount: number
  chunkCount: number
  toc: TocEntry[]
  contentHash: string       // SHA-256 for exact dedup
  simhash: number           // 32-bit SimHash for near-dedup
  termVectorJson: string    // Serialized TF-IDF vector
  communityId?: number      // Louvain community assignment
}

export interface StoredChunk {
  id?: number
  docId: number
  docFileName: string
  text: string
  sectionPath: string
  headingLevel: number      // 0 = no heading, 1-6 = heading level
  index: number
  termVectorJson: string
}

export interface DocLink {
  id?: number
  sourceDocId: number
  targetDocId: number
  strength: number
  sharedTerms: string
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
  anchor?: TextAnchor     // structured position data (absent on old records)
}

export interface Comment {
  id?: number
  docId: number
  selectedText: string    // the text the user selected when commenting
  comment: string         // the user's comment
  author: string          // author name (default "You", but configurable)
  sectionId: string       // which TOC section this is in
  createdAt: number
  resolved: boolean       // can mark comments as resolved
  anchor?: TextAnchor     // structured position data (absent on old records)
}

export interface SearchIndexBlob {
  id: string // always 'main'
  data: string // JSON serialized MiniSearch
}

export interface StoredPodcastScript {
  id?: number
  title: string
  contentHash: string
  segments: string // JSON stringified PodcastSegment[]
  scriptLines: string // JSON stringified ScriptLine[]
  createdAt: number
}

export interface CachedAudio {
  id?: number
  contentHash: string       // same hash as PodcastScript
  segmentIndex: number
  pcm: ArrayBuffer          // raw PCM Float32 data
  sampleRate: number
  createdAt: number
}

export interface TrainingDatapoint {
  id?: number
  input: string
  output: string
  task: string
  model: string
  timestamp: number
  userFeedback?: 'positive' | 'negative'
}

export interface Theme {
  title: string
  description: string
  relevanceScore: number
  chunkIds: number[]
}

export interface Entity {
  name: string
  type: 'concept' | 'technology' | 'person' | 'process'
  mentions: number
}

export type ChunkContentType = 'prose' | 'code' | 'table' | 'list' | 'diagram' | 'heading' | 'mixed'

export interface AnalyzedChunk {
  chunkId: number
  contentType: ChunkContentType
  weight: number
  summary?: string
}

export interface DocumentAnalysis {
  id?: number
  docId: number
  contentHash: string
  themes: Theme[]
  entities: Entity[]
  chunks: AnalyzedChunk[]
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert'
  structure: 'tutorial' | 'reference' | 'narrative' | 'mixed'
  relatedDocIds: number[]
  crossDocThemes: string[]
  analyzedAt: number
  model: string
  version: number
}

// ─── Database Schema (v2: compound indexes, highlights, search cache) ──────

export interface CollectionCache {
  id: string // project slug (e.g., 'iot-fundamentals') or 'last' for active pointer
  name: string
  files: Array<{ path: string; content: string }>
  currentFileIndex: number
  savedAt: number
}

class MdReaderDB extends Dexie {
  documents!: Table<StoredDocument>
  chunks!: Table<StoredChunk>
  docLinks!: Table<DocLink>
  highlights!: Table<Highlight>
  comments!: Table<Comment>
  searchCache!: Table<SearchIndexBlob>
  collectionCache!: Table<CollectionCache>
  podcastScripts!: Table<StoredPodcastScript>
  trainingData!: Table<TrainingDatapoint>
  documentAnalyses!: Table<DocumentAnalysis>
  audioCache!: Table<CachedAudio>

  constructor() {
    super('md-reader')
    this.version(3).stores({
      documents: '++id, fileName, addedAt, contentHash, simhash, communityId',
      chunks: '++id, docId, [docId+index], docFileName, headingLevel',
      docLinks: '++id, sourceDocId, targetDocId, [sourceDocId+targetDocId]',
      highlights: '++id, docId, createdAt',
      searchCache: 'id',
      collectionCache: 'id',
    })
    this.version(4).stores({
      documents: '++id, fileName, addedAt, contentHash, simhash, communityId',
      chunks: '++id, docId, [docId+index], docFileName, headingLevel',
      docLinks: '++id, sourceDocId, targetDocId, [sourceDocId+targetDocId]',
      highlights: '++id, docId, createdAt',
      comments: '++id, docId, sectionId, createdAt, resolved',
      searchCache: 'id',
      collectionCache: 'id',
    })
    this.version(5).stores({
      podcastScripts: '++id, contentHash, createdAt',
      trainingData: '++id, task, timestamp',
    })
    this.version(6).stores({
      documentAnalyses: '++id, docId, contentHash, analyzedAt',
    })
    this.version(7).stores({
      audioCache: '++id, contentHash, [contentHash+segmentIndex], createdAt',
    })
    // v8: TextAnchor field added to highlights and comments.
    // No index changes — anchor is stored inline, not indexed.
    // Old records without anchor continue to work (field is optional).
    this.version(8).stores({})
  }
}

export const db = new MdReaderDB()

// ─── Collection cache (persist directory sessions across reloads) ──────────

function projectId(name: string): string {
  return name.toLowerCase().replace(/[^\w]+/g, '-').replace(/-+/g, '-').slice(0, 50)
}

export async function saveCollectionCache(
  name: string,
  files: Array<{ path: string; content: string }>,
  currentFileIndex: number,
): Promise<void> {
  const id = projectId(name)
  const entry: CollectionCache = { id, name, files, currentFileIndex, savedAt: Date.now() }
  // Save the project itself
  await db.collectionCache.put(entry)
  // Also save as "last" active pointer
  await db.collectionCache.put({ ...entry, id: 'last' })
}

export async function loadCollectionCache(id?: string): Promise<CollectionCache | null> {
  const cached = await db.collectionCache.get(id ?? 'last')
  return cached ?? null
}

/**
 * Unified-view cache reader — returns the most-recently-active folder
 * session in the shape the store's hydrateFolderFromCache action expects.
 * Thin adapter over loadCollectionCache that normalizes field names and
 * drops the Dexie internals (id, currentFileIndex) the unified view doesn't
 * care about.
 */
export async function getCollectionCache(): Promise<{
  name: string
  files: Array<{ path: string; content: string }>
  timestamp: number
} | null> {
  const cached = await loadCollectionCache()
  if (!cached) return null
  return {
    name: cached.name,
    files: cached.files,
    timestamp: cached.savedAt,
  }
}

export async function clearCollectionCache(): Promise<void> {
  await db.collectionCache.delete('last')
}

/** List all saved projects (excluding the 'last' pointer) */
export async function listProjects(): Promise<Array<{ id: string; name: string; fileCount: number; savedAt: number }>> {
  const all = await db.collectionCache.toArray()
  return all
    .filter((c) => c.id !== 'last')
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((c) => ({ id: c.id, name: c.name, fileCount: c.files.length, savedAt: c.savedAt }))
}

/** Delete a saved project */
export async function deleteProject(id: string): Promise<void> {
  await db.collectionCache.delete(id)
}

// ─── Request persistent storage on first load ──────────────────────────────

export async function requestPersistentStorage() {
  if (navigator.storage?.persist) {
    const persisted = await navigator.storage.persist()
    return persisted
  }
  return false
}

// ─── Full-text search index (MiniSearch with BM25) ─────────────────────────

let searchIndex: MiniSearch | null = null

function createSearchIndex(): MiniSearch {
  return new MiniSearch({
    fields: ['text', 'sectionPath', 'docFileName'],
    storeFields: ['docId', 'docFileName', 'sectionPath', 'text', 'headingLevel'],
    searchOptions: {
      boost: { sectionPath: 3, docFileName: 2, text: 1 },
      fuzzy: 0.2,
      prefix: true,
    },
  })
}

async function rebuildIndex() {
  const allChunks = await db.chunks.toArray()
  const ms = createSearchIndex()
  ms.addAll(allChunks.map((c) => ({ ...c, id: c.id! })))
  searchIndex = ms
  // Persist index to IndexedDB for fast reload
  await db.searchCache.put({ id: 'main', data: JSON.stringify(ms) })
}

async function loadOrRebuildIndex() {
  if (searchIndex) return
  const cached = await db.searchCache.get('main')
  if (cached) {
    try {
      searchIndex = MiniSearch.loadJSON(cached.data, {
        fields: ['text', 'sectionPath', 'docFileName'],
        storeFields: ['docId', 'docFileName', 'sectionPath', 'text', 'headingLevel'],
      })
      return
    } catch { /* stale cache, rebuild */ }
  }
  await rebuildIndex()
}

// ─── SimHash for near-duplicate detection ──────────────────────────────────

function hammingDistance(a: number, b: number): number {
  let xor = a ^ b
  let count = 0
  while (xor) {
    count += xor & 1
    xor >>= 1
  }
  return count
}

export async function findNearDuplicates(simhash: number, skip = false): Promise<StoredDocument[]> {
  if (skip) return []
  // For large libraries, only scan recent docs to avoid full-table scan
  const count = await db.documents.count()
  if (count > 500) {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const recentDocs = await db.documents.where('addedAt').above(cutoff).toArray()
    return recentDocs.filter((d) => hammingDistance(d.simhash, simhash) <= 3)
  }
  const allDocs = await db.documents.toArray()
  return allDocs.filter((d) => hammingDistance(d.simhash, simhash) <= 3)
}

// ─── SHA-256 content hash ──────────────────────────────────────────────────

async function sha256(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ─── TF-IDF ────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'some', 'them',
  'than', 'its', 'over', 'such', 'that', 'this', 'with', 'will', 'each',
  'from', 'they', 'were', 'which', 'their', 'said', 'what', 'about', 'into',
  'more', 'other', 'then', 'these', 'when', 'would', 'make', 'like', 'just',
  'also', 'could', 'only', 'after', 'where', 'most', 'should', 'does', 'being',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
}

function computeTermFrequency(text: string): Map<string, number> {
  const tokens = tokenize(text)
  const freq = new Map<string, number>()
  let max = 1
  for (const t of tokens) {
    const c = (freq.get(t) ?? 0) + 1
    freq.set(t, c)
    if (c > max) max = c
  }
  for (const [k, v] of freq) freq.set(k, v / max)
  return freq
}

/** Compute TF from pre-tokenized tokens (avoids re-tokenizing) */
function computeTermFrequencyFromTokens(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>()
  let max = 1
  for (const t of tokens) {
    const c = (freq.get(t) ?? 0) + 1
    freq.set(t, c)
    if (c > max) max = c
  }
  for (const [k, v] of freq) freq.set(k, v / max)
  return freq
}

/** Compute simhash from pre-tokenized tokens */
function computeSimhashFromTokens(tokens: string[]): number {
  const shingles = new Set<string>()
  for (let i = 0; i < tokens.length - 2; i++) {
    shingles.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`)
  }
  const bits = 32
  const v = new Int32Array(bits)
  for (const shingle of shingles) {
    const hash = murmur.murmur3(shingle, 42)
    for (let i = 0; i < bits; i++) {
      if ((hash >> i) & 1) v[i]++
      else v[i]--
    }
  }
  let fingerprint = 0
  for (let i = 0; i < bits; i++) {
    if (v[i] > 0) fingerprint |= (1 << i)
  }
  return fingerprint
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, normA = 0, normB = 0
  for (const [key, va] of a) {
    const vb = b.get(key)
    if (vb) dot += va * vb
    normA += va * va
  }
  for (const [, vb] of b) normB += vb * vb
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function findSharedTopTerms(a: Map<string, number>, b: Map<string, number>, n = 8): string[] {
  const shared: Array<{ term: string; score: number }> = []
  for (const [term, scoreA] of a) {
    const scoreB = b.get(term)
    if (scoreB) shared.push({ term, score: scoreA + scoreB })
  }
  return shared.sort((a, b) => b.score - a.score).slice(0, n).map((s) => s.term)
}

// ─── Hierarchical 3-tier indexing ──────────────────────────────────────────

export interface HierarchicalIndex {
  docLevel: { docId: number; fileName: string; summary: string; tf: Map<string, number> }[]
  sectionLevel: { docId: number; heading: string; level: number; tf: Map<string, number> }[]
}

export async function buildHierarchicalIndex(): Promise<HierarchicalIndex> {
  const docs = await db.documents.toArray()
  const docLevel = docs.map((d) => ({
    docId: d.id!,
    fileName: d.fileName,
    summary: d.markdown.slice(0, 500),
    tf: computeTermFrequency(d.markdown),
  }))

  const chunks = await db.chunks.toArray()
  const sectionLevel = chunks
    .filter((c) => c.headingLevel > 0 && c.headingLevel <= 2)
    .map((c) => ({
      docId: c.docId,
      heading: c.sectionPath,
      level: c.headingLevel,
      tf: computeTermFrequency(c.text),
    }))

  return { docLevel, sectionLevel }
}

export async function hierarchicalSearch(
  query: string,
  topDocs = 3,
  topChunks = 8,
): Promise<Array<{ docId: number; docFileName: string; sectionPath: string; text: string; score: number; tier: string }>> {
  const queryTf = computeTermFrequency(query)
  const index = await buildHierarchicalIndex()

  // Tier 1: find most relevant documents
  const docScores = index.docLevel
    .map((d) => ({ ...d, score: cosineSimilarity(queryTf, d.tf) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topDocs)
  const relevantDocIds = new Set(docScores.map((d) => d.docId))

  // Tier 2+3: BM25 chunk search scoped to relevant docs (sections used for doc routing)
  await loadOrRebuildIndex()
  if (!searchIndex) return []

  const bm25Results = searchIndex.search(query)
    .filter((r) => relevantDocIds.has(r.docId as number))
    .slice(0, topChunks)

  return bm25Results.map((r) => ({
    docId: r.docId as number,
    docFileName: r.docFileName as string,
    sectionPath: r.sectionPath as string,
    text: r.text as string,
    score: r.score,
    tier: 'chunk',
  }))
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface AddDocumentResult {
  docId: number
  nearDuplicates: StoredDocument[]
  isExactDuplicate: boolean
}

// Yield to browser main thread to prevent page-unresponsive
const yieldToMain = () => new Promise<void>((r) => setTimeout(r, 0))

export async function addDocument(fileName: string, markdown: string, opts?: { skipPostProcessing?: boolean }): Promise<AddDocumentResult> {
  const contentHash = await sha256(markdown)

  // Check exact duplicate (fast indexed lookup, no full scan)
  const exactDup = await db.documents.where('contentHash').equals(contentHash).first()
  if (exactDup) {
    return { docId: exactDup.id!, nearDuplicates: [], isExactDuplicate: true }
  }

  await yieldToMain()

  // Tokenize once, reuse for both simhash and TF (avoids double-processing large text)
  const tokens = tokenize(markdown)
  const simhash = computeSimhashFromTokens(tokens)
  const docTf = computeTermFrequencyFromTokens(tokens)

  await yieldToMain()

  // Skip near-duplicate check during batch imports (expensive full-table scan)
  const nearDups = await findNearDuplicates(simhash, !!opts?.skipPostProcessing)

  // Remove old version if same filename (inside check, actual removal deferred until new doc is ready)
  const existing = await db.documents.where('fileName').equals(fileName).first()
  const existingId = existing?.id

  const toc = extractToc(markdown)
  const chunks = chunkMarkdown(markdown)

  await yieldToMain()

  // Remove old version AFTER new data is prepared (atomic: old removed + new added together)
  if (existingId) await removeDocument(existingId, !!opts?.skipPostProcessing)

  const docId = await db.documents.add({
    fileName,
    markdown,
    addedAt: Date.now(),
    wordCount: wordCount(markdown),
    chunkCount: chunks.length,
    toc,
    contentHash,
    simhash,
    termVectorJson: JSON.stringify(Object.fromEntries(docTf)),
  })

  // Store chunks in batches with heading level metadata + yield between batches
  const CHUNK_BATCH = 50
  for (let i = 0; i < chunks.length; i += CHUNK_BATCH) {
    const batch = chunks.slice(i, i + CHUNK_BATCH).map((c) => {
      const headingMatch = c.text.match(/^(#{1,6})\s/)
      return {
        docId,
        docFileName: fileName,
        text: c.text,
        sectionPath: c.sectionPath,
        headingLevel: headingMatch ? headingMatch[1].length : 0,
        index: c.index,
        termVectorJson: JSON.stringify(Object.fromEntries(computeTermFrequency(c.text))),
      }
    })
    await db.chunks.bulkAdd(batch)
    await yieldToMain()
  }

  if (!opts?.skipPostProcessing) {
    // Compute cross-doc similarity links
    const allDocs = await db.documents.toArray()
    const linksToAdd: Omit<DocLink, 'id'>[] = []
    for (const other of allDocs) {
      if (other.id === docId) continue
      const otherTf = new Map<string, number>(Object.entries(JSON.parse(other.termVectorJson)))
      const sim = cosineSimilarity(docTf, otherTf)
      if (sim > 0.05) {
        linksToAdd.push({
          sourceDocId: docId,
          targetDocId: other.id!,
          strength: sim,
          sharedTerms: JSON.stringify(findSharedTopTerms(docTf, otherTf)),
        })
      }
    }
    if (linksToAdd.length > 0) await db.docLinks.bulkAdd(linksToAdd)

    await rebuildIndex()
  }
  return { docId, nearDuplicates: nearDups, isExactDuplicate: false }
}

/**
 * Finalize a batch import: rebuild search index + compute all cross-doc similarity links.
 * Call once after adding multiple documents with skipPostProcessing: true.
 */
export async function finalizeImport(): Promise<void> {
  // Rebuild all cross-doc similarity links
  const allDocs = await db.documents.toArray()
  const tfVectors = allDocs.map((d) => ({
    id: d.id!,
    tf: new Map<string, number>(Object.entries(JSON.parse(d.termVectorJson))),
  }))

  // Clear existing links and recompute, yielding periodically
  await db.docLinks.clear()
  const linksToAdd: Omit<DocLink, 'id'>[] = []
  for (let i = 0; i < tfVectors.length; i++) {
    for (let j = i + 1; j < tfVectors.length; j++) {
      const sim = cosineSimilarity(tfVectors[i].tf, tfVectors[j].tf)
      if (sim > 0.05) {
        linksToAdd.push({
          sourceDocId: tfVectors[i].id,
          targetDocId: tfVectors[j].id,
          strength: sim,
          sharedTerms: JSON.stringify(findSharedTopTerms(tfVectors[i].tf, tfVectors[j].tf)),
        })
      }
    }
    // Yield every 10 docs to keep UI responsive
    if (i % 10 === 9) await yieldToMain()
  }
  if (linksToAdd.length > 0) {
    for (let i = 0; i < linksToAdd.length; i += 200) {
      await db.docLinks.bulkAdd(linksToAdd.slice(i, i + 200))
    }
  }

  await rebuildIndex()
}

export async function removeDocument(docId: number, skipRebuild = false) {
  await db.transaction('rw', [db.chunks, db.docLinks, db.documents, db.highlights, db.comments], async () => {
    await db.chunks.where('docId').equals(docId).delete()
    await db.docLinks.where('sourceDocId').equals(docId).delete()
    await db.docLinks.where('targetDocId').equals(docId).delete()
    await db.highlights.where('docId').equals(docId).delete()
    await db.comments.where('docId').equals(docId).delete()
    await db.documents.delete(docId)
  })
  if (!skipRebuild) await rebuildIndex()
}

export async function getAllDocuments(): Promise<StoredDocument[]> {
  return db.documents.orderBy('addedAt').reverse().toArray()
}

export async function getDocument(docId: number): Promise<StoredDocument | undefined> {
  return db.documents.get(docId)
}

export async function getDocumentChunks(docId: number): Promise<StoredChunk[]> {
  return db.chunks.where('docId').equals(docId).sortBy('index')
}

export async function searchAcrossDocuments(
  query: string,
  topK = 10,
): Promise<Array<{ docId: number; docFileName: string; sectionPath: string; text: string; score: number }>> {
  await loadOrRebuildIndex()
  if (!searchIndex) return []

  return searchIndex.search(query).slice(0, topK).map((r) => ({
    docId: r.docId as number,
    docFileName: r.docFileName as string,
    sectionPath: r.sectionPath as string,
    text: r.text as string,
    score: r.score,
  }))
}

export async function getDocLinks(): Promise<Array<{
  source: StoredDocument
  target: StoredDocument
  strength: number
  sharedTerms: string[]
}>> {
  const links = await db.docLinks.toArray()
  const docs = await db.documents.toArray()
  const docMap = new Map(docs.map((d) => [d.id!, d]))

  return links
    .map((l) => {
      const source = docMap.get(l.sourceDocId)
      const target = docMap.get(l.targetDocId)
      if (!source || !target) return null
      return { source, target, strength: l.strength, sharedTerms: JSON.parse(l.sharedTerms) as string[] }
    })
    .filter((l): l is NonNullable<typeof l> => l !== null)
    .sort((a, b) => b.strength - a.strength)
}

// ─── Highlights / Annotations ──────────────────────────────────────────────

export async function addHighlight(h: Omit<Highlight, 'id'>): Promise<number> {
  return db.highlights.add(h)
}

export async function getHighlights(docId: number): Promise<Highlight[]> {
  return db.highlights.where('docId').equals(docId).sortBy('startOffset')
}

export async function removeHighlight(id: number) {
  return db.highlights.delete(id)
}

export async function updateHighlightNote(id: number, note: string) {
  return db.highlights.update(id, { note })
}

export async function updateHighlightColor(id: number, color: string) {
  return db.highlights.update(id, { color })
}

// ─── Comments / Annotations ─────────────────────────────────────────────

export async function addComment(c: Omit<Comment, 'id'>): Promise<number> {
  return db.comments.add(c)
}

export async function getComments(docId: number): Promise<Comment[]> {
  return db.comments.where('docId').equals(docId).sortBy('createdAt')
}

export async function updateComment(id: number, updates: Partial<Pick<Comment, 'comment' | 'resolved'>>): Promise<void> {
  await db.comments.update(id, updates)
}

export async function removeComment(id: number): Promise<void> {
  await db.comments.delete(id)
}

export async function getCommentCount(docId: number): Promise<number> {
  return db.comments.where('docId').equals(docId).count()
}

// ─── Louvain community detection ───────────────────────────────────────────

export async function computeCommunities(): Promise<Map<number, number>> {
  const { default: Graph } = await import('graphology')
  const { default: louvain } = await import('graphology-communities-louvain')

  const docs = await db.documents.toArray()
  const links = await db.docLinks.toArray()

  const graph = new Graph()
  for (const doc of docs) graph.addNode(String(doc.id!))
  for (const link of links) {
    const s = String(link.sourceDocId)
    const t = String(link.targetDocId)
    if (graph.hasNode(s) && graph.hasNode(t) && !graph.hasEdge(s, t)) {
      graph.addEdge(s, t, { weight: link.strength })
    }
  }

  if (graph.order < 2) return new Map()

  const communities = louvain(graph, { resolution: 1.0 })

  // Persist community assignments in a single transaction
  const communityMap = new Map<number, number>()
  await db.transaction('rw', db.documents, async () => {
    for (const [nodeId, communityId] of Object.entries(communities)) {
      const docId = parseInt(nodeId)
      communityMap.set(docId, communityId as number)
      await db.documents.update(docId, { communityId: communityId as number })
    }
  })

  return communityMap
}

// ─── UMAP projection ──────────────────────────────────────────────────────

export async function computeUmapProjection(): Promise<Array<{ docId: number; fileName: string; x: number; y: number; communityId: number }>> {
  const { UMAP } = await import('umap-js')

  const docs = await db.documents.toArray()
  if (docs.length < 3) return []

  // Build vocabulary from all docs
  const allTerms = new Set<string>()
  const docVectors: Map<string, number>[] = []
  for (const doc of docs) {
    const tf: Map<string, number> = new Map(Object.entries(JSON.parse(doc.termVectorJson)))
    docVectors.push(tf)
    for (const key of tf.keys()) allTerms.add(key)
  }

  // Create dense vectors (top 500 terms for efficiency)
  const vocab = [...allTerms].slice(0, 500)
  const data = docVectors.map((tf) => vocab.map((term) => tf.get(term) ?? 0))

  const umap = new UMAP({
    nNeighbors: Math.min(15, docs.length - 1),
    minDist: 0.1,
    nComponents: 2,
  })
  const embedding = umap.fit(data)

  return docs.map((d, i) => ({
    docId: d.id!,
    fileName: d.fileName,
    x: embedding[i][0],
    y: embedding[i][1],
    communityId: d.communityId ?? 0,
  }))
}

// ─── Stats & Maintenance ───────────────────────────────────────────────────

export async function getDocStats(): Promise<{
  totalDocs: number
  totalWords: number
  totalChunks: number
  totalHighlights: number
  storageEstimate: string
}> {
  const docs = await db.documents.toArray()
  const totalWords = docs.reduce((sum, d) => sum + d.wordCount, 0)
  const totalChunks = docs.reduce((sum, d) => sum + d.chunkCount, 0)
  const totalHighlights = await db.highlights.count()

  let storageEstimate = 'unknown'
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate()
    const usedMB = ((est.usage ?? 0) / 1024 / 1024).toFixed(1)
    const quotaMB = ((est.quota ?? 0) / 1024 / 1024).toFixed(0)
    storageEstimate = `${usedMB}MB / ${quotaMB}MB`
  }

  return { totalDocs: docs.length, totalWords, totalChunks, totalHighlights, storageEstimate }
}

export async function exportLibrary(): Promise<string> {
  const docs = await db.documents.toArray()
  const highlights = await db.highlights.toArray()
  const comments = await db.comments.toArray()
  return JSON.stringify({ version: 3, exportedAt: Date.now(), docs, highlights, comments })
}

export async function importLibrary(json: string) {
  const data = JSON.parse(json)
  if (!data.docs || !Array.isArray(data.docs)) throw new Error('Invalid export file: missing docs array')
  // Validate all documents before making any changes
  for (const doc of data.docs) {
    if (typeof doc.fileName !== 'string' || typeof doc.markdown !== 'string') {
      throw new Error(`Invalid document: missing fileName or markdown`)
    }
    if (doc.markdown.length > 10 * 1024 * 1024) {
      throw new Error(`Document "${doc.fileName}" exceeds 10MB limit`)
    }
  }
  // Backup existing data before clearing, so we can restore on failure
  let backup: string
  try {
    backup = await exportLibrary()
  } catch {
    throw new Error('Failed to create backup before import. Import aborted — your data is safe.')
  }
  try {
    await clearAllData()
    for (const doc of data.docs) {
      await addDocument(doc.fileName, doc.markdown)
    }
    if (data.highlights && Array.isArray(data.highlights)) {
      for (const h of data.highlights) {
        if (typeof h.text !== 'string' || typeof h.docId !== 'number') continue
        await db.highlights.add({ ...h, id: undefined })
      }
    }
    if (data.comments && Array.isArray(data.comments)) {
      for (const c of data.comments) {
        if (typeof c.selectedText !== 'string' || typeof c.docId !== 'number') continue
        await db.comments.add({ ...c, id: undefined })
      }
    }
  } catch (e) {
    // Restore from backup on failure
    console.error('Import failed, restoring backup:', e)
    try {
      await clearAllData()
      const backupData = JSON.parse(backup)
      for (const doc of backupData.docs) {
        await addDocument(doc.fileName, doc.markdown, { skipPostProcessing: true })
      }
      await finalizeImport()
    } catch { /* best effort restore */ }
    throw e
  }
}

// ─── Document Analysis ────────────────────────────────────────────────────

export async function getAnalysis(docId: number, contentHash: string): Promise<DocumentAnalysis | undefined> {
  return db.documentAnalyses.where({ docId, contentHash }).first()
}

export async function saveAnalysis(analysis: DocumentAnalysis): Promise<number> {
  await db.documentAnalyses.where('docId').equals(analysis.docId).delete()
  return db.documentAnalyses.add(analysis)
}

export async function getAnalysisByDocId(docId: number): Promise<DocumentAnalysis | undefined> {
  return db.documentAnalyses.where('docId').equals(docId).first()
}

export async function clearAnalyses(): Promise<void> {
  await db.documentAnalyses.clear()
}

// ─── Audio Cache ──────────────────────────────────────────────────────────

export async function getCachedAudio(contentHash: string, segmentIndex: number): Promise<CachedAudio | undefined> {
  return db.audioCache.where({ contentHash, segmentIndex }).first()
}

export async function cacheAudioSegment(contentHash: string, segmentIndex: number, pcm: Float32Array, sampleRate: number): Promise<void> {
  await db.audioCache.put({
    contentHash,
    segmentIndex,
    pcm: (pcm.buffer as ArrayBuffer).slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
    sampleRate,
    createdAt: Date.now(),
  })
}

export async function getFullCachedAudio(contentHash: string): Promise<CachedAudio[]> {
  return db.audioCache.where('contentHash').equals(contentHash).sortBy('segmentIndex')
}

export async function clearAudioCache(): Promise<void> {
  await db.audioCache.clear()
}

export async function clearAllData() {
  await db.transaction('rw', [db.chunks, db.docLinks, db.documents, db.highlights, db.comments, db.searchCache], async () => {
    await db.chunks.clear()
    await db.docLinks.clear()
    await db.documents.clear()
    await db.highlights.clear()
    await db.comments.clear()
    await db.searchCache.clear()
  })
  searchIndex = null
}
