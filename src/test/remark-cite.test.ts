import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import { remarkCitations } from '../lib/remark-cite'

function render(md: string): string {
  return String(
    unified().use(remarkParse).use(remarkCitations).use(remarkRehype).use(rehypeStringify).processSync(md)
  )
}

describe('remarkCitations', () => {
  it('linkifies a file:line reference as a cite: anchor', () => {
    const html = render('See src/lib/ai.ts:42 for details.')
    expect(html).toContain('href="cite:src/lib/ai.ts:42"')
    expect(html).toContain('>src/lib/ai.ts:42</a>')
  })

  it('handles line ranges and bare filenames', () => {
    expect(render('look at foo.py:10-20')).toContain('href="cite:foo.py:10-20"')
    expect(render('Reader.tsx:183 has it')).toContain('href="cite:Reader.tsx:183"')
  })

  it('ignores times, version numbers, and non-code extensions', () => {
    expect(render('at 12:30 we shipped')).not.toContain('cite:')
    expect(render('version v3.14:15')).not.toContain('cite:')
    expect(render('visit example.com:8080/path')).not.toContain('cite:')
  })

  it('does not linkify inside an existing link', () => {
    expect(render('[src/a.ts:1](http://x)')).not.toContain('cite:')
  })

  it('does not touch inline code', () => {
    const html = render('`src/a.ts:1`')
    expect(html).not.toContain('cite:')
    expect(html).toContain('<code>')
  })
})
