import { describe, it, expect } from 'vitest'
import { markdownUrlTransform } from '../lib/markdown-url-transform'

describe('markdownUrlTransform', () => {
  it('preserves cite: citation links (defaultUrlTransform would strip them)', () => {
    expect(markdownUrlTransform('cite:src/lib/ai.ts:42')).toBe('cite:src/lib/ai.ts:42')
  })
  it('preserves data:image and blob: sources', () => {
    expect(markdownUrlTransform('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(markdownUrlTransform('blob:http://localhost/abc')).toBe('blob:http://localhost/abc')
  })
  it('still strips dangerous schemes', () => {
    expect(markdownUrlTransform('javascript:alert(1)')).toBe('')
  })
  it('passes through normal urls and anchors', () => {
    expect(markdownUrlTransform('https://example.com')).toBe('https://example.com')
    expect(markdownUrlTransform('#heading')).toBe('#heading')
  })
})
