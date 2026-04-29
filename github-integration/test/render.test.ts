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
    author: 'someone', sectionId: 's', resolved: false, createdAt: 0,
    ...over,
  }
}

describe('renderCommentsMarkdown', () => {
  it('produces zero output when there are no comments', () => {
    const state: DocState = { highlights: new Map(), comments: new Map(), unknown: [] }
    expect(renderCommentsMarkdown(state, 'basic.md', '', { now: 0 })).toBe('')
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
          anchor: { line: 7, text: 'unique sentence with foo' },
        })],
        ['c2', comment({
          id: 'c2', body: 'minor nit, leaving for posterity', author: 'alice',
          createdAt: Date.UTC(2026, 3, 29), resolved: true,
          selectedText: 'First paragraph here.',
          anchor: { line: 3, text: 'First paragraph here.' },
        })],
      ]),
      unknown: [],
    }

    const out = renderCommentsMarkdown(state, 'basic.md', source, { now: Date.UTC(2026, 3, 30) })

    expect(out).toContain('# Comments on `basic.md`')
    expect(out).toContain('2 comments')
    expect(out).toContain('Line 7')
    expect(out).toContain('“unique sentence with foo bar baz”')
    expect(out).toContain('nice catch here')
    expect(out).toContain('[Open in source](basic.md#L7)')
    // resolved comment is collapsed
    expect(out).toContain('<details>')
    expect(out).toContain('Resolved · Line 3')
    expect(out).toContain('do not edit')
  })

  it('orders comments by line ascending, then createdAt', () => {
    const state: DocState = {
      highlights: new Map(),
      comments: new Map([
        ['a', comment({ id: 'a', body: 'body-alpha', anchor: { line: 5 }, createdAt: 2 })],
        ['b', comment({ id: 'b', body: 'body-beta', anchor: { line: 2 }, createdAt: 1 })],
        ['c', comment({ id: 'c', body: 'body-gamma', anchor: { line: 5 }, createdAt: 1 })],
      ]),
      unknown: [],
    }
    const out = renderCommentsMarkdown(state, 'x.md', '\n\n\n\n\n\n', { now: 0 })
    const idxBeta = out.indexOf('body-beta')
    const idxGamma = out.indexOf('body-gamma')
    const idxAlpha = out.indexOf('body-alpha')
    expect(idxBeta).toBeLessThan(idxGamma)
    expect(idxGamma).toBeLessThan(idxAlpha)
  })
})
