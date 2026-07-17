import { describe, it, expect } from 'vitest'
import { buildReaderUrl, buildInlineReaderUrl, encodeInlinePayload, INLINE_URL_MAX } from './url'

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

describe('buildInlineReaderUrl', () => {
  it('embeds base64(JSON{markdown,fileName}) that the app #md= handler decodes, view after it', () => {
    const url = buildInlineReaderUrl('https://host/app', '# Hi', 'doc.md', 'mindmap')
    const m = /^https:\/\/host\/app\/#md=([^&]+)&view=mindmap$/.exec(url)
    expect(m).not.toBeNull()
    expect(JSON.parse(Buffer.from(m![1], 'base64').toString('utf-8'))).toEqual({
      markdown: '# Hi',
      fileName: 'doc.md',
    })
  })

  it('round-trips non-ASCII content as UTF-8 bytes (matches the app atob/escape decode)', () => {
    const url = buildInlineReaderUrl('http://x', '# Héllo 世界 🚀', 'ünïcode.md', 'read')
    const b64 = url.split('#md=')[1].split('&')[0]
    const decoded = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
    expect(decoded.markdown).toBe('# Héllo 世界 🚀')
    expect(decoded.fileName).toBe('ünïcode.md')
  })

  it('appends extra params after view', () => {
    const url = buildInlineReaderUrl('http://x', '# A', 'a.md', 'read', { tts: 'true', section: 'Intro' })
    expect(url.endsWith('&view=read&tts=true&section=Intro')).toBe(true)
  })

  it('payload never contains &, # or ? (base64 alphabet keeps hash parsing unambiguous)', () => {
    expect(encodeInlinePayload('# A & B? #tag', 'a&b.md')).not.toMatch(/[&#?]/)
  })

  it('INLINE_URL_MAX stays within conservative OS command-line limits', () => {
    expect(INLINE_URL_MAX).toBeLessThanOrEqual(8000)
  })
})
