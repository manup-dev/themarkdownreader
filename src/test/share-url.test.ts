import { describe, it, expect } from 'vitest'
import {
  parseShareUrl,
  buildUrlPairShare,
  buildInlineShare,
  buildGithubRepoShare,
  siblingAnnotUrl,
  normalizeGithubUrl,
  ensureSafeFetchUrl,
  base64urlEncode,
  base64urlDecode,
} from '../lib/share-url'

const ORIGIN = 'https://mdreader.app'

describe('parseShareUrl', () => {
  it('returns null when the hash has no share params', () => {
    expect(parseShareUrl({ href: 'https://x/' })).toBeNull()
    expect(parseShareUrl({ href: 'https://x/#read' })).toBeNull()
  })

  it('parses a Tier-2 url-pair share with explicit annot URL', () => {
    const href = `${ORIGIN}/#url=https%3A%2F%2Fexample.com%2Fa.md&annot=https%3A%2F%2Fexample.com%2F.a.md.annot`
    const h = parseShareUrl({ href })!
    expect(h.kind).toBe('url-pair')
    expect(h.docUrl).toBe('https://example.com/a.md')
    expect(h.annotUrl).toBe('https://example.com/.a.md.annot')
  })

  it('parses a Tier-2 share with no annot (sibling auto-resolution will run)', () => {
    const href = `${ORIGIN}/#url=https%3A%2F%2Fexample.com%2Fa.md`
    const h = parseShareUrl({ href })!
    expect(h.kind).toBe('url-pair')
    expect(h.annotUrl).toBeUndefined()
    expect(h.inlineAnnot).toBeUndefined()
  })

  it('parses a Tier-1 inline share', () => {
    const href = `${ORIGIN}/#url=https%3A%2F%2Fexample.com%2Fa.md&annot=eyJ2IjoxfQ`
    const h = parseShareUrl({ href })!
    expect(h.kind).toBe('inline')
    expect(h.inlineAnnot).toBe('eyJ2IjoxfQ')
  })

  it('parses a Tier-3 GitHub repo handshake', () => {
    const href = `${ORIGIN}/#repo=manu%2Freading-list&path=ml%2Fattn.md&ref=v2.1`
    const h = parseShareUrl({ href })!
    expect(h.kind).toBe('github-repo')
    expect(h.repo).toEqual({ owner: 'manu', name: 'reading-list', ref: 'v2.1', path: 'ml/attn.md' })
  })

  it('defaults ref to main when omitted', () => {
    const href = `${ORIGIN}/#repo=manu%2Frepo`
    const h = parseShareUrl({ href })!
    expect(h.repo?.ref).toBe('main')
  })

  it('rejects malformed repo strings', () => {
    expect(parseShareUrl({ href: `${ORIGIN}/#repo=invalid` })).toBeNull()
  })

  it('extracts share params after a routing prefix like #read?url=', () => {
    const href = `${ORIGIN}/#read?url=https%3A%2F%2Fexample.com%2Fa.md`
    const h = parseShareUrl({ href })!
    expect(h.kind).toBe('url-pair')
    expect(h.docUrl).toBe('https://example.com/a.md')
  })

  it('extracts share params from a hash-prefix mix using &', () => {
    const href = `${ORIGIN}/#read&url=https%3A%2F%2Fexample.com%2Fa.md`
    const h = parseShareUrl({ href })!
    expect(h.docUrl).toBe('https://example.com/a.md')
  })

  it('preserves the docHash hint when provided', () => {
    const href = `${ORIGIN}/#url=https%3A%2F%2Fexample.com%2Fa.md&hash=sha256:abc`
    const h = parseShareUrl({ href })!
    expect(h.docHash).toBe('sha256:abc')
  })
})

describe('build*Share helpers', () => {
  it('buildUrlPairShare omits annot when not provided', () => {
    const url = buildUrlPairShare({ origin: ORIGIN, docUrl: 'https://x/a.md' })
    expect(url).toBe('https://mdreader.app/#url=https%3A%2F%2Fx%2Fa.md')
  })

  it('buildUrlPairShare includes annot and hash', () => {
    const url = buildUrlPairShare({
      origin: ORIGIN,
      docUrl: 'https://x/a.md',
      annotUrl: 'https://x/.a.md.annot',
      docHash: 'sha256:abc',
    })
    const h = parseShareUrl({ href: url })!
    expect(h.docUrl).toBe('https://x/a.md')
    expect(h.annotUrl).toBe('https://x/.a.md.annot')
    expect(h.docHash).toBe('sha256:abc')
  })

  it('buildInlineShare reports overflow when over the byte cap', () => {
    const big = JSON.stringify({ v: 1, ts: 0, id: 'x', op: 'highlight.add', payload: 'a'.repeat(20000) })
    const r = buildInlineShare({ origin: ORIGIN, docUrl: 'https://x/a.md', walJsonl: big, maxBytes: 8192 })
    expect(r.overflow).toBe(true)
  })

  it('buildInlineShare round-trips through parseShareUrl + base64urlDecode', () => {
    const wal = '{"v":1,"ts":1,"id":"h1","op":"highlight.add","docKey":"d","anchor":{"text":"x"},"color":"yellow"}'
    const { url } = buildInlineShare({ origin: ORIGIN, docUrl: 'https://x/a.md', walJsonl: wal })
    const h = parseShareUrl({ href: url })!
    expect(h.kind).toBe('inline')
    expect(base64urlDecode(h.inlineAnnot!)).toBe(wal)
  })

  it('buildGithubRepoShare formats correctly', () => {
    const url = buildGithubRepoShare({ origin: ORIGIN, owner: 'manu', name: 'r', path: 'a.md', ref: 'main' })
    const h = parseShareUrl({ href: url })!
    expect(h.repo).toEqual({ owner: 'manu', name: 'r', ref: 'main', path: 'a.md' })
  })
})

