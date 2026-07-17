import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'

const { chatFastMock } = vi.hoisted(() => ({
  chatFastMock: vi.fn(async (_messages: Array<{ role: string; content: string }>) =>
    '[{"speaker":"A","text":"Alpha opening line one"},{"speaker":"B","text":"Beta reply line two"},{"speaker":"A","text":"Gamma detail line three"},{"speaker":"B","text":"Delta closing line four"}]'
  ),
}))

// podcast.ts + analysis.ts both import from ../lib/ai — mock every named
// export they touch so nothing hits the network.
vi.mock('../lib/ai', () => ({
  chatFast: chatFastMock,
  checkOllamaHealth: async () => false,
  getOllamaBaseUrl: () => 'http://localhost:11434',
  getActiveBackend: () => 'ollama',
}))

vi.mock('../lib/storage-manager', () => ({
  ensureStorageBudget: async () => {},
}))

// Deterministic preset — device-independent pipeline, no dramatize/transitions.
vi.mock('../lib/device-profile', () => ({
  getPodcastPreset: () => ({
    themesQuick: 3,
    themesDetailed: 5,
    exchangesPerThemeQuick: 4,
    exchangesPerThemeDetailed: 8,
    maxTokensQuick: 500,
    maxTokensDetailed: 900,
    enableDramatize: false,
    enableSlidingWindow: false,
    enableDeduplication: false,
    enableTransitions: false,
    parallelBatchSize: 2,
    scriptTemperature: 0.15,
    dramatizeTemperature: 0.15,
  }),
}))

import { generatePodcast, generateDeepPodcast, type PodcastScript } from '../lib/podcast'
import { db, type DocumentAnalysis } from '../lib/docstore'
import type { ChatMessage } from '../lib/ai'

beforeEach(() => {
  chatFastMock.mockClear()
})

describe('generatePodcast cache (A4 — duration persisted with the script)', () => {
  it('cache-hits a second detailed request for the same content', async () => {
    const md = '# Cache Doc\n\n## Topic One\nBody for topic one goes here.\n\n## Topic Two\nBody for topic two goes here.'
    const first = await generatePodcast(md, 'Cache Doc', undefined, undefined, { duration: 'detailed' })
    expect(first.duration).toBe('detailed')

    const callsAfterFirst = chatFastMock.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0)

    const second = await generatePodcast(md, 'Cache Doc', undefined, undefined, { duration: 'detailed' })
    expect(chatFastMock.mock.calls.length).toBe(callsAfterFirst) // no regeneration
    expect(second.scriptLines).toEqual(first.scriptLines)
  })
})

describe('generatePodcast heading fast-path (A5 — themes are single-line headings)', () => {
  it('never sends a multi-line theme blob to the script prompts', async () => {
    const md = '# A5 Doc\n\n## Alpha Section\nAlpha body sentence that must not leak into the theme.\n\n## Beta Section\nBeta body sentence that also must not leak.'
    await generatePodcast(md, 'A5 Doc', undefined, undefined, { duration: 'quick' })

    const themes: string[] = []
    for (const call of chatFastMock.mock.calls) {
      const messages = call[0] as ChatMessage[]
      const user = messages.find((m) => m.role === 'user')?.content ?? ''
      const m = /Theme: ([\s\S]*?)\n\nSource material:/.exec(user)
      if (m) themes.push(m[1])
    }
    expect(themes.length).toBeGreaterThan(0)
    for (const t of themes) expect(t).not.toContain('\n')
    expect(themes).toContain('Alpha Section')
  })
})

describe('generateDeepPodcast (A6 — no intro/outro slice on theme segments)', () => {
  it('keeps the first and last dialogue lines of the deep section', async () => {
    const relatedId = (await db.documents.add({
      fileName: 'related.md',
      markdown: '# Related\n\nDeep dive body content for the related doc.',
      addedAt: Date.now(),
      wordCount: 10,
      chunkCount: 1,
      toc: [],
      contentHash: 'related-hash',
      simhash: 0,
      termVectorJson: '{}',
    })) as number
    await db.documentAnalyses.add({
      docId: relatedId,
      contentHash: 'related-hash',
      themes: [{ title: 'Fresh Deep Theme', description: '', relevanceScore: 1, chunkIds: [] }],
      entities: [],
      chunks: [],
      difficulty: 'beginner',
      structure: 'mixed',
      relatedDocIds: [],
      crossDocThemes: [],
      analyzedAt: Date.now(),
      model: 'test',
      version: 1,
    })

    const currentScript: PodcastScript = {
      title: 'Current Doc',
      contentHash: 'current-hash',
      segments: [
        { speaker: 'A', text: 'Welcome to the show.', rate: 1, pitch: 1, pauseBefore: 0 },
        { speaker: 'A', text: 'Thanks for listening.', rate: 1, pitch: 1, pauseBefore: 300 },
      ],
      scriptLines: [],
      scope: 'single',
      persona: 'overview',
      sourceDocIds: [],
      createdAt: Date.now(),
    }
    const analysis: DocumentAnalysis = {
      docId: 999,
      contentHash: 'current-hash',
      themes: [{ title: 'Existing Theme', description: '', relevanceScore: 1, chunkIds: [] }],
      entities: [],
      chunks: [],
      difficulty: 'beginner',
      structure: 'mixed',
      relatedDocIds: [relatedId],
      crossDocThemes: [],
      analyzedAt: Date.now(),
      model: 'test',
      version: 1,
    }

    const deep = await generateDeepPodcast(currentScript, analysis)
    const allText = deep.segments.map((s) => s.text).join(' | ')
    // The mocked LLM returned exactly four lines. ALL four must be audible.
    expect(allText).toContain('Alpha opening line one')
    expect(allText).toContain('Beta reply line two')
    expect(allText).toContain('Gamma detail line three')
    expect(allText).toContain('Delta closing line four')
    // The original outro must still close the episode.
    expect(deep.segments[deep.segments.length - 1].text).toBe('Thanks for listening.')
  })
})
