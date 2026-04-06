/**
 * Chunk Annotation + Analysis Pipeline
 * Deterministic content-type detection, chunk annotation, and document structure classification.
 * The async analyzeDocument() function ties together AI themes, BM25 retrieval, and DB persistence.
 */

import type { AnalyzedChunk, ChunkContentType, DocumentAnalysis, Entity, Theme } from './docstore'
import { getAnalysis, saveAnalysis, getDocLinks, searchAcrossDocuments } from './docstore'
import { chatFast, type ChatMessage, getActiveBackend } from './ai'
import { PROMPTS, PROMPT_CONFIG } from './prompts'
import { estimateDifficulty } from './markdown'

// ─── Helpers ───────────────────────────────────────────────────────────────

const yieldToMain = () => new Promise<void>((r) => setTimeout(r, 0))

// ─── Content Type Weights ──────────────────────────────────────────────────

const CONTENT_WEIGHTS: Record<ChunkContentType, number> = {
  prose: 1.0,
  list: 0.7,
  table: 0.6,
  diagram: 0.5,
  code: 0.3,
  heading: 0.1,
  mixed: 0.8,
}

// ─── detectContentType ─────────────────────────────────────────────────────

/**
 * Detects the primary content type of a markdown text snippet.
 * Returns 'mixed' when multiple content types are present.
 */
