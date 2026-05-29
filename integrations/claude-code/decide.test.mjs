import { describe, it, expect } from 'vitest'
import { decideOpen } from './decide.mjs'

const cwd = '/proj'
const base = 'http://localhost:5183'
const opts = { baseUrl: base, now: 1000, windowMs: 30000 }

describe('decideOpen', () => {
  it('opens a freshly written markdown file', () => {
    const r = decideOpen({ toolName: 'Write', filePath: '/proj/docs/plan.md', cwd }, { opened: {} }, opts)
    expect(r).toEqual({
      open: true,
      reason: 'open',
      relPath: 'docs/plan.md',
      url: 'http://localhost:5183/#file=docs%2Fplan.md&view=read',
    })
  })

  it('skips Edit (only opens on Write)', () => {
    const r = decideOpen({ toolName: 'Edit', filePath: '/proj/a.md', cwd }, { opened: {} }, opts)
    expect(r.open).toBe(false)
    expect(r.reason).toBe('not-a-write')
  })

  it('skips non-markdown files', () => {
    const r = decideOpen({ toolName: 'Write', filePath: '/proj/a.txt', cwd }, { opened: {} }, opts)
    expect(r.open).toBe(false)
    expect(r.reason).toBe('not-markdown')
  })

  it('skips files outside the project root', () => {
    const r = decideOpen({ toolName: 'Write', filePath: '/etc/evil.md', cwd }, { opened: {} }, opts)
    expect(r.open).toBe(false)
    expect(r.reason).toBe('outside-project')
  })

  it('dedups a path opened within the window', () => {
    const state = { opened: { 'a.md': 990 } }
    const r = decideOpen({ toolName: 'Write', filePath: '/proj/a.md', cwd }, state, opts)
    expect(r.open).toBe(false)
    expect(r.reason).toBe('deduped')
  })

  it('re-opens a path after the dedup window passes', () => {
    const r = decideOpen({ toolName: 'Write', filePath: '/proj/a.md', cwd }, { opened: { 'a.md': -100000 } }, opts)
    expect(r.open).toBe(true)
  })

  it('encodes spaces in the relative path', () => {
    const r = decideOpen({ toolName: 'Write', filePath: '/proj/my notes.md', cwd }, { opened: {} }, opts)
    expect(r.url).toBe('http://localhost:5183/#file=my+notes.md&view=read')
  })
})
