import { Transformer } from 'markmap-lib'

// ─── Module-level singleton ───────────────────────────────────────────────────

const transformer = new Transformer()

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SvgOptions {
  width?: number   // default: 1200
  height?: number  // default: 800
}

export function generateMindMapSvg(markdown: string, options?: SvgOptions): string {
  const width = options?.width ?? 1200
  const height = options?.height ?? 800

  const { root } = transformer.transform(markdown || '# (empty)')

  const hSpacing = 200
  const vSpacing = 40

  const { layoutNode } = layoutTree(root, 60, height / 2, hSpacing, vSpacing)

  return buildSvgFromTree(layoutNode, width, height)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Remove HTML tags from markmap content strings like `<span>Heading</span>` */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim()
}

interface LayoutNode {
  label: string
  x: number
  y: number
  children: LayoutNode[]
}

/**
 * Recursively compute (x, y) positions for each node.
 * Returns the laid-out node and the total vertical height it occupies.
 */
function layoutTree(
  node: { content: string; children: { content: string; children: unknown[] }[] },
  x: number,
  y: number,
  hSpacing: number,
  vSpacing: number,
): { layoutNode: LayoutNode; totalHeight: number } {
  const label = stripHtml(node.content)

  if (!node.children || node.children.length === 0) {
    return {
      layoutNode: { label, x, y, children: [] },
      totalHeight: vSpacing,
    }
  }

  const childX = x + hSpacing
  const childLayouts: { layoutNode: LayoutNode; totalHeight: number }[] = []

  for (const child of node.children) {
    childLayouts.push(
      layoutTree(child as Parameters<typeof layoutTree>[0], childX, 0, hSpacing, vSpacing),
    )
  }

  // Total height consumed by all children
  const totalChildHeight = childLayouts.reduce((sum, cl) => sum + cl.totalHeight, 0)

  // Position children vertically, centered around y
  let cursor = y - totalChildHeight / 2
  const positionedChildren: LayoutNode[] = []

  for (const cl of childLayouts) {
    const childCenterY = cursor + cl.totalHeight / 2
    // Patch the child's y position (and its subtree by rerunning layout at correct y)
    const positioned = shiftY(cl.layoutNode, childCenterY - cl.layoutNode.y)
    positionedChildren.push(positioned)
    cursor += cl.totalHeight
  }

  return {
    layoutNode: { label, x, y, children: positionedChildren },
    totalHeight: Math.max(totalChildHeight, vSpacing),
  }
}

/** Shift all y coordinates in a subtree by dy */
function shiftY(node: LayoutNode, dy: number): LayoutNode {
  return {
    ...node,
    y: node.y + dy,
    children: node.children.map((c) => shiftY(c, dy)),
  }
}

/** Collect all nodes and edges from a laid-out tree */
function collectElements(
  node: LayoutNode,
  nodes: LayoutNode[],
  edges: { x1: number; y1: number; x2: number; y2: number }[],
): void {
  nodes.push(node)
  for (const child of node.children) {
    edges.push({ x1: node.x, y1: node.y, x2: child.x, y2: child.y })
    collectElements(child, nodes, edges)
  }
}

/** Escape special XML characters in text content */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Render the laid-out tree into an SVG string */
function buildSvgFromTree(root: LayoutNode, width: number, height: number): string {
  const nodes: LayoutNode[] = []
  const edges: { x1: number; y1: number; x2: number; y2: number }[] = []
  collectElements(root, nodes, edges)

  const lines: string[] = []

  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`)

  // Dark background
  lines.push(`  <rect width="${width}" height="${height}" fill="#1e1e1e"/>`)

  // Edges (lines connecting parent to child)
  for (const e of edges) {
    lines.push(
      `  <line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="#666" stroke-width="1.5"/>`,
    )
  }

  // Node labels
  for (const n of nodes) {
    const label = escapeXml(n.label)
    lines.push(
      `  <text x="${n.x}" y="${n.y}" font-family="sans-serif" font-size="14" fill="#e0e0e0" dominant-baseline="middle">${label}</text>`,
    )
  }

  lines.push('</svg>')

  return lines.join('\n')
}
