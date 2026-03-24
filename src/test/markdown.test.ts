import { describe, it, expect } from 'vitest'
import { extractToc, chunkMarkdown, estimateReadingTime, wordCount } from '../lib/markdown'

const sampleMd = `# Title

Some intro text.

## Section One

Content of section one with several words.

### Subsection A

Details here.

## Section Two

More content.

### Subsection B

Final details.
`

describe('extractToc', () => {
  it('extracts headings with correct levels', () => {
    const toc = extractToc(sampleMd)
    expect(toc).toHaveLength(5)
    expect(toc[0]).toMatchObject({ text: 'Title', level: 1 })
    expect(toc[1]).toMatchObject({ text: 'Section One', level: 2 })
    expect(toc[2]).toMatchObject({ text: 'Subsection A', level: 3 })
    expect(toc[3]).toMatchObject({ text: 'Section Two', level: 2 })
    expect(toc[4]).toMatchObject({ text: 'Subsection B', level: 3 })
  })

  it('generates slugified ids', () => {
    const toc = extractToc(sampleMd)
    expect(toc[0].id).toBe('title')
    expect(toc[1].id).toBe('section-one')
    expect(toc[2].id).toBe('subsection-a')
  })

  it('handles duplicate headings', () => {
    const md = '## Foo\n\n## Foo\n\n## Foo'
    const toc = extractToc(md)
    expect(toc[0].id).toBe('foo')
    expect(toc[1].id).toBe('foo-1')
    expect(toc[2].id).toBe('foo-2')
  })

  it('returns empty for no headings', () => {
    const toc = extractToc('Just plain text.\n\nMore text.')
    expect(toc).toHaveLength(0)
  })
})

describe('chunkMarkdown', () => {
  it('splits on headings', () => {
    const chunks = chunkMarkdown(sampleMd)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].sectionPath).toContain('Title')
  })

  it('preserves section paths as breadcrumbs', () => {
    const chunks = chunkMarkdown(sampleMd)
    const subA = chunks.find((c) => c.sectionPath.includes('Subsection A'))
    expect(subA).toBeDefined()
    expect(subA!.sectionPath).toContain('Section One')
  })

  it('assigns sequential indices', () => {
    const chunks = chunkMarkdown(sampleMd)
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i)
    })
  })
})

describe('estimateReadingTime', () => {
  it('returns at least 1 minute', () => {
    expect(estimateReadingTime('short')).toBe(1)
  })

  it('estimates longer texts correctly', () => {
    const longText = 'word '.repeat(460) // ~460 words = 2 minutes
    expect(estimateReadingTime(longText)).toBe(2)
  })
})

describe('wordCount', () => {
  it('counts words correctly', () => {
    expect(wordCount('hello world foo bar')).toBe(4)
  })

  it('handles empty string', () => {
    expect(wordCount('')).toBe(0)
  })
})