describe('siblingAnnotUrl', () => {
  it('inserts a dot before the basename', () => {
    expect(siblingAnnotUrl('https://x/foo.md')).toBe('https://x/.foo.md.annot')
  })

  it('preserves nested paths', () => {
    expect(siblingAnnotUrl('https://x/dir/sub/foo.md')).toBe('https://x/dir/sub/.foo.md.annot')
  })

  it('preserves query strings as part of the URL object', () => {
    const out = siblingAnnotUrl('https://x/foo.md?ref=main')!
    expect(out).toContain('.foo.md.annot')
  })

  it('returns null when the URL has no basename', () => {
    expect(siblingAnnotUrl('https://x/dir/')).toBeNull()
  })
})

describe('normalizeGithubUrl', () => {
  it('rewrites blob URLs to raw URLs', () => {
    expect(normalizeGithubUrl('https://github.com/o/r/blob/main/a.md'))
      .toBe('https://raw.githubusercontent.com/o/r/main/a.md')
  })

  it('passes non-GitHub URLs through unchanged', () => {
    expect(normalizeGithubUrl('https://example.com/a.md')).toBe('https://example.com/a.md')
  })
})

describe('ensureSafeFetchUrl', () => {
  it('passes a valid https URL through', () => {
    const r = ensureSafeFetchUrl('https://raw.githubusercontent.com/o/r/main/a.md')
    expect(r.ok).toBe(true)
  })

  it('upgrades http to https', () => {
    const r = ensureSafeFetchUrl('http://example.com/a.md')
    expect(r.ok).toBe(true)
    expect(r.url?.startsWith('https://')).toBe(true)
  })

  it('rejects file://', () => {
    const r = ensureSafeFetchUrl('file:///etc/passwd')
    expect(r.ok).toBe(false)
  })

  it('rejects localhost', () => {
    expect(ensureSafeFetchUrl('http://localhost:8080/a.md').ok).toBe(false)
    expect(ensureSafeFetchUrl('https://127.0.0.1/a.md').ok).toBe(false)
  })

  it('rejects private RFC1918 ranges', () => {
    expect(ensureSafeFetchUrl('https://192.168.1.1/a.md').ok).toBe(false)
    expect(ensureSafeFetchUrl('https://10.0.0.1/a.md').ok).toBe(false)
    expect(ensureSafeFetchUrl('https://172.16.0.1/a.md').ok).toBe(false)
  })

  it('rejects .local mDNS hostnames', () => {
    expect(ensureSafeFetchUrl('https://nas.local/a.md').ok).toBe(false)
  })

  it('rejects IPv6 loopback and link-local', () => {
    expect(ensureSafeFetchUrl('https://[::1]/a.md').ok).toBe(false)
    expect(ensureSafeFetchUrl('https://[fe80::1]/a.md').ok).toBe(false)
  })

  it('rejects empty input', () => {
    expect(ensureSafeFetchUrl('').ok).toBe(false)
  })
})

describe('base64url codec', () => {
  it('round-trips ASCII', () => {
    const t = 'hello world!'
    expect(base64urlDecode(base64urlEncode(t))).toBe(t)
  })

  it('round-trips multi-byte UTF-8 (emoji + Devanagari)', () => {
    const t = 'मनु 🚀 — md-reader'
    expect(base64urlDecode(base64urlEncode(t))).toBe(t)
  })

  it('produces URL-safe characters only', () => {
    const out = base64urlEncode('?>~`+/=')
    expect(out).not.toMatch(/[+/=]/)
  })

  it('round-trips a JSONL WAL line', () => {
    const wal = '{"v":1,"ts":1,"id":"h1","op":"highlight.add"}'
    expect(base64urlDecode(base64urlEncode(wal))).toBe(wal)
  })
})
