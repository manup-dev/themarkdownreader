import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { addDocument, clearAllData, clearAnalyses, db, getDocumentChunks } from '../lib/docstore'
import { analyzeDocument } from '../lib/analysis'

// No AI backend in tests: ai.ts starts with activeBackend 'none', so
// analyzeDocument takes the deterministic heading-fallback path (no network).

const FILLER = `# Cooking Notes

Long filler about sourdough baking, hydration ratios, and oven spring.

## Kneading

More filler text about folding dough and gluten development windowpanes.

## Proofing

Cold retard schedules and banneton dusting flour notes for the bake.
`

const TARGET = `# Systems Doc

Intro paragraph about the system under test.

## Zephyr Quokka Protocol

The Zephyr Quokka Protocol handshake begins with a Zephyr hello frame.
Quokka acknowledgements follow the Zephyr hello with a protocol nonce.

## Deployment

Deployment notes for the Zephyr rollout across the fleet.
`

describe('analyzeDocument (A3 — chunk primary keys, not doc ids)', () => {
  beforeEach(async () => {
    await clearAllData()
    await clearAnalyses()
  })

  it('stores chunk primary keys in theme.chunkIds, resolvable via db.chunks', async () => {
    // Filler doc first so doc ids and chunk ids diverge: with the bug,
    // chunkIds hold DOC ids, which bulkGet resolves to the FILLER's chunks.
    await addDocument('filler.md', FILLER)
    const { docId } = await addDocument('target.md', TARGET)

    const analysis = await analyzeDocument(docId, TARGET, 'test-hash-a3')

    const theme = analysis.themes.find((t) => t.title.includes('Zephyr'))
    expect(theme).toBeDefined()
    expect(theme!.chunkIds.length).toBeGreaterThan(0)
    for (const chunkId of theme!.chunkIds) {
      const chunk = await db.chunks.get(chunkId)
      expect(chunk).toBeDefined()
      // BM25 hits for "Zephyr Quokka Protocol" must resolve to chunks
      // actually about it — not whatever chunk shares a pk with a doc id.
      expect(/zephyr|quokka|protocol/i.test(chunk!.text)).toBe(true)
    }
  })

  it('annotates chunks in the db.chunks keyspace (podcast.ts matches chunkId to stored.id)', async () => {
    await addDocument('filler.md', FILLER)
    const { docId } = await addDocument('target.md', TARGET)

    const analysis = await analyzeDocument(docId, TARGET, 'test-hash-a3b')

    const storedIds = new Set((await getDocumentChunks(docId)).map((c) => c.id!))
    expect(analysis.chunks.length).toBeGreaterThan(0)
    for (const ac of analysis.chunks) {
      expect(storedIds.has(ac.chunkId)).toBe(true)
    }
  })
})
