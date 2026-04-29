import { describe, it, expect } from 'vitest'
import { resolveLine } from '../src/anchor'

const SOURCE = [
  '# Title',
  '',
  'First paragraph here.',
  '',
  '## Section A',
  '',
  'The unique sentence with foo bar baz.',
  '',
  '## Section B',
  '',
  'Another paragraph.',
].join('\n')

describe('resolveLine', () => {
  it('uses anchor.line when present and within range (0-indexed input → 1-based output)', () => {
    // 0-indexed line 6 = 1-based line 7 ("The unique sentence with foo bar baz.")
    expect(resolveLine({ line: 6 }, SOURCE)).toBe(7)
  })

  it('accepts anchor.line === 0 and returns line 1', () => {
    expect(resolveLine({ line: 0 }, SOURCE)).toBe(1)
  })

  it('clamps anchor.line out-of-range to null', () => {
    expect(resolveLine({ line: 9999 }, SOURCE)).toBeNull()
  })

  it('falls back to text search when line is absent', () => {
    expect(resolveLine({ text: 'unique sentence with foo' }, SOURCE)).toBe(7)
  })

  it('returns null when neither line nor text matches', () => {
    expect(resolveLine({ text: 'nope-not-here' }, SOURCE)).toBeNull()
  })

  it('prefers explicit line over text', () => {
    // 0-indexed line 2 = 1-based line 3 ("First paragraph here."), even though "foo" appears on line 7
    expect(resolveLine({ line: 2, text: 'foo' }, SOURCE)).toBe(3)
  })
})
