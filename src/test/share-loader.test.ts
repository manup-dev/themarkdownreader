import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { loadShareFromHash } from '../lib/share-loader'
import { db } from '../lib/docstore'
import { buildInlineShare } from '../lib/share-url'
import { encodeWal, SCHEMA_VERSION, type AnnotationEvent } from '../lib/annotation-events'
import { makeHeader } from '../lib/annotation-log'

const ORIGIN = 'https://mdreader.app'
const ts = Date.parse('2026-04-22T00:00:00Z')

async function reset() {
  await db.documents.clear()
  await db.highlights.clear()
  await db.comments.clear()
  await db.annotationLog.clear()
  await db.annotationCheckpoint.clear()
  await db.chunks.clear()
  await db.docLinks.clear()
}

function fakeAdapter(opts: { markdown: string; fileName: string; events: AnnotationEvent[]; sourceUrl: string }) {
  return {
    parseShareUrl: () => null,
    fetchDocument: vi.fn(async () => ({
      markdown: opts.markdown,
      fileName: opts.fileName,
      sourceUrl: opts.sourceUrl,
      contentHash: undefined,
    })),
    fetchAnnotations: vi.fn(async () => opts.events),
  }
}

describe('loadShareFromHash', () => {
  beforeEach(async () => {
    await reset()
  })

  it('returns null when the URL has no share params', async () => {
    const result = await loadShareFromHash({ href: 'https://mdreader.app/', adapter: fakeAdapter({ markdown: '', fileName: '', events: [], sourceUrl: '' }) })
    expect(result).toBeNull()
  })

  it('opens a Tier-1 inline share and imports events', async () => {
    const events: AnnotationEvent[] = [
      makeHeader({ docKey: 'k', title: 'shared.md', createdBy: 'manu' }),
      {
        v: SCHEMA_VERSION,
        ts,
        id: 'h1',
        op: 'highlight.add',
        docKey: 'k',
        anchor: { byteOffset: 0, markdownStart: 0, markdownEnd: 5, exact: 'Hello', prefix: '', suffix: '', sectionId: '', offsetInSection: 0 },
        color: 'yellow',
      } as AnnotationEvent,
    ]
    const wal = encodeWal(events)
    const { url } = buildInlineShare({ origin: ORIGIN, docUrl: 'https://example.com/shared.md', walJsonl: wal })

    const adapter = fakeAdapter({
      markdown: '# Hello world\n\nBody.',
      fileName: 'shared.md',
      events,
      sourceUrl: 'https://example.com/shared.md',
    })

    const result = await loadShareFromHash({ href: url, adapter, consumeHash: false })
    expect(result).not.toBeNull()
    expect(result!.docId).toBeGreaterThan(0)
    expect(result!.eventsImported).toBe(2) // header + highlight
    expect(result!.highlightsAdded).toBe(1)
    expect(result!.banner.createdBy).toBe('manu')
    expect(result!.banner.highlightCount).toBe(1)
    expect(result!.banner.driftWarning).toBe(false)
    expect(await db.highlights.count()).toBe(1)
  })

  it('flags drift when share contentHash mismatches local hash', async () => {
    const handleUrl = `${ORIGIN}/#url=https%3A%2F%2Fexample.com%2Fshared.md&hash=sha256:wronghash`
    const adapter = fakeAdapter({
      markdown: '# Hello',
      fileName: 'shared.md',
      events: [],
      sourceUrl: 'https://example.com/shared.md',
    })
    const result = await loadShareFromHash({ href: handleUrl, adapter, consumeHash: false })
    expect(result!.banner.driftWarning).toBe(true)
  })

  it('reuses an existing local doc instead of duplicating (contentHash dedup)', async () => {
    const adapter = fakeAdapter({
      markdown: '# Same content',
      fileName: 'shared.md',
      events: [],
      sourceUrl: 'https://example.com/shared.md',
    })
    const handleUrl = `${ORIGIN}/#url=https%3A%2F%2Fexample.com%2Fshared.md`
    const first = await loadShareFromHash({ href: handleUrl, adapter, consumeHash: false })
    const second = await loadShareFromHash({ href: handleUrl, adapter, consumeHash: false })
    expect(second!.docId).toBe(first!.docId)
    expect(await db.documents.count()).toBe(1)
  })

  it('survives gracefully when annotations payload is empty', async () => {
    const adapter = fakeAdapter({
      markdown: '# A doc',
      fileName: 'shared.md',
      events: [],
      sourceUrl: 'https://example.com/shared.md',
    })
    const handleUrl = `${ORIGIN}/#url=https%3A%2F%2Fexample.com%2Fshared.md`
    const result = await loadShareFromHash({ href: handleUrl, adapter, consumeHash: false })
    expect(result!.eventsImported).toBe(0)
    expect(result!.banner.highlightCount).toBe(0)
    expect(result!.banner.commentCount).toBe(0)
  })

  it('honors highlight.del when counting for the banner', async () => {
    const events: AnnotationEvent[] = [
      { v: 1, ts, id: 'h1', op: 'highlight.add', docKey: 'k', anchor: { byteOffset: 0 }, color: 'y' } as AnnotationEvent,
      { v: 1, ts: ts + 1, id: 'h1', op: 'highlight.del', docKey: 'k' } as AnnotationEvent,
    ]
    const adapter = fakeAdapter({
      markdown: '# Doc',
      fileName: 'shared.md',
      events,
      sourceUrl: 'https://example.com/shared.md',
    })
    const handleUrl = `${ORIGIN}/#url=https%3A%2F%2Fexample.com%2Fshared.md`
    const result = await loadShareFromHash({ href: handleUrl, adapter, consumeHash: false })
    expect(result!.banner.highlightCount).toBe(0)
  })
})
