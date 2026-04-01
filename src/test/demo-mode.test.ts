import { describe, it, expect } from 'vitest'
import { SAMPLE_MARKDOWN } from '../lib/sample-doc'

describe('sample document', () => {
  it('exports non-empty sample markdown', () => {
    expect(SAMPLE_MARKDOWN).toBeTruthy()
    expect(SAMPLE_MARKDOWN.length).toBeGreaterThan(100)
  })

  it('contains key onboarding sections', () => {
    expect(SAMPLE_MARKDOWN).toContain('# Welcome')
    expect(SAMPLE_MARKDOWN).toContain('AI')
    expect(SAMPLE_MARKDOWN).toContain('Mind Map')
  })

  it('has a features table', () => {
    expect(SAMPLE_MARKDOWN).toContain('|')
  })
})
