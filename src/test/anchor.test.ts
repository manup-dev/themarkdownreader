import { describe, it, expect } from 'vitest'
import { captureAnchor, resolveAnchor } from '../lib/anchor'

const sampleMd = `# Introduction

This is the introduction paragraph with some unique text here.

## Section One

Content of section one. The quick brown fox jumps over the lazy dog.

## Section Two

The quick brown fox jumps over the lazy dog. More content follows here.

### Subsection A

Final details about subsection a.
`

describe('captureAnchor', () => {
  it('captures markdown offsets for unique string', () => {
    const anchor = captureAnchor(sampleMd, 'unique text here')
    const idx = sampleMd.indexOf('unique text here')
    expect(anchor.markdownStart).toBe(idx)
    expect(anchor.markdownEnd).toBe(idx + 'unique text here'.length)
    expect(anchor.exact).toBe('unique text here')
  })

  it('captures prefix and suffix context (up to 30 chars, matches markdown)', () => {
    const selected = 'unique text here'
    const anchor = captureAnchor(sampleMd, selected)
    const idx = sampleMd.indexOf(selected)

    const expectedPrefix = sampleMd.slice(Math.max(0, idx - 30), idx)
    const expectedSuffix = sampleMd.slice(idx + selected.length, idx + selected.length + 30)

    expect(anchor.prefix).toBe(expectedPrefix)
    expect(anchor.suffix).toBe(expectedSuffix)
    expect(anchor.prefix.length).toBeLessThanOrEqual(30)
    expect(anchor.suffix.length).toBeLessThanOrEqual(30)
  })

  it('captures sectionId from nearest heading', () => {
    const anchor = captureAnchor(sampleMd, 'unique text here')
    expect(anchor.sectionId).toBe('introduction')
  })

  it('computes offsetInSection relative to section start', () => {
    const anchor = captureAnchor(sampleMd, 'unique text here')
    const sectionStart = sampleMd.indexOf('# Introduction')
    const textStart = sampleMd.indexOf('unique text here')
    expect(anchor.offsetInSection).toBe(textStart - sectionStart)
  })

  it('disambiguates repeated text using sectionIdHint', () => {
    // "The quick brown fox..." appears in both Section One and Section Two
    const anchorOne = captureAnchor(sampleMd, 'The quick brown fox jumps over the lazy dog', 'section-one')
    const anchorTwo = captureAnchor(sampleMd, 'The quick brown fox jumps over the lazy dog', 'section-two')

    expect(anchorOne.sectionId).toBe('section-one')
    expect(anchorTwo.sectionId).toBe('section-two')
    expect(anchorOne.markdownStart).not.toBe(anchorTwo.markdownStart)
  })

  it('falls back to first occurrence when no sectionIdHint', () => {
    const anchor = captureAnchor(sampleMd, 'The quick brown fox jumps over the lazy dog')
    const firstIdx = sampleMd.indexOf('The quick brown fox jumps over the lazy dog')
    expect(anchor.markdownStart).toBe(firstIdx)
  })

  it('handles whitespace-normalized text matching raw markdown', () => {
    // Text with collapsed whitespace should still match
    const anchor = captureAnchor(sampleMd, 'unique  text  here')
    const idx = sampleMd.indexOf('unique text here')
    expect(anchor.markdownStart).toBe(idx)
    expect(anchor.exact).toBe('unique text here')
  })

  it('falls back to start=0 when nothing matches', () => {
    const anchor = captureAnchor(sampleMd, 'this text does not exist anywhere xyzzy')
    expect(anchor.markdownStart).toBe(0)
    expect(anchor.markdownEnd).toBe(0)
  })

  it('sets sectionId to empty string when no headings precede the text', () => {
    const noHeadingMd = 'Just some text with no headings at all.'
    const anchor = captureAnchor(noHeadingMd, 'some text')
    expect(anchor.sectionId).toBe('')
    expect(anchor.offsetInSection).toBe(0)
  })
})

describe('resolveAnchor', () => {
  function makeArticle(html: string): HTMLElement {
    const el = document.createElement('article')
    el.innerHTML = html
    return el
  }

  it('resolves via context search when prefix+suffix match', () => {
    const article = makeArticle('<p>This is the first paragraph.</p>')
    const anchor = {
      markdownStart: 0,
      markdownEnd: 15,
      exact: 'first paragraph',
      prefix: 'This is the ',
      suffix: '.',
      sectionId: '',
      offsetInSection: 0,
    }
    const result = resolveAnchor(article, '', anchor)
    expect(result).not.toBeNull()
    expect(result!.text).toBe('first paragraph')
  })

  it('falls back to plain text search when context does not match', () => {
    const article = makeArticle('<p>This is the first paragraph.</p>')
    const anchor = {
      markdownStart: 0,
      markdownEnd: 15,
      exact: 'first paragraph',
      prefix: 'WRONG PREFIX XYZ ',
      suffix: 'WRONG SUFFIX XYZ',
      sectionId: '',
      offsetInSection: 0,
    }
    const result = resolveAnchor(article, '', anchor)
    expect(result).not.toBeNull()
    expect(result!.text).toBe('first paragraph')
  })

  it('returns null when text not found anywhere', () => {
    const article = makeArticle('<p>This is the first paragraph.</p>')
    const anchor = {
      markdownStart: 0,
      markdownEnd: 10,
      exact: 'nonexistent text that is not in the article',
      prefix: '',
      suffix: '',
      sectionId: '',
      offsetInSection: 0,
    }
    const result = resolveAnchor(article, '', anchor)
    expect(result).toBeNull()
  })

  it('handles text that spans formatting boundaries', () => {
    const article = makeArticle('<p>Hello <strong>world</strong> foo</p>')
    const anchor = {
      markdownStart: 0,
      markdownEnd: 11,
      exact: 'Hello world',
      prefix: '',
      suffix: ' foo',
      sectionId: '',
      offsetInSection: 0,
    }
    const result = resolveAnchor(article, '', anchor)
    expect(result).not.toBeNull()
    expect(result!.text).toBe('Hello world')
    // start node should be in "Hello " text node
    expect(result!.startNode.textContent).toBe('Hello ')
    // end node should be in "world" text node
    expect(result!.endNode.textContent).toBe('world')
  })
})
