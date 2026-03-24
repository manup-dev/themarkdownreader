import type { TocEntry } from '../store/useStore'
import { chunkMarkdown, wordCount, type DocumentChunk } from './markdown'

/**
 * Build tree data from markdown TOC for mind maps and treemaps.
 */
export interface TreeNode {
  id: string
  name: string
  value: number // word count
  children: TreeNode[]
}

export function buildTree(markdown: string, toc: TocEntry[]): TreeNode {
  const chunks = chunkMarkdown(markdown)
  const root: TreeNode = { id: 'root', name: 'Document', value: 0, children: [] }

  if (toc.length === 0) {
    root.value = wordCount(markdown)
    return root
  }

  // Build a tree from the flat heading list using levels
  const stack: TreeNode[] = [root]

  for (const entry of toc) {
    const chunk = chunks.find((c) => c.sectionPath.endsWith(entry.text))
    const words = chunk ? wordCount(chunk.text) : 10

    const node: TreeNode = {
      id: entry.id,
      name: entry.text,
      value: words,
      children: [],
    }

    // Find the right parent based on heading level
    while (stack.length > entry.level) stack.pop()

    const parent = stack[stack.length - 1] ?? root
    parent.children.push(node)
    stack.push(node)
  }

  return root
}

/**
 * Summary card data structure
 */
export interface SectionCard {
  id: string
  title: string
  level: number
  text: string
  wordCount: number
  readingTime: number
  summary?: string
}

export function buildSectionCards(markdown: string, toc: TocEntry[]): SectionCard[] {
  const chunks = chunkMarkdown(markdown)
  const cards: SectionCard[] = []

  for (const entry of toc) {
    if (entry.level > 2) continue // Only show top-level sections as cards

    const matchingChunks = findChunksForSection(entry, toc, chunks)
    const text = matchingChunks.map((c) => c.text).join('\n\n')
    const words = wordCount(text)

    cards.push({
      id: entry.id,
      title: entry.text,
      level: entry.level,
      text,
      wordCount: words,
      readingTime: Math.max(1, Math.ceil(words / 230)),
    })
  }

  return cards
}

function findChunksForSection(entry: TocEntry, _toc: TocEntry[], chunks: DocumentChunk[]): DocumentChunk[] {
  return chunks.filter((c) => c.sectionPath.includes(entry.text))
}

/**
 * Treemap data (hierarchical with sizes)
 */
export interface TreemapNode {
  name: string
  value?: number
  children?: TreemapNode[]
}

export function buildTreemapData(tree: TreeNode): TreemapNode {
  if (tree.children.length === 0) {
    return { name: tree.name, value: Math.max(tree.value, 1) }
  }
  return {
    name: tree.name,
    children: tree.children.map(buildTreemapData),
  }
}
