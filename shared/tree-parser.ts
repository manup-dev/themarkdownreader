import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface TocEntry {
  id: string
  text: string
  level: number
}

export interface TreeNode {
  id: string
  name: string
  value: number // word count
  children: TreeNode[]
}

// ─── Internal AST types ───────────────────────────────────────────────────────

interface AstNode {
  type: string
  value?: string
  children?: AstNode[]
}

interface HeadingNode extends AstNode {
  type: 'heading'
  depth: number
}

interface RootNode {
  type: 'root'
  children: Array<HeadingNode | AstNode>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractText(node: AstNode): string {
  if (node.value) return node.value
  let text = ''
  if (node.children) {
    for (const child of node.children) {
      text += extractText(child)
    }
  }
  return text
}

/**
 * Convert a heading text to a URL-friendly slug.
 * Mirrors the logic in src/lib/markdown.ts.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')                    // decompose accents (é → e + combining accent)
    .replace(/[\u0300-\u036f]/g, '')     // strip combining diacritical marks
    .replace(/[^\p{L}\p{N}\s-]/gu, '')  // keep letters (any script), numbers, spaces, hyphens
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

/**
 * Count words in a string.
 */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

// ─── Core exports ─────────────────────────────────────────────────────────────

/**
 * Parse headings from markdown and return a flat TOC list.
 * Pure Node.js — no browser dependencies.
 */
export function extractToc(markdown: string): TocEntry[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as RootNode
  const toc: TocEntry[] = []
  const slugCounts = new Map<string, number>()

  for (const node of tree.children) {
    if (node.type === 'heading') {
      const heading = node as HeadingNode
      const text = extractText(heading)
      let slug = slugify(text)
      const count = slugCounts.get(slug) ?? 0
      slugCounts.set(slug, count + 1)
      if (count > 0) slug = `${slug}-${count}`

      toc.push({ id: slug, text, level: heading.depth })
    }
  }
  return toc
}

/**
 * Extract the text content of a section between two heading lines.
 * Parses raw markdown lines with regex — no browser dependencies.
 */
function getSectionText(markdown: string, headingText: string): string {
  const lines = markdown.split('\n')
  let inSection = false
  const sectionLines: string[] = []
  const headingRegex = /^(#{1,6})\s+(.+)/

  for (const line of lines) {
    const match = line.match(headingRegex)
    if (match) {
      const title = match[2].trim()
      if (inSection) {
        // Any new heading ends the section
        break
      }
      if (title === headingText) {
        inSection = true
        sectionLines.push(line)
      }
    } else if (inSection) {
      sectionLines.push(line)
    }
  }

  return sectionLines.join('\n').trim()
}

/**
 * Build a tree structure from markdown and its TOC.
 * Pure Node.js version — does not use chunkMarkdown or browser store types.
 */
export function buildTree(markdown: string, toc: TocEntry[]): TreeNode {
  const root: TreeNode = { id: 'root', name: 'Document', value: 0, children: [] }

  if (toc.length === 0) {
    root.value = wordCount(markdown)
    return root
  }

  // Build a tree from the flat heading list using heading levels
  const stack: TreeNode[] = [root]

  for (const entry of toc) {
    const sectionText = getSectionText(markdown, entry.text)
    const words = sectionText.length > 0 ? wordCount(sectionText) : 10

    const node: TreeNode = {
      id: entry.id,
      name: entry.text,
      value: words,
      children: [],
    }

    // Pop stack until we find the right parent level
    while (stack.length > entry.level) stack.pop()

    const parent = stack[stack.length - 1] ?? root
    parent.children.push(node)
    stack.push(node)
  }

  return root
}
