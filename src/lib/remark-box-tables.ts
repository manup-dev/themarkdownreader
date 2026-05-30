import { visit } from 'unist-util-visit'
import type { Root, Paragraph, Code, RootContent } from 'mdast'

// Unicode "Box Drawing" block (U+2500–U+257F): ┌ ─ ┬ ┐ │ ├ ┼ ┤ └ ┴ ┘ etc.
const BOX_CHAR = /[─-╿]/

/** Reconstruct a paragraph's source text, treating soft/hard breaks as newlines. */
function paragraphText(node: Paragraph): string {
  let out = ''
  for (const child of node.children) {
    if (child.type === 'text') out += child.value
    else if (child.type === 'break') out += '\n'
    else if ('value' in child && typeof child.value === 'string') out += child.value
    else return '' // contains links/emphasis/etc. — not raw box art
  }
  return out
}

/**
 * Detects whether a paragraph is Unicode box-drawing art (the kind CLI tools
 * like `kubectl` emit). Such art collapses into a single mangled line when
 * rendered as a normal paragraph, because `white-space: normal` flattens the
 * newlines and alignment spaces. Requires ≥2 lines and that box-drawing lines
 * form the majority, so a paragraph that merely mentions one box character
 * stays prose.
 */
function isBoxArt(text: string): boolean {
  const lines = text.split('\n')
  if (lines.length < 2) return false
  const boxLines = lines.filter((l) => BOX_CHAR.test(l)).length
  return boxLines >= 2 && boxLines >= lines.length / 2
}

/**
 * Remark plugin: turn bare box-drawing paragraphs into code nodes so they
 * render inside a monospace, whitespace-preserving <pre>. Content already in a
 * fenced code block is a `code` node (not a paragraph), so it is never touched.
 */
export function remarkBoxTables() {
  return (tree: Root) => {
    visit(tree, 'paragraph', (node: Paragraph, index, parent) => {
      if (parent == null || index == null) return
      const text = paragraphText(node)
      if (!text || !isBoxArt(text)) return
      const code: Code = {
        type: 'code',
        lang: null,
        meta: null,
        value: text,
        // Tag so CSS can tighten line-height (so vertical │ bars connect)
        // without affecting ordinary code blocks.
        data: { hProperties: { className: ['box-art'] } },
      }
      ;(parent.children as RootContent[])[index] = code
    })
  }
}