export function detectContentType(text: string): ChunkContentType {
  const trimmed = text.trim()

  const hasCode = /```[\s\S]*?```/.test(trimmed)
  const hasTable = /^\|.+\|$/m.test(trimmed)
  const hasList = /^(\s*[-*+] |\s*\d+\. )/m.test(trimmed)
  const hasDiagram = /!\[.*?\]\(.*?\.(excalidraw|drawio|svg|mermaid).*?\)/i.test(trimmed)
  const hasHeadingOnly = /^#{1,6} /.test(trimmed) && trimmed.split('\n').length === 1

  // Count how many types are present
  const types = [hasCode, hasTable, hasList, hasDiagram].filter(Boolean).length

  // Mixed: more than one structural type
  if (types > 1) return 'mixed'

  // Single-line heading with no other content
  if (hasHeadingOnly && !hasCode && !hasTable && !hasList && !hasDiagram) return 'heading'

  // A heading mixed with other content counts as mixed
  const hasHeading = /^#{1,6} /m.test(trimmed)
  if (hasHeading && (hasCode || hasTable || hasList || hasDiagram)) return 'mixed'
  // Prose with a heading prefix and substantial prose — check for code
  if (hasCode && trimmed.split('\n').some((l) => l.trim() && !l.startsWith('```') && !/^#+/.test(l) && !/^\|/.test(l) && !/^[-*+\d]/.test(l))) {
    // has prose lines alongside code → mixed
    const nonCodeLines = trimmed
      .replace(/```[\s\S]*?```/g, '')
      .split('\n')
      .filter((l) => l.trim().length > 0)
    if (nonCodeLines.length > 0) return 'mixed'
    return 'code'
  }
  if (hasCode) return 'code'
  if (hasDiagram) return 'diagram'
  if (hasTable) return 'table'
  if (hasList) return 'list'
  if (hasHeading) return 'heading'

  return 'prose'
}

// ─── annotateChunks ────────────────────────────────────────────────────────

/**
 * Annotates an array of chunks with content type and retrieval weight.
 */
export function annotateChunks(
  chunks: Array<{ id?: number; text: string }>,
): AnalyzedChunk[] {
  return chunks.map((chunk) => {
    const contentType = detectContentType(chunk.text)
    return {
      chunkId: chunk.id ?? 0,
      contentType,
      weight: CONTENT_WEIGHTS[contentType],
    }
  })
}

// ─── classifyStructure ─────────────────────────────────────────────────────

/**
 * Classifies the overall document structure based on heading patterns and prose density.
 */
export function classifyStructure(
  markdown: string,
): 'tutorial' | 'reference' | 'narrative' | 'mixed' {
  const lines = markdown.split('\n')

  // Extract H2 headings
  const h2Headings = lines.filter((l) => /^## /.test(l))

  // Tutorial: headings contain sequential step indicators
  const stepPattern = /\bstep\s+\d+\b|\b\d+\.\s*(install|configure|setup|run|build|create|deploy|test)\b/i
  const hasSteps = h2Headings.some((h) => stepPattern.test(h))
  if (hasSteps && h2Headings.length >= 2) return 'tutorial'

  // Reference: 4+ flat H2 sections (API-style, short headings)
  if (h2Headings.length >= 4) {
    const avgLen = h2Headings.reduce((s, h) => s + h.replace(/^## /, '').length, 0) / h2Headings.length
    if (avgLen <= 30) return 'reference'
  }

  // Narrative: dominated by long prose (few headings, many words)
  const wordCount = markdown.split(/\s+/).filter(Boolean).length
  const headingCount = lines.filter((l) => /^#{1,6} /.test(l)).length
  if (wordCount > 300 && headingCount <= 2) return 'narrative'

  return 'mixed'
}

// ─── extractEntitiesDeterministic ─────────────────────────────────────────

/**
 * Extracts named entities from bold text, headings, and inline code.
 * Purely deterministic — no AI required.
 */
export function extractEntitiesDeterministic(markdown: string): Entity[] {
  const counts = new Map<string, { type: Entity['type']; mentions: number }>()

  function add(name: string, type: Entity['type']) {
    const key = name.trim()
    if (!key || key.length < 2) return
    const existing = counts.get(key)
    if (existing) {
      existing.mentions++
    } else {
      counts.set(key, { type, mentions: 1 })
    }
  }

  // Bold/strong text → concepts
  for (const [, text] of markdown.matchAll(/\*\*([^*]+)\*\*/g)) add(text, 'concept')
  for (const [, text] of markdown.matchAll(/__([^_]+)__/g)) add(text, 'concept')

  // Headings (H2-H4) → concepts/processes
  for (const [, text] of markdown.matchAll(/^#{2,4} (.+)$/gm)) add(text, 'concept')

  // Inline code → technology
  for (const [, text] of markdown.matchAll(/`([^`]+)`/g)) {
    // Skip short fragments and pure numbers
    if (text.length >= 2 && !/^\d+$/.test(text)) add(text, 'technology')
  }

  return [...counts.entries()]
    .map(([name, { type, mentions }]) => ({ name, type, mentions }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 50)
}

// ─── analyzeDocument ──────────────────────────────────────────────────────

/**
 * Full analysis pipeline for a document.
 * 1. Cache check
 * 2. Deterministic chunk annotation
 * 3. AI theme extraction (with fallback to headings)
 * 4. BM25 chunk retrieval per theme
 * 5. Deterministic entity extraction
 * 6. Difficulty + structure classification
 * 7. Cross-doc enrichment
 * 8. Persist to IndexedDB
 */
export async function analyzeDocument(
  docId: number,
  markdown: string,
  contentHash: string,
  onProgress?: (step: string) => void,
  signal?: AbortSignal,
): Promise<DocumentAnalysis> {
  // 1. Cache check
  const cached = await getAnalysis(docId, contentHash)
  if (cached) return cached

  const report = (msg: string) => onProgress?.(msg)

  report('Annotating chunks…')
  await yieldToMain()

  // 2. Annotate chunks (deterministic) — use simple line-based chunking
  const rawChunks = markdown
    .split(/\n\n+/)
    .map((text, i) => ({ id: i, text: text.trim() }))
    .filter((c) => c.text.length > 0)

  const annotatedChunks = annotateChunks(rawChunks)
  await yieldToMain()

  // 3. AI theme extraction
  report('Extracting themes…')
  let themes: Theme[] = []

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const backend = getActiveBackend()
  if (backend !== 'none') {
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: PROMPTS.podcastOutline },
        {
          role: 'user',
          content: markdown.slice(0, PROMPT_CONFIG.podcastOutlineMaxInput),
        },
      ]
      const raw = await chatFast(messages, { signal })
      // Parse JSON themes from AI response (best-effort)
      const jsonMatch = raw.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed)) {
          themes = parsed.slice(0, 6).map((t: Record<string, unknown>) => ({
            title: String(t.title ?? t.topic ?? ''),
            description: String(t.description ?? t.summary ?? ''),
            relevanceScore: Number(t.relevanceScore ?? t.importance ?? 0.5),
            chunkIds: [],
          })).filter((t) => t.title)
        }
      }
    } catch {
      // Fallback below
    }
  }

  // Fallback: extract themes from H2/H3 headings
  if (themes.length === 0) {
    const headings = [...markdown.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1])
    themes = headings.slice(0, 6).map((h) => ({
      title: h,
      description: '',
      relevanceScore: 0.5,
      chunkIds: [],
    }))
  }

  await yieldToMain()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  // 4. BM25 retrieval per theme
  report('Retrieving relevant chunks…')
  for (const theme of themes) {
    if (signal?.aborted) break
    try {
      const results = await searchAcrossDocuments(theme.title, 5)
      theme.chunkIds = results.map((r) => r.docId)
    } catch {
      // Non-fatal: leave chunkIds empty
    }
    await yieldToMain()
  }

  // 5. Entities (deterministic)
  report('Extracting entities…')
  const entities = extractEntitiesDeterministic(markdown)
  await yieldToMain()

  // 6. Difficulty + structure
  report('Classifying document…')
  const rawDifficulty = estimateDifficulty(markdown).toLowerCase()
  const difficulty = (['beginner', 'intermediate', 'advanced', 'expert'].includes(rawDifficulty)
    ? rawDifficulty
    : 'intermediate') as DocumentAnalysis['difficulty']
  const structure = classifyStructure(markdown)
  await yieldToMain()

  // 7. Cross-doc enrichment
  report('Cross-doc enrichment…')
  let relatedDocIds: number[] = []
  let crossDocThemes: string[] = []
  try {
    const links = await getDocLinks()
    const docLinks = links.filter(
      (l) => l.source.id === docId || l.target.id === docId,
    )
    relatedDocIds = docLinks.map((l) =>
      l.source.id === docId ? l.target.id! : l.source.id!,
    )
    crossDocThemes = docLinks.flatMap((l) => l.sharedTerms).slice(0, 10)
  } catch {
    // Non-fatal
  }

  // 8. Build and save analysis
  const analysis: DocumentAnalysis = {
    docId,
    contentHash,
    themes,
    entities,
    chunks: annotatedChunks,
    difficulty,
    structure,
    relatedDocIds,
    crossDocThemes,
    analyzedAt: Date.now(),
    model: backend,
    version: 1,
  }

  report('Saving analysis…')
  await saveAnalysis(analysis)

  return analysis
}
