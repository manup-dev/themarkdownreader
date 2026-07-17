import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  hammingDistance,
  addDocument,
  addHighlight,
  addComment,
  exportLibrary,
  importLibrary,
  getAllDocuments,
  getHighlights,
  getComments,
  clearAllData,
} from '../lib/docstore'

describe('hammingDistance (A1 — real implementation, not a local re-implementation)', () => {
  it('terminates and returns 1 for a sign-bit-only difference (used to infinite-loop)', () => {
    // computeSimhashFromTokens sets bit 31 (1 << 31 → negative int32) for
    // roughly half of all docs; `xor >>= 1` on a negative number never
    // reaches 0, so addDocument → findNearDuplicates froze the tab.
    expect(hammingDistance(-2147483648, 0)).toBe(1)
  })

  it('counts all 32 bits for -1 vs 0', () => {
    expect(hammingDistance(-1, 0)).toBe(32)
  })

  it('computes small positive distances correctly', () => {
    expect(hammingDistance(0b1011, 0b0010)).toBe(2)
    expect(hammingDistance(42, 42)).toBe(0)
  })
})

describe('importLibrary (A2 — annotations must follow their documents)', () => {
  beforeEach(async () => {
    await clearAllData()
  })

  it('round-trips highlights and comments onto the re-imported documents', async () => {
    const { docId } = await addDocument('a.md', '# Alpha\n\nSome alpha content to annotate.')
    await addHighlight({ docId, text: 'alpha content', startOffset: 14, endOffset: 27, color: 'yellow', note: 'important', createdAt: Date.now() })
    await addComment({ docId, selectedText: 'alpha content', comment: 'check this', author: 'You', sectionId: 'alpha', createdAt: Date.now(), resolved: false })

    const exported = await exportLibrary()
    await importLibrary(exported)

    const docs = await getAllDocuments()
    const imported = docs.find((d) => d.fileName === 'a.md')
    expect(imported).toBeDefined()
    // IndexedDB's clear() does NOT reset the key generator, so the
    // re-imported doc gets a NEW id — annotations must point at it.
    const highlights = await getHighlights(imported!.id!)
    const comments = await getComments(imported!.id!)
    expect(highlights).toHaveLength(1)
    expect(highlights[0].note).toBe('important')
    expect(comments).toHaveLength(1)
    expect(comments[0].comment).toBe('check this')
  })

  it('remaps arbitrary export docIds (not just sequential ones)', async () => {
    const payload = JSON.stringify({
      version: 3,
      exportedAt: Date.now(),
      docs: [{ id: 57, fileName: 'z.md', markdown: '# Zeta\n\nZeta body text.' }],
      highlights: [{ id: 9, docId: 57, text: 'Zeta body', startOffset: 8, endOffset: 17, color: 'green', note: '', createdAt: 1 }],
      comments: [],
    })
    await importLibrary(payload)
    const docs = await getAllDocuments()
    expect(docs).toHaveLength(1)
    const highlights = await getHighlights(docs[0].id!)
    expect(highlights).toHaveLength(1)
    expect(highlights[0].text).toBe('Zeta body')
  })
})
