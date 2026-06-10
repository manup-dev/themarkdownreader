import type { TreeNode } from '../../shared/tree-parser.js'

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AsciiTreeOptions {
  color: boolean
  maxDepth?: number // default: unlimited
}

export function renderAsciiTree(tree: TreeNode, opts: AsciiTreeOptions): string {
  const lines: string[] = []

  // Root line — bold if color enabled
  const rootName = opts.color ? `\x1b[1m${tree.name}\x1b[0m` : tree.name
  lines.push(rootName)

  renderChildren(tree.children, '', 1, opts, lines)

  return lines.join('\n')
}

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

// 6 colors cycling by depth: bold cyan, yellow, green, magenta, blue, red
const DEPTH_COLORS = [
  '\x1b[1;36m', // bold cyan
  '\x1b[1;33m', // bold yellow
  '\x1b[1;32m', // bold green
  '\x1b[1;35m', // bold magenta
  '\x1b[1;34m', // bold blue
  '\x1b[1;31m', // bold red
]
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

function colorForDepth(depth: number): string {
  return DEPTH_COLORS[(depth - 1) % DEPTH_COLORS.length]
}

// ─── Recursive renderer ───────────────────────────────────────────────────────

/**
 * Count all descendants of a node (including itself is NOT counted — just its subtree).
 */
function countDescendants(node: TreeNode): number {
  let count = 0
  for (const child of node.children) {
    count += 1 + countDescendants(child)
  }
  return count
}

function renderChildren(
  children: TreeNode[],
  prefix: string,
  depth: number,
  opts: AsciiTreeOptions,
  lines: string[],
): void {
  const atLimit = opts.maxDepth !== undefined && depth >= opts.maxDepth

  for (let i = 0; i < children.length; i++) {
    const node = children[i]
    const isLast = i === children.length - 1
    const connector = isLast ? '└─' : '├─'

    if (atLimit) {
      // Show truncated entry with descendant count
      const total = countDescendants(node)
      const suffix = ` (+${total} more)`
      const truncLine = opts.color
        ? `${prefix}${DIM}${connector} ${node.name}${suffix}${RESET}`
        : `${prefix}${connector} ${node.name}${suffix}`
      lines.push(truncLine)
      // Don't recurse
    } else {
      // Normal entry
      const colorCode = opts.color ? colorForDepth(depth) : ''
      const colorReset = opts.color ? RESET : ''
      lines.push(`${prefix}${connector} ${colorCode}${node.name}${colorReset}`)

      // Continuation prefix for children
      const childPrefix = prefix + (isLast ? '   ' : '│  ')
      renderChildren(node.children, childPrefix, depth + 1, opts, lines)
    }
  }
}
