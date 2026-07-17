import { describe, it, expect } from 'vitest'
import { buildSectionHash, parseSectionFromHash } from '../lib/section-hash'

describe('section deep-link hash (B14)', () => {
  it('round-trips a non-ASCII section id (encodes exactly once)', () => {
    const hash = buildSectionHash('#read', 'überblick-und-ziele')
    expect(parseSectionFromHash(hash)).toBe('überblick-und-ziele')
  })

  it('does not double-encode (no %25 from re-encoding a percent sign)', () => {
    const hash = buildSectionHash('#read', 'a b')
    expect(hash).not.toContain('%25')
    expect(parseSectionFromHash(hash)).toBe('a b')
  })

  it('preserves existing query params (folder file ref f=…, tab=…)', () => {
    const hash = buildSectionHash('#read?f=docs%2Fapi.md&tab=t1', 'setup')
    const params = new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
    expect(params.get('f')).toBe('docs/api.md')
    expect(params.get('tab')).toBe('t1')
    expect(params.get('section')).toBe('setup')
  })

  it('parses the legacy path-style form (#read/section=…)', () => {
    expect(parseSectionFromHash('#read/section=intro')).toBe('intro')
  })

  it('returns null when no section param is present', () => {
    expect(parseSectionFromHash('#read?f=a.md')).toBeNull()
    expect(parseSectionFromHash('#mindmap')).toBeNull()
    expect(parseSectionFromHash('')).toBeNull()
  })
})
