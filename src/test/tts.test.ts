import { describe, it, expect } from 'vitest'
import { markdownToSpeechSegments } from '../lib/tts'

const sampleMd = `# Introduction to Testing

## First Section

This is the first paragraph with some **bold** text and \`inline code\`.

### Subsection

More details here.

\`\`\`javascript
const x = 1
console.log(x)
\`\`\`

## Second Section

- Item one
- Item two
- Item three
`

describe('markdownToSpeechSegments', () => {
  it('splits document into sections', () => {
    const sections = markdownToSpeechSegments(sampleMd)
    expect(sections.length).toBeGreaterThan(1)
  })

  it('announces headings with labels', () => {
    const sections = markdownToSpeechSegments(sampleMd)
    const allText = sections.flat().map((s) => s.text).join(' ').toLowerCase()
    expect(allText).toContain('titled')
    expect(allText).toContain('section')
  })

  it('describes code blocks instead of reading them', () => {
    const sections = markdownToSpeechSegments(sampleMd)
    const allText = sections.flat().map((s) => s.text).join(' ').toLowerCase()
    expect(allText).toContain('javascript code example')
    expect(allText).not.toContain('console.log')
    expect(allText).not.toContain('const x')
  })

  it('strips markdown syntax from speech text', () => {
    const sections = markdownToSpeechSegments(sampleMd)
    const allText = sections.flat().map((s) => s.text).join(' ')
    expect(allText).not.toContain('**')
    expect(allText).not.toContain('```')
    expect(allText).not.toContain('##')
  })

  it('handles empty document', () => {
    const sections = markdownToSpeechSegments('')
    expect(sections).toHaveLength(0)
  })

  it('handles document with only headings', () => {
    const sections = markdownToSpeechSegments('# Title\n\n## Section\n\n## Another')
    expect(sections.length).toBeGreaterThan(0)
    const allText = sections.flat().map((s) => s.text).join(' ').toLowerCase()
    expect(allText).toContain('title')
  })

  it('sets slower rate for headings', () => {
    const sections = markdownToSpeechSegments('# My Title\n\nSome body text.')
    const headingSeg = sections.flat().find((s) => s.text.toLowerCase().includes('title'))
    expect(headingSeg?.rate).toBeLessThan(1)
  })

  it('includes pause after headings', () => {
    const sections = markdownToSpeechSegments('# My Title\n\nSome body text.')
    const headingSeg = sections.flat().find((s) => s.text.toLowerCase().includes('title'))
    expect(headingSeg?.pause).toBeGreaterThan(0)
  })

  it('announces section count for multi-section docs', () => {
    const md = '# Title\n\n## A\n\nText\n\n## B\n\nText\n\n## C\n\nText'
    const sections = markdownToSpeechSegments(md)
    const allText = sections.flat().map((s) => s.text).join(' ').toLowerCase()
    expect(allText).toMatch(/\d+ sections/)
  })
})
