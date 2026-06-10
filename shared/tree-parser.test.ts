import { describe, it, expect } from 'vitest'
import { extractToc, buildTree, slugify, wordCount } from './tree-parser'

const SAMPLE_MD = `# Document Title\n\n## Introduction\n\nThis is the introduction.\n\n## Main Content\n\n### Subsection A\n\nDetails about subsection A with several words.\n\n### Subsection B\n\nMore details.\n\n## Conclusion\n\nFinal thoughts.`

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('strips special characters', () => {
    expect(slugify('Hello, World!')).toBe('hello-world')
  })

  it('handles accented characters', () => {
    expect(slugify('Héllo Wörld')).toBe('hello-world')
  })

  it('collapses multiple hyphens', () => {
    expect(slugify('foo  bar')).toBe('foo-bar')
  })
})

describe('wordCount', () => {
  it('counts words correctly', () => {
    expect(wordCount('hello world foo')).toBe(3)
  })

  it('returns 0 for empty string', () => {
    expect(wordCount('')).toBe(0)
  })

  it('handles multiple spaces', () => {
    expect(wordCount('  hello   world  ')).toBe(2)
  })
})

describe('extractToc', () => {
  it('extracts headings with correct levels', () => {
    const toc = extractToc(SAMPLE_MD)
    expect(toc.length).toBe(6)
    expect(toc[0]).toEqual({ id: 'document-title', text: 'Document Title', level: 1 })
    expect(toc[1]).toEqual({ id: 'introduction', text: 'Introduction', level: 2 })
    expect(toc[2]).toEqual({ id: 'main-content', text: 'Main Content', level: 2 })
    expect(toc[3]).toEqual({ id: 'subsection-a', text: 'Subsection A', level: 3 })
    expect(toc[4]).toEqual({ id: 'subsection-b', text: 'Subsection B', level: 3 })
    expect(toc[5]).toEqual({ id: 'conclusion', text: 'Conclusion', level: 2 })
  })

  it('returns empty array for markdown with no headings', () => {
    const toc = extractToc('Just some plain text with no headings.')
    expect(toc).toEqual([])
  })

  it('deduplicates slug IDs for repeated heading text', () => {
    const md = '## Foo\n\n## Foo\n\n## Foo'
    const toc = extractToc(md)
    expect(toc[0].id).toBe('foo')
    expect(toc[1].id).toBe('foo-1')
    expect(toc[2].id).toBe('foo-2')
  })
})

describe('buildTree', () => {
  it('creates root with children from top-level headings', () => {
    const toc = extractToc(SAMPLE_MD)
    const tree = buildTree(SAMPLE_MD, toc)

    expect(tree.id).toBe('root')
    expect(tree.name).toBe('Document')
    // H1 is a direct child of root
    expect(tree.children.length).toBe(1)
    expect(tree.children[0].name).toBe('Document Title')
  })

  it('nests H3 under H2', () => {
    const toc = extractToc(SAMPLE_MD)
    const tree = buildTree(SAMPLE_MD, toc)

    const h1 = tree.children[0]
    const mainContent = h1.children.find((c) => c.name === 'Main Content')
    expect(mainContent).toBeDefined()
    expect(mainContent!.children.length).toBe(2)
    expect(mainContent!.children[0].name).toBe('Subsection A')
    expect(mainContent!.children[1].name).toBe('Subsection B')
  })

  it('handles no-heading documents by returning root with word count', () => {
    const md = 'Just some plain text with no headings at all.'
    const tree = buildTree(md, [])

    expect(tree.id).toBe('root')
    expect(tree.name).toBe('Document')
    expect(tree.children).toEqual([])
    expect(tree.value).toBeGreaterThan(0)
  })

  it('assigns non-zero word counts to leaf nodes', () => {
    const toc = extractToc(SAMPLE_MD)
    const tree = buildTree(SAMPLE_MD, toc)

    const h1 = tree.children[0]
    const subsectionA = h1.children
      .find((c) => c.name === 'Main Content')!
      .children.find((c) => c.name === 'Subsection A')!

    expect(subsectionA.value).toBeGreaterThan(0)
  })
})
