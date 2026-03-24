import type { DocumentChunk } from './markdown'

/**
 * Simple cosine similarity search over document chunks.
 * Phase 1: keyword-based search (no ML embeddings yet).
 * Phase 4 will add transformers.js for semantic embeddings.
 */

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2)
}

function termFrequency(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>()
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1)
  }
  return freq
}

export function searchChunks(query: string, chunks: DocumentChunk[], topK = 5): DocumentChunk[] {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return chunks.slice(0, topK)

  const scored = chunks.map((chunk) => {
    const chunkTokens = tokenize(chunk.text)
    const chunkFreq = termFrequency(chunkTokens)
    let score = 0
    for (const qt of queryTokens) {
      score += chunkFreq.get(qt) ?? 0
    }
    // Boost exact phrase matches
    const lowerText = chunk.text.toLowerCase()
    const lowerQuery = query.toLowerCase()
    if (lowerText.includes(lowerQuery)) score += 10
    return { chunk, score }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter((s) => s.score > 0)
    .map((s) => s.chunk)
}
