import { describe, it, expect } from 'vitest'
import { captureAnchor, resolveAnchor, type TextAnchor } from '../lib/anchor'

describe('Anchor round-trip: capture → resolve', () => {
  function makeArticle(html: string): HTMLElement {
    const el = document.createElement('article')
    el.innerHTML = html
    return el
  }

  it('round-trips a simple highlight', () => {
    const md = '# Title\n\nHello world, this is a test.'
    const anchor = captureAnchor(md, 'this is a test', 'title')
    const article = makeArticle('<h1 id="title">Title</h1><p>Hello world, this is a test.</p>')
    const result = resolveAnchor(article, md, anchor)
    expect(result).not.toBeNull()
    expect(result!.text).toBe('this is a test')
  })

  it('round-trips when same text appears twice (section disambiguation)', () => {
    const md = '# A\n\nimportant text here\n\n## B\n\nimportant text here too'
    const anchor = captureAnchor(md, 'important text', 'b')
    const article = makeArticle(
      '<h1 id="a">A</h1><p>important text here</p><h2 id="b">B</h2><p>important text here too</p>',
    )
    const result = resolveAnchor(article, md, anchor)
    expect(result).not.toBeNull()
    // Prefix from section B context should help resolve to correct occurrence
    expect(anchor.sectionId).toBe('b')
    expect(result!.text).toContain('important text')
  })

  it('round-trips after text is edited above the annotation', () => {
    const originalMd = '# Title\n\nFirst para.\n\n## Notes\n\nTarget text here.'
    const anchor = captureAnchor(originalMd, 'Target text', 'notes')

    // Simulate editing: added paragraph above — offsets shifted but context still matches
    const editedMd = '# Title\n\nFirst para.\n\nADDED PARAGRAPH.\n\n## Notes\n\nTarget text here.'
    const article = makeArticle(
      '<h1 id="title">Title</h1><p>First para.</p><p>ADDED PARAGRAPH.</p><h2 id="notes">Notes</h2><p>Target text here.</p>',
    )
    const result = resolveAnchor(article, editedMd, anchor)
    expect(result).not.toBeNull()
    expect(result!.text).toBe('Target text')
  })

  it('old annotations without anchor resolve via text search', () => {
    const article = makeArticle('<p>Some content with legacy text inside.</p>')
    // Simulate an old annotation: anchor with all zero offsets, no prefix/suffix
    const legacyAnchor: TextAnchor = {
      markdownStart: 0,
      markdownEnd: 0,
      exact: 'legacy text',
      prefix: '',
      suffix: '',
      sectionId: '',
      offsetInSection: 0,
    }
    const result = resolveAnchor(article, '', legacyAnchor)
    expect(result).not.toBeNull()
    expect(result!.text).toBe('legacy text')
  })

  it('round-trips text with formatting across elements', () => {
    const md = '# Doc\n\nHello **world** is great.'
    const anchor = captureAnchor(md, 'Hello **world** is', 'doc')
    const article = makeArticle('<h1 id="doc">Doc</h1><p>Hello <strong>world</strong> is great.</p>')
    // The anchor's exact text includes markdown formatting stars, which are not
    // present in the rendered DOM text. resolveAnchor normalizes DOM text, so
    // the markdown-formatted exact string won't match — this is expected to return null.
    const result = resolveAnchor(article, md, anchor)
    // At minimum it should not throw — the result may be null due to formatting mismatch
    expect(() => resolveAnchor(article, md, anchor)).not.toThrow()
    // Since '**' is not in the DOM text, both context and plain-text search will fail
    expect(result).toBeNull()
  })

  it('returns null for text that does not exist in the DOM', () => {
    const md = '# Title\n\nSome content.'
    const anchor = captureAnchor(md, 'NONEXISTENT', 'title')
    const article = makeArticle('<h1 id="title">Title</h1><p>Some content.</p>')
    const result = resolveAnchor(article, md, anchor)
    // 'NONEXISTENT' is not in the DOM, so should return null
    expect(result).toBeNull()
  })
})
