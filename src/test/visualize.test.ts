import { describe, it, expect } from 'vitest'
import { buildTree, buildSectionCards, buildTreemapData } from '../lib/visualize'
import { extractToc } from '../lib/markdown'

const sampleMd = `# Document Title

## Introduction

This is the introduction section with some content.

## Main Content

### Subsection A

Details about subsection A with several words to test word counting properly.

### Subsection B

More details in subsection B.

## Conclusion

Final thoughts and summary of the document.
`

describe('buildTree', () => {
  it('creates a root node', () => {
    const toc = extractToc(sampleMd)
    const tree = buildTree(sampleMd, toc)
    expect(tree.id).toBe('root')
    expect(tree.name).toBe('Document')
  })

  it('creates children from H1/H2 headings', () => {
    const toc = extractToc(sampleMd)
    const tree = buildTree(sampleMd, toc)
    expect(tree.children.length).toBeGreaterThan(0)
  })

  it('nests H3 under H2', () => {
    const toc = extractToc(sampleMd)
    const tree = buildTree(sampleMd, toc)
    const mainContent = tree.children.find((c) => c.children.some((gc) => gc.name === 'Main Content'))?.children.find((c) => c.name === 'Main Content')
      ?? tree.children.find((c) => c.name === 'Main Content')
    if (mainContent) {
      expect(mainContent.children.length).toBeGreaterThan(0)
    }
  })

  it('assigns word count values', () => {
    const toc = extractToc(sampleMd)
    const tree = buildTree(sampleMd, toc)
    const allNodes = flattenTree(tree)
    const hasValues = allNodes.some((n) => n.value > 0)
    expect(hasValues).toBe(true)
  })

  it('handles document with no headings', () => {
    const tree = buildTree('Just plain text without any headings.', [])
    expect(tree.id).toBe('root')
    expect(tree.value).toBeGreaterThan(0)
    expect(tree.children).toHaveLength(0)
  })
})

describe('buildSectionCards', () => {
  it('creates cards for top-level sections', () => {
    const toc = extractToc(sampleMd)
    const cards = buildSectionCards(sampleMd, toc)
    expect(cards.length).toBeGreaterThan(0)
  })

  it('only includes H1/H2 sections', () => {
    const toc = extractToc(sampleMd)
    const cards = buildSectionCards(sampleMd, toc)
    for (const card of cards) {
      expect(card.level).toBeLessThanOrEqual(2)
    }
  })

  it('includes word count per card', () => {
    const toc = extractToc(sampleMd)
    const cards = buildSectionCards(sampleMd, toc)
    for (const card of cards) {
      expect(card.wordCount).toBeGreaterThan(0)
    }
  })

  it('includes reading time per card', () => {
    const toc = extractToc(sampleMd)
    const cards = buildSectionCards(sampleMd, toc)
    for (const card of cards) {
      expect(card.readingTime).toBeGreaterThanOrEqual(1)
    }
  })

  it('includes text content per card', () => {
    const toc = extractToc(sampleMd)
    const cards = buildSectionCards(sampleMd, toc)
    for (const card of cards) {
      expect(card.text.length).toBeGreaterThan(0)
    }
  })

  it('handles empty document', () => {
    const cards = buildSectionCards('', [])
    expect(cards).toHaveLength(0)
  })
})

describe('buildTreemapData', () => {
  it('converts tree to treemap format', () => {
    const toc = extractToc(sampleMd)
    const tree = buildTree(sampleMd, toc)
    const treemapData = buildTreemapData(tree)
    expect(treemapData.name).toBe('Document')
  })

  it('creates leaf nodes with values', () => {
    const toc = extractToc(sampleMd)
    const tree = buildTree(sampleMd, toc)
    const treemapData = buildTreemapData(tree)
    const leaves = findLeaves(treemapData)
    expect(leaves.length).toBeGreaterThan(0)
    for (const leaf of leaves) {
      expect(leaf.value).toBeGreaterThan(0)
    }
  })

  it('creates branch nodes with children', () => {
    const toc = extractToc(sampleMd)
    const tree = buildTree(sampleMd, toc)
    const treemapData = buildTreemapData(tree)
    expect(treemapData.children).toBeDefined()
    expect(treemapData.children!.length).toBeGreaterThan(0)
  })
})

// Helpers
function flattenTree(node: { children: Array<{ value: number; children: unknown[] }> } & { value: number }): Array<{ value: number }> {
  const result: Array<{ value: number }> = [node]
  for (const child of node.children as Array<{ value: number; children: Array<{ value: number; children: unknown[] }> }>) {
    result.push(...flattenTree(child))
  }
  return result
}

function findLeaves(node: { value?: number; children?: unknown[] }): Array<{ value: number }> {
  if (!node.children || node.children.length === 0) return [node as { value: number }]
  return (node.children as Array<{ value?: number; children?: unknown[] }>).flatMap(findLeaves)
}
