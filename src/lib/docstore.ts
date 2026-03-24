import Dexie, { type Table } from 'dexie'
import MiniSearch from 'minisearch'
import murmur from 'murmurhash-js'
import { chunkMarkdown, extractToc, wordCount } from './markdown'
import type { TocEntry } from '../store/useStore'

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
}

export interface SearchIndexBlob {
  id: string // always 'main'
  data: string // JSON serialized MiniSearch
}

// ─── Database Schema (v2: compound indexes, highlights, search cache) ──────

export interface CollectionCache {
  id: string // always 'last'
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
  searchCache!: Table<SearchIndexBlob>
  collectionCache!: Table<CollectionCache>

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
  }
}

export const db = new MdReaderDB()

// ─── Collection cache (persist directory sessions across reloads) ──────────

export async function saveCollectionCache(
  name: string,
  files: Array<{ path: string; content: string }>,
  currentFileIndex: number,
): Promise<void> {
  await db.collectionCache.put({
    id: 'last',
    name,
    files,
    currentFileIndex,
    savedAt: Date.now(),
  })
}

export async function loadCollectionCache(): Promise<CollectionCache | null> {
  const cached = await db.collectionCache.get('last')
  return cached ?? null
}

export async function clearCollectionCache(): Promise<void> {
  await db.collectionCache.delete('last')
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

function computeSimhash(text: string): number {
  const tokens = tokenize(text)
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

function hammingDistance(a: number, b: number): number {
  let xor = a ^ b
  let count = 0
  while (xor) {
    count += xor & 1
    xor >>= 1
  }
  return count
}

export async function findNearDuplicates(simhash: number): Promise<StoredDocument[]> {
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
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1)
  const max = Math.max(...freq.values(), 1)
  for (const [k, v] of freq) freq.set(k, v / max)
  return freq
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

export async function addDocument(fileName: string, markdown: string): Promise<AddDocumentResult> {
  const contentHash = await sha256(markdown)
  const simhash = computeSimhash(markdown)

  // Check exact duplicate
  const exactDup = await db.documents.where('contentHash').equals(contentHash).first()
  if (exactDup) {
    return { docId: exactDup.id!, nearDuplicates: [], isExactDuplicate: true }
  }

  // Check near-duplicates (SimHash Hamming distance <= 3)
  const nearDups = await findNearDuplicates(simhash)

  // Remove old version if same filename
  const existing = await db.documents.where('fileName').equals(fileName).first()
  if (existing) await removeDocument(existing.id!)

  const toc = extractToc(markdown)
  const chunks = chunkMarkdown(markdown)
  const docTf = computeTermFrequency(markdown)

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

  // Store chunks in batches with heading level metadata
  const storedChunks: Omit<StoredChunk, 'id'>[] = chunks.map((c) => {
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
  // Batch in groups of 200
  for (let i = 0; i < storedChunks.length; i += 200) {
    await db.chunks.bulkAdd(storedChunks.slice(i, i + 200))
  }

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
  return { docId, nearDuplicates: nearDups, isExactDuplicate: false }
}

export async function removeDocument(docId: number) {
  await db.transaction('rw', [db.chunks, db.docLinks, db.documents, db.highlights], async () => {
    await db.chunks.where('docId').equals(docId).delete()
    await db.docLinks.where('sourceDocId').equals(docId).delete()
    await db.docLinks.where('targetDocId').equals(docId).delete()
    await db.highlights.where('docId').equals(docId).delete()
    await db.documents.delete(docId)
  })
  await rebuildIndex()
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

  // Persist community assignments
  const communityMap = new Map<number, number>()
  for (const [nodeId, communityId] of Object.entries(communities)) {
    const docId = parseInt(nodeId)
    communityMap.set(docId, communityId as number)
    await db.documents.update(docId, { communityId: communityId as number })
  }

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
  return JSON.stringify({ version: 2, exportedAt: Date.now(), docs, highlights })
}

export async function importLibrary(json: string) {
  const data = JSON.parse(json)
  if (!data.docs || !Array.isArray(data.docs)) throw new Error('Invalid export file: missing docs array')
  // Validate each document has required fields and reasonable sizes
  for (const doc of data.docs) {
    if (typeof doc.fileName !== 'string' || typeof doc.markdown !== 'string') {
      throw new Error(`Invalid document: missing fileName or markdown`)
    }
    if (doc.markdown.length > 10 * 1024 * 1024) {
      throw new Error(`Document "${doc.fileName}" exceeds 10MB limit`)
    }
  }
  await clearAllData()
  for (const doc of data.docs) {
    await addDocument(doc.fileName, doc.markdown)
  }
  if (data.highlights && Array.isArray(data.highlights)) {
    for (const h of data.highlights) {
      if (typeof h.text !== 'string' || typeof h.docId !== 'number') continue // skip invalid
      await db.highlights.add({ ...h, id: undefined })
    }
  }
}

export async function clearAllData() {
  await db.transaction('rw', [db.chunks, db.docLinks, db.documents, db.highlights, db.searchCache], async () => {
    await db.chunks.clear()
    await db.docLinks.clear()
    await db.documents.clear()
    await db.highlights.clear()
    await db.searchCache.clear()
  })
  searchIndex = null
}
