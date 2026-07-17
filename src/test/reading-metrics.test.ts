import { describe, it, expect, beforeEach } from 'vitest'
import { recordWordsRead, wordsReadToday, pruneWordsReadStorage } from '../lib/reading-metrics'

describe('daily words-read metric (B13)', () => {
  beforeEach(() => localStorage.clear())

  it('sums contributions across documents (not a single per-doc max)', () => {
    recordWordsRead('42', 500)
    recordWordsRead('f:notes:api.md', 300)
    expect(wordsReadToday()).toBe(800)
  })

  it('keeps the max per document — scrolling back up never shrinks the day', () => {
    recordWordsRead('42', 500)
    recordWordsRead('42', 200)
    recordWordsRead('42', 700)
    expect(wordsReadToday()).toBe(700)
  })

  it('ignores empty keys and non-positive counts', () => {
    recordWordsRead('', 100)
    recordWordsRead('42', 0)
    recordWordsRead('42', -5)
    expect(wordsReadToday()).toBe(0)
  })

  it('tolerates the legacy plain-number value format', () => {
    localStorage.setItem(`md-reader-words-today-${new Date().toDateString()}`, '1234')
    expect(wordsReadToday()).toBe(1234)
    recordWordsRead('42', 100)
    expect(wordsReadToday()).toBe(1334)
  })

  it('prunes dated keys older than the retention window, keeps today', () => {
    const old = new Date(Date.now() - 30 * 86400000)
    localStorage.setItem(`md-reader-words-today-${old.toDateString()}`, '{"42":100}')
    recordWordsRead('42', 50)
    pruneWordsReadStorage()
    expect(localStorage.getItem(`md-reader-words-today-${old.toDateString()}`)).toBeNull()
    expect(wordsReadToday()).toBe(50)
  })

  it('removes malformed dated keys during pruning', () => {
    localStorage.setItem('md-reader-words-today-not-a-date', '{"x":1}')
    pruneWordsReadStorage()
    expect(localStorage.getItem('md-reader-words-today-not-a-date')).toBeNull()
  })
})
