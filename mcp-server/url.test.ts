import { describe, it, expect } from 'vitest'
import { buildReaderUrl } from './url'

describe('buildReaderUrl', () => {
  it('builds a read-view hash URL for a relative path', () => {
    expect(buildReaderUrl('http://localhost:5183', 'docs/plan.md', 'read')).toBe(
      'http://localhost:5183/#file=docs%2Fplan.md&view=read'
    )
  })

  it('appends extra params (e.g. tts) after file and view', () => {
    expect(
      buildReaderUrl('http://localhost:5183', 'a.md', 'read', { tts: 'true' })
    ).toBe('http://localhost:5183/#file=a.md&view=read&tts=true')
  })

  it('url-encodes spaces in the path', () => {
    expect(buildReaderUrl('http://x', 'my notes.md', 'read')).toBe(
      'http://x/#file=my+notes.md&view=read'
    )
  })

  it('passes the view through verbatim', () => {
    expect(buildReaderUrl('http://x', 'a.md', 'mindmap')).toBe(
      'http://x/#file=a.md&view=mindmap'
    )
  })
})
