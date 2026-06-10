import { getCachedCaps } from './caps.js'
import { renderAsciiTree } from './renderers/ascii-tree.js'
import { encodeInlineImage } from './renderers/inline-image.js'
import { generateMindMapSvg } from './renderers/svg-mindmap.js'
import type { TreeNode } from '../shared/tree-parser.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts a TreeNode back to markdown headings so markmap-lib can parse it.
 */
function rebuildMarkdownFromTree(node: TreeNode, depth = 0): string {
  const lines: string[] = []
  if (depth > 0) {
    lines.push(`${'#'.repeat(Math.min(depth, 6))} ${node.name}`)
    lines.push('')
  }
  for (const child of node.children) {
    lines.push(rebuildMarkdownFromTree(child, depth + 1))
  }
  return lines.join('\n')
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Intercepts MCP tool result JSON and renders a rich terminal preview for
 * mind_map type results. Non-JSON or non-mind-map JSON is passed through
 * unchanged.
 */
export async function renderMindMapResult(jsonText: string): Promise<string> {
  // 1. Try to parse JSON — passthrough on failure
  let data: Record<string, unknown>
  try {
    data = JSON.parse(jsonText) as Record<string, unknown>
  } catch {
    return jsonText
  }

  // 2. Check for mind_map type and tree
  if (data.type !== 'mind_map' || !data.tree) {
    return jsonText
  }

  const tree = data.tree as TreeNode
  const totalNodes = typeof data.total_nodes === 'number' ? data.total_nodes : 0
  const maxDepth = typeof data.max_depth === 'number' ? data.max_depth : 0
  const browserUrl = typeof data.browser_url === 'string' ? data.browser_url : ''
  const section = typeof data.section === 'string' ? data.section : null

  const caps = getCachedCaps()

  // 3. Build header
  let headerText = `\x1b[1mMind Map\x1b[0m — ${totalNodes} nodes, ${maxDepth} levels deep`
  if (section) {
    headerText += ` (section: ${section})`
  }

  const lines: string[] = []
  lines.push(headerText)
  lines.push('')

  // 4. Tree visualization
  let treeRendered = false

  if (caps.imageProtocol !== 'none') {
    try {
      const markdown = rebuildMarkdownFromTree(tree)
      const svg = generateMindMapSvg(markdown)
      // Use a variable to prevent Vite's static import analysis from failing
      // when sharp is not installed. Falls back to ASCII if unavailable.
      const sharpId = 'sharp'
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const sharp = await (new Function('id', 'return import(id)')(sharpId) as Promise<typeof import('sharp')>)
      const pngBuffer = await sharp.default(Buffer.from(svg)).png().toBuffer()
      const encoded = encodeInlineImage(pngBuffer, caps.imageProtocol)
      lines.push(encoded)
      treeRendered = true
    } catch {
      // Fall through to ASCII rendering
    }
  }

  if (!treeRendered) {
    const asciiTree = renderAsciiTree(tree, {
      color: caps.truecolor || caps.color256,
      maxDepth: 4,
    })
    lines.push(asciiTree)
  }

  lines.push('')

  // 5. Browser escape link
  if (caps.hyperlinks) {
    lines.push(`\x1b]8;;${browserUrl}\x07Open in browser →\x1b]8;;\x07`)
  } else {
    lines.push(`Open in browser → ${browserUrl}`)
  }

  return lines.join('\n')
}
