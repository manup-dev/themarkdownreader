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
  it('uses anchor.line when present and within range', () => {
    expect(resolveLine({ line: 7 }, SOURCE)).toBe(7)
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
    // line 3 wins even though "foo" appears on line 7
    expect(resolveLine({ line: 3, text: 'foo' }, SOURCE)).toBe(3)
  })
})
