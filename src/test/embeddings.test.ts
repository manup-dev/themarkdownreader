import { describe, it, expect } from 'vitest'
import { searchChunks } from '../lib/embeddings'
import type { DocumentChunk } from '../lib/markdown'

const chunks: DocumentChunk[] = [
  { id: 'c0', text: '# Getting Started\n\nThis guide helps you install the application.', sectionPath: 'Getting Started', index: 0 },
  { id: 'c1', text: '## Configuration\n\nSet up your environment variables and database connection.', sectionPath: 'Getting Started > Configuration', index: 1 },
  { id: 'c2', text: '## Deployment\n\nDeploy to production using Docker containers.', sectionPath: 'Deployment', index: 2 },
  { id: 'c3', text: '## Testing\n\nRun unit tests with vitest and integration tests with playwright.', sectionPath: 'Testing', index: 3 },
]

describe('searchChunks', () => {
  it('finds relevant chunks by keyword', () => {
    const results = searchChunks('docker deploy', chunks)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe('c2')
  })

  it('boosts exact phrase matches', () => {
    const results = searchChunks('environment variables', chunks)
    expect(results[0].id).toBe('c1')
  })

  it('returns empty for no matches', () => {
    const results = searchChunks('zzzznothing', chunks)
    expect(results).toHaveLength(0)
  })

  it('respects topK limit', () => {
    const results = searchChunks('the', chunks, 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })
})
