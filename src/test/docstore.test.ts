import { describe, it, expect } from 'vitest'

// Test the pure functions from docstore without IndexedDB (which needs a browser)
// The TF-IDF and cosine similarity logic is the core algorithm

// Replicate the pure functions for testing
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'some', 'them',
  'than', 'its', 'over', 'such', 'that', 'this', 'with', 'will', 'each',
  'from', 'they', 'were', 'which', 'their', 'said', 'what', 'about', 'into',
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
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1)
  }
  const max = Math.max(...freq.values(), 1)
  for (const [k, v] of freq) {
    freq.set(k, v / max)
  }
  return freq
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, normA = 0, normB = 0
  const allKeys = new Set([...a.keys(), ...b.keys()])
  for (const key of allKeys) {
    const va = a.get(key) ?? 0
    const vb = b.get(key) ?? 0
    dot += va * vb
    normA += va * va
    normB += vb * vb
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

describe('tokenize', () => {
  it('removes stop words and short words', () => {
    const tokens = tokenize('The quick brown fox and the lazy dog')
    expect(tokens).not.toContain('the')
    expect(tokens).not.toContain('and')
    expect(tokens).toContain('quick')
    expect(tokens).toContain('brown')
  })

  it('lowercases and strips punctuation', () => {
    const tokens = tokenize('Hello, WORLD! Testing... 123')
    expect(tokens).toContain('hello')
    expect(tokens).toContain('world')
    expect(tokens).toContain('testing')
    expect(tokens).toContain('123')
  })
})

describe('computeTermFrequency', () => {
  it('normalizes frequencies to 0-1 range', () => {
    const tf = computeTermFrequency('docker docker docker kubernetes kubernetes')
    expect(tf.get('docker')).toBe(1) // most frequent = 1
    expect(tf.get('kubernetes')).toBeCloseTo(0.667, 1)
  })
})

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const a = new Map([['foo', 1], ['bar', 0.5]])
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5)
  })

  it('returns 0 for orthogonal vectors', () => {
    const a = new Map([['foo', 1]])
    const b = new Map([['bar', 1]])
    expect(cosineSimilarity(a, b)).toBe(0)
  })

  it('returns high similarity for related documents', () => {
    const docA = computeTermFrequency('React components and hooks for building user interfaces with JavaScript')
    const docB = computeTermFrequency('Building React applications with components hooks and state management')
    const docC = computeTermFrequency('Docker containers and Kubernetes orchestration for cloud deployment')

    const simAB = cosineSimilarity(docA, docB)
    const simAC = cosineSimilarity(docA, docC)

    expect(simAB).toBeGreaterThan(simAC) // React docs should be more similar to each other
    expect(simAB).toBeGreaterThan(0.3)
    expect(simAC).toBeLessThan(0.2)
  })

  it('handles empty vectors', () => {
    const empty = new Map<string, number>()
    const some = new Map([['foo', 1]])
    expect(cosineSimilarity(empty, some)).toBe(0)
  })
})
