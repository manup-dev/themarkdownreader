import { describe, it, expect } from 'vitest'
import { captureAnchor, lineWordFromOffset } from '../lib/anchor'

describe('lineWordFromOffset', () => {
  it('returns 0/0 at the start of the document', () => {
    expect(lineWordFromOffset('hello world', 0, 5)).toEqual({ line: 0, word: 0, len: 1 })
  })

  it('counts words correctly mid-line', () => {
    const md = 'one two three four five'
    expect(lineWordFromOffset(md, 8, 13)).toEqual({ line: 0, word: 2, len: 1 })
  })

  it('handles multiline correctly', () => {
    const md = 'first line here\nsecond line follows\nthird line'
    // "second" starts at position 16, which is char 0 of line 1
    expect(lineWordFromOffset(md, 16, 22)).toEqual({ line: 1, word: 0, len: 1 })
  })

  it('counts word index within the second line', () => {
    const md = 'first line here\nsecond line follows'
    // "follows" starts at 28 (line 1, word 2)
    expect(lineWordFromOffset(md, 28, 35)).toEqual({ line: 1, word: 2, len: 1 })
  })

  it('handles tabs as whitespace', () => {
    const md = 'a\tb\tc'
    expect(lineWordFromOffset(md, 4, 5)).toEqual({ line: 0, word: 2, len: 1 })
  })

  it('len counts multi-word selections', () => {
    const md = 'one two three four five'
    expect(lineWordFromOffset(md, 4, 13)).toEqual({ line: 0, word: 1, len: 2 })
  })

  it('len is 0 for whitespace-only selection', () => {
    const md = 'word1   word2'
    expect(lineWordFromOffset(md, 5, 8).len).toBe(0)
  })

  it('clamps out-of-range start/end safely', () => {
    expect(lineWordFromOffset('short', -5, 999)).toEqual({ line: 0, word: 0, len: 1 })
  })

  it('handles consecutive newlines (blank lines)', () => {
    const md = 'one\n\nthree'
    // 'three' starts at offset 5
    expect(lineWordFromOffset(md, 5, 10)).toEqual({ line: 2, word: 0, len: 1 })
  })

  it('handles a CRLF document by treating \\r as a non-newline char', () => {
    // We only count \n; \r becomes whitespace within a word/word-boundary.
    // Acceptable because GitHub raw normalizes to LF for .md files.
    const md = 'a\r\nb'
    const r = lineWordFromOffset(md, 3, 4)
    expect(r.line).toBe(1)
  })
})

describe('captureAnchor — line/word/len fields', () => {
  it('populates line/word/len on a fresh anchor', () => {
    const md = '# Title\n\nFirst paragraph here.\nSecond paragraph follows.'
    const a = captureAnchor(md, 'Second paragraph')
    expect(a.line).toBe(3)
    expect(a.word).toBe(0)
    expect(a.len).toBe(2)
  })

  it('returns 0/0/0 for unfound text (existing fallback) without throwing', () => {
    const md = 'one two three'
    const a = captureAnchor(md, 'never-occurs')
    // Falls back to start=0/end=0 today; new fields should reflect that
    expect(a.line).toBe(0)
    expect(a.word).toBe(0)
  })
})
