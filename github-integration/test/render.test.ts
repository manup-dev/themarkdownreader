import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { renderCommentsMarkdown } from '../src/render'
import type { DocState, MaterializedComment } from '../src/parser'

const HERE = dirname(fileURLToPath(import.meta.url))

function comment(over: Partial<MaterializedComment>): MaterializedComment {
  return {
    id: 'c1', docKey: 'd', anchor: {}, selectedText: '', body: '',
    author: 'someone', sectionId: '', resolved: false, createdAt: 0,
    ...over,
  }
}

describe('renderCommentsMarkdown', () => {
  it('produces zero output when there are no comments', () => {
    const state: DocState = { highlights: new Map(), comments: new Map(), unknown: [] }
    expect(renderCommentsMarkdown(state, 'basic.md', '')).toBe('')
  })

  it('renders open and resolved comments grouped by line', async () => {
    const source = await readFile(join(HERE, 'fixtures', 'basic.md'), 'utf8')
    const state: DocState = {
      highlights: new Map(),
      comments: new Map([
        ['c1', comment({
          id: 'c1', body: 'nice catch here', author: 'manu',
          createdAt: Date.UTC(2026, 3, 30),
          selectedText: 'unique sentence with foo bar baz',
          // 0-indexed line 6 = 1-based line 7 in basic.md
          anchor: { line: 6, text: 'unique sentence with foo' },
        })],
        ['c2', comment({
          id: 'c2', body: 'minor nit, leaving for posterity', author: 'alice',
          createdAt: Date.UTC(2026, 3, 29), resolved: true,
          selectedText: 'First paragraph here.',
          // 0-indexed line 2 = 1-based line 3 in basic.md
          anchor: { line: 2, text: 'First paragraph here.' },
        })],
      ]),
      unknown: [],
    }

    const out = renderCommentsMarkdown(state, 'basic.md', source)

    expect(out).toContain('# Comments on `basic.md`')
    expect(out).toContain('**1 open** · 1 resolved')
    expect(out).toContain('Line 7')
    expect(out).toContain('"unique sentence with foo bar baz"')
    expect(out).toContain('nice catch here')
    expect(out).toContain('[Open in source](basic.md#L7)')
    // resolved comment is collapsed
    expect(out).toContain('<details>')
    expect(out).toContain('Resolved · Line 3')
    expect(out).toContain('do not edit')
    // resolved comment shows author in summary
    expect(out).toContain('by alice')
    // stable anchors
    expect(out).toContain('<a id="mdr-c1"></a>')
    expect(out).toContain('<a id="mdr-c2"></a>')
    // author summary line
    expect(out).toContain('Comments by alice (1), manu (1)')
    // footer attribution
    expect(out).toContain('_Generated from the sibling `.basic.md.annot`')
    // relative timestamp: c1 is the most recent (1 day after c2), so c1 shows "just now",
    // c2 shows "1 day ago" relative to c1
    expect(out).toContain('(just now)')
    expect(out).toContain('(1 day ago)')
  })

  it('orders comments by line ascending, then createdAt', () => {
    const state: DocState = {
      highlights: new Map(),
      comments: new Map([
        // 0-indexed inputs: line 4 → output line 5, line 1 → output line 2
        ['a', comment({ id: 'a', body: 'body-alpha', anchor: { line: 4 }, createdAt: 2 })],
        ['b', comment({ id: 'b', body: 'body-beta', anchor: { line: 1 }, createdAt: 1 })],
        ['c', comment({ id: 'c', body: 'body-gamma', anchor: { line: 4 }, createdAt: 1 })],
      ]),
      unknown: [],
    }
    // 10 newlines = 11 lines (enough room for all 0-indexed line values)
    const out = renderCommentsMarkdown(state, 'x.md', '\n'.repeat(10))
    const idxBeta = out.indexOf('body-beta')
    const idxGamma = out.indexOf('body-gamma')
    const idxAlpha = out.indexOf('body-alpha')
    expect(idxBeta).toBeLessThan(idxGamma)
    expect(idxGamma).toBeLessThan(idxAlpha)
  })

  it('renders open comments before resolved comments regardless of line', () => {
    const state: DocState = {
      highlights: new Map(),
      comments: new Map([
        ['r', comment({ id: 'r', body: 'resolved-body', resolved: true, anchor: { line: 1 }, createdAt: 1 })],
        ['o', comment({ id: 'o', body: 'open-body', resolved: false, anchor: { line: 5 }, createdAt: 1 })],
      ]),
      unknown: [],
    }
    const out = renderCommentsMarkdown(state, 'x.md', '\n'.repeat(10))
    expect(out.indexOf('open-body')).toBeLessThan(out.indexOf('resolved-body'))
  })

  it('relative timestamps are stable: re-rendering same data produces identical output', async () => {
    const source = await readFile(join(HERE, 'fixtures', 'basic.md'), 'utf8')
    const state: DocState = {
      highlights: new Map(),
      comments: new Map([
        ['c1', comment({
          id: 'c1', body: 'note', author: 'alice',
          createdAt: Date.UTC(2026, 3, 30),
          selectedText: 'text',
          anchor: { line: 6 },
        })],
      ]),
      unknown: [],
    }
    const out1 = renderCommentsMarkdown(state, 'basic.md', source)
    const out2 = renderCommentsMarkdown(state, 'basic.md', source)
    expect(out1).toBe(out2)
    // Most recent comment shows "just now" relative to itself
    expect(out1).toContain('(just now)')
  })

  it('relative timestamps: 0 days apart = just now, 1 day = 1 day ago, 7 days = 7 days ago', () => {
    const dayMs = 24 * 60 * 60 * 1000
    const newest = Date.UTC(2026, 3, 30) // most recent event
    const oneDayAgo = newest - dayMs
    const sevenDaysAgo = newest - 7 * dayMs

    const state: DocState = {
      highlights: new Map(),
      comments: new Map([
        ['c1', comment({ id: 'c1', body: 'newest', author: 'alice', createdAt: newest, anchor: {} })],
        ['c2', comment({ id: 'c2', body: 'one-day', author: 'bob', createdAt: oneDayAgo, anchor: {} })],
        ['c3', comment({ id: 'c3', body: 'seven-days', author: 'carol', createdAt: sevenDaysAgo, anchor: {} })],
      ]),
      unknown: [],
    }
    const out = renderCommentsMarkdown(state, 'x.md', '\n'.repeat(5))
    expect(out).toContain('(just now)')
    expect(out).toContain('(1 day ago)')
    expect(out).toContain('(7 days ago)')
    // Re-run produces identical output
    expect(out).toBe(renderCommentsMarkdown(state, 'x.md', '\n'.repeat(5)))
  })

  it('section context appears in comment headings', () => {
    const state: DocState = {
      highlights: new Map(),
      comments: new Map([
        ['c1', comment({
          id: 'c1', body: 'note', author: 'alice',
          anchor: { line: 2, section: 'getting-started' },
          sectionId: '',
          createdAt: 1000,
        })],
      ]),
      unknown: [],
    }
    const out = renderCommentsMarkdown(state, 'x.md', '\n'.repeat(10))
    expect(out).toContain('Getting Started · Line')
  })

  it('section context from sectionId field when anchor.section is absent', () => {
    const state: DocState = {
      highlights: new Map(),
      comments: new Map([
        ['c1', comment({
          id: 'c1', body: 'note', author: 'alice',
          anchor: { line: 2 },
          sectionId: 'getting-started',
          createdAt: 1000,
        })],
      ]),
      unknown: [],
    }
    const out = renderCommentsMarkdown(state, 'x.md', '\n'.repeat(10))
    expect(out).toContain('Getting Started · Line')
  })

  it('author summary line appears with multiple authors sorted', () => {
    const state: DocState = {
      highlights: new Map(),
      comments: new Map([
        ['c1', comment({ id: 'c1', body: 'note', author: 'zara', createdAt: 1000, anchor: {} })],
        ['c2', comment({ id: 'c2', body: 'note', author: 'alice', createdAt: 1001, anchor: {} })],
        ['c3', comment({ id: 'c3', body: 'note', author: 'alice', createdAt: 1002, anchor: {} })],
      ]),
      unknown: [],
    }
    const out = renderCommentsMarkdown(state, 'x.md', '')
    expect(out).toContain('Comments by alice (2), zara (1)')
  })

  it('bold open count appears when there are both open and resolved', () => {
    const state: DocState = {
      highlights: new Map(),
      comments: new Map([
        ['c1', comment({ id: 'c1', body: 'open', author: 'alice', resolved: false, createdAt: 1 })],
        ['c2', comment({ id: 'c2', body: 'resolved', author: 'bob', resolved: true, createdAt: 2 })],
      ]),
      unknown: [],
    }
    const out = renderCommentsMarkdown(state, 'x.md', '')
    expect(out).toContain('**1 open** · 1 resolved')
  })

  it('no bold when only resolved comments', () => {
    const state: DocState = {
      highlights: new Map(),
      comments: new Map([
        ['c1', comment({ id: 'c1', body: 'resolved', author: 'alice', resolved: true, createdAt: 1 })],
      ]),
      unknown: [],
    }
    const out = renderCommentsMarkdown(state, 'x.md', '')
    expect(out).toContain('1 resolved')
    expect(out).not.toContain('**1 resolved**')
    expect(out).not.toContain('open')
  })

  it('stable anchors appear before each comment block', () => {
    const state: DocState = {
      highlights: new Map(),
      comments: new Map([
        ['c1', comment({ id: 'c1', body: 'open note', author: 'alice', resolved: false, createdAt: 1 })],
        ['c2', comment({ id: 'c2', body: 'resolved note', author: 'bob', resolved: true, createdAt: 2 })],
      ]),
      unknown: [],
    }
    const out = renderCommentsMarkdown(state, 'x.md', '')
    expect(out).toContain('<a id="mdr-c1"></a>')
    expect(out).toContain('<a id="mdr-c2"></a>')
    // anchor for resolved comment appears BEFORE <details>
    const anchorIdx = out.indexOf('<a id="mdr-c2"></a>')
    const detailsIdx = out.indexOf('<details>')
    expect(anchorIdx).toBeLessThan(detailsIdx)
  })

  it('resolved comment summary includes "by <author>"', () => {
    const state: DocState = {
      highlights: new Map(),
      comments: new Map([
        ['c1', comment({ id: 'c1', body: 'note', author: 'bob', resolved: true, createdAt: 1 })],
      ]),
      unknown: [],
    }
    const out = renderCommentsMarkdown(state, 'x.md', '')
    expect(out).toContain('<summary>')
    expect(out).toContain('by bob')
  })

  it('footer attribution is present at the end of the output', () => {
    const state: DocState = {
      highlights: new Map(),
      comments: new Map([
        ['c1', comment({ id: 'c1', body: 'note', author: 'alice', createdAt: 1 })],
      ]),
      unknown: [],
    }
    const out = renderCommentsMarkdown(state, 'my-doc.md', '')
    expect(out).toContain('_Generated from the sibling `.my-doc.md.annot` by [md-reader](https://github.com/manup-dev/themarkdownreader). Re-run the workflow to refresh._')
    // Should be at the end
    const lines = out.trimEnd().split('\n')
    expect(lines[lines.length - 1]).toContain('Re-run the workflow to refresh.')
  })
})
