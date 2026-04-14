import { describe, it, expect } from 'vitest'
import { SAMPLE_MARKDOWN } from '../lib/sample-doc'

describe('sample document', () => {
  it('exports non-empty sample markdown', () => {
    expect(SAMPLE_MARKDOWN).toBeTruthy()
    expect(SAMPLE_MARKDOWN.length).toBeGreaterThan(100)
  })

  it('contains the new "Read it. Ship it." framing', () => {
    expect(SAMPLE_MARKDOWN).toContain('Read it. Ship it.')
    expect(SAMPLE_MARKDOWN).toContain('Comprehend')
  })

  it('tours Read-half features', () => {
    expect(SAMPLE_MARKDOWN).toContain('Podcast')
    expect(SAMPLE_MARKDOWN).toContain('Mind map')
    expect(SAMPLE_MARKDOWN).toContain('AI tutor')
  })

  it('includes the Ship-it practice passage + try-this instructions', () => {
    expect(SAMPLE_MARKDOWN).toContain('Ship it')
    expect(SAMPLE_MARKDOWN).toContain('Claude Code')
    expect(SAMPLE_MARKDOWN).toContain('practice passage')
    expect(SAMPLE_MARKDOWN).toContain('Try this right now')
  })

  it('still contains a code block (technical credibility)', () => {
    expect(SAMPLE_MARKDOWN).toContain('```')
  })
})
