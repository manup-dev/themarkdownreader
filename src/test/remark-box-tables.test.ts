import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import { remarkBoxTables } from '../lib/remark-box-tables'

function render(md: string): string {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkBoxTables)
      .use(remarkRehype)
      .use(rehypeStringify)
      .processSync(md)
  )
}

const box = [
  '┌──────────┬────────┐',
  '│   Pod    │ Status │',
  '├──────────┼────────┤',
  '│ alpha    │ Run    │',
  '│ beta     │ Done   │',
  '└──────────┴────────┘',
].join('\n')

describe('remarkBoxTables', () => {
  it('renders a bare box-drawing table as a <pre> block', () => {
    const html = render(box)
    expect(html).toContain('<pre>')
    expect(html).not.toMatch(/<p>[^<]*┌/)
  })

  it('preserves internal alignment whitespace', () => {
    const html = render(box)
    // The cell padding spaces must survive (not be collapsed)
    expect(html).toContain('│   Pod    │ Status │')
  })

  it('leaves ordinary prose paragraphs untouched', () => {
    const html = render('This is a normal paragraph about pods and status.')
    expect(html).toContain('<p>')
    expect(html).not.toContain('<pre>')
  })

  it('does not convert a single line that merely mentions a box char', () => {
    const html = render('Use the ─ separator between sections here.')
    expect(html).not.toContain('<pre>')
  })

  it('does not double-process content already in a fenced code block', () => {
    const html = render('```\n' + box + '\n```')
    // Exactly one <pre> (the fence), not nested/duplicated
    expect(html.match(/<pre>/g)?.length).toBe(1)
  })
})

describe('remarkBoxTables class tagging', () => {
  it('tags converted box art with a box-art class', () => {
    const html = render(box)
    expect(html).toContain('box-art')
  })
})
