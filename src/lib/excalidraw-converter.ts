export interface DiagramNode {
  id: string
  label: string
  style?: 'rectangle' | 'rounded' | 'diamond' | 'ellipse'
}

export interface DiagramEdge {
  from: string
  to: string
  label?: string
}

export interface DiagramDSL {
  title: string
  type: 'flowchart' | 'hierarchy' | 'sequence' | 'mindmap' | 'comparison'
  nodes: DiagramNode[]
  edges: DiagramEdge[]
}

export interface ExcalidrawEl {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  text?: string
  strokeColor: string
  backgroundColor: string
  fillStyle: string
  strokeWidth: number
  roundness: { type: number } | null
  points?: number[][]
  startBinding?: { elementId: string; focus: number; gap: number }
  endBinding?: { elementId: string; focus: number; gap: number }
  boundElements?: { id: string; type: string }[]
  fontSize?: number
  fontFamily?: number
  textAlign?: string
  verticalAlign?: string
  containerId?: string | null
  [key: string]: unknown
}

const NODE_H = 60
const GAP_X = 100
const GAP_Y = 100
const COLORS = ['#339af0', '#51cf66', '#fcc419', '#ff6b6b', '#845ef7', '#ff922b', '#20c997', '#cc5de8']

let idCounter = 0
function uid(): string {
  return `gen_${++idCounter}_${Date.now().toString(36)}`
}

/** Measure node width based on label length */
function nodeWidth(label: string): number {
  // ~9px per character at 16px font, with padding
  return Math.max(120, Math.min(240, label.length * 9 + 40))
}

function layoutPositions(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  type: DiagramDSL['type']
): Map<string, { x: number; y: number; w: number }> {
  const positions = new Map<string, { x: number; y: number; w: number }>()

  if (type === 'sequence' || type === 'comparison') {
    // Horizontal layout
    let x = 0
    nodes.forEach((node) => {
      const w = nodeWidth(node.label)
      positions.set(node.id, { x, y: 0, w })
      x += w + GAP_X
    })
  } else if (type === 'mindmap') {
    // Radial layout: center node + spokes
    const cx = 400, cy = 400
    const count = nodes.length - 1
    const radius = Math.max(250, count * 40)
    nodes.forEach((node, i) => {
      const w = nodeWidth(node.label)
      if (i === 0) {
        positions.set(node.id, { x: cx - w / 2, y: cy - NODE_H / 2, w })
      } else {
        const angle = ((i - 1) / Math.max(1, count)) * 2 * Math.PI - Math.PI / 2
        positions.set(node.id, {
          x: cx + Math.cos(angle) * radius - w / 2,
          y: cy + Math.sin(angle) * radius - NODE_H / 2,
          w,
        })
      }
    })
  } else if (type === 'hierarchy') {
    // Tree layout: BFS levels from root
    const children = new Map<string, string[]>()
    const hasParent = new Set<string>()
    for (const e of edges) {
      if (!children.has(e.from)) children.set(e.from, [])
      children.get(e.from)!.push(e.to)
      hasParent.add(e.to)
    }
    const roots = nodes.filter(n => !hasParent.has(n.id))
    if (roots.length === 0 && nodes.length > 0) roots.push(nodes[0])

    const levels: DiagramNode[][] = []
    const visited = new Set<string>()
    let queue = roots.map(r => r.id)
    while (queue.length > 0) {
      const level: DiagramNode[] = []
      const next: string[] = []
      for (const id of queue) {
        if (visited.has(id)) continue
        visited.add(id)
        const node = nodes.find(n => n.id === id)
        if (node) level.push(node)
        for (const child of children.get(id) ?? []) next.push(child)
      }
      if (level.length > 0) levels.push(level)
      queue = next
    }
    // Place any unvisited nodes in last level
    const remaining = nodes.filter(n => !visited.has(n.id))
    if (remaining.length > 0) levels.push(remaining)

    levels.forEach((level, ly) => {
      const totalWidth = level.reduce((sum, n) => sum + nodeWidth(n.label) + GAP_X, -GAP_X)
      let x = -totalWidth / 2
      level.forEach((node) => {
        const w = nodeWidth(node.label)
        positions.set(node.id, { x, y: ly * (NODE_H + GAP_Y), w })
        x += w + GAP_X
      })
    })
  } else {
    // Flowchart: grid layout (multiple columns)
    const cols = nodes.length <= 4 ? 2 : nodes.length <= 8 ? 3 : 4
    nodes.forEach((node, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const w = nodeWidth(node.label)
      positions.set(node.id, {
        x: 200 + col * (240 + GAP_X),
        y: 200 + row * (NODE_H + GAP_Y),
        w,
      })
    })
  }

  return positions
}

function makeShape(node: DiagramNode, x: number, y: number, w: number, colorIdx: number): ExcalidrawEl {
  const id = uid()
  const type = node.style === 'diamond' ? 'diamond' : node.style === 'ellipse' ? 'ellipse' : 'rectangle'
  return {
    id, type, x, y, width: w, height: NODE_H,
    strokeColor: '#495057',
    backgroundColor: COLORS[colorIdx % COLORS.length],
    fillStyle: 'solid',
    strokeWidth: 2,
    roundness: node.style === 'rounded' ? { type: 3 } : type === 'rectangle' ? { type: 3 } : null,
    boundElements: [],
  }
}

function makeLabel(text: string, x: number, y: number, w: number, containerId: string | null = null): ExcalidrawEl {
  return {
    id: uid(), type: 'text',
    x: x + 10, y: y + NODE_H / 2 - 10,
    width: w - 20, height: 20,
    text,
    strokeColor: '#ffffff',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    roundness: null,
    fontSize: 16, fontFamily: 1,
    textAlign: 'center', verticalAlign: 'middle',
    containerId,
  }
}

function makeArrow(
  fromId: string, toId: string,
  fromPos: { x: number; y: number; w: number },
  toPos: { x: number; y: number; w: number },
  isHorizontal: boolean
): ExcalidrawEl {
  const startX = isHorizontal ? fromPos.x + fromPos.w : fromPos.x + fromPos.w / 2
  const startY = isHorizontal ? fromPos.y + NODE_H / 2 : fromPos.y + NODE_H
  const endX = isHorizontal ? toPos.x : toPos.x + toPos.w / 2
  const endY = isHorizontal ? toPos.y + NODE_H / 2 : toPos.y

  return {
    id: uid(), type: 'arrow',
    x: startX, y: startY,
    width: endX - startX, height: endY - startY,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    roundness: { type: 2 },
    points: [[0, 0], [endX - startX, endY - startY]],
    startBinding: { elementId: fromId, focus: 0, gap: 4 },
    endBinding: { elementId: toId, focus: 0, gap: 4 },
  }
}

/** Calculate bounding box and return zoom/scroll to fit content in viewport */
export function calculateFitZoom(elements: ExcalidrawEl[], viewportW: number, viewportH: number): { zoom: number; scrollX: number; scrollY: number } {
  if (elements.length === 0) return { zoom: 1, scrollX: 0, scrollY: 0 }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const el of elements) {
    if (el.type === 'text' && el.containerId) continue // skip bound text
    minX = Math.min(minX, el.x)
    minY = Math.min(minY, el.y)
    maxX = Math.max(maxX, el.x + (el.width || 0))
    maxY = Math.max(maxY, el.y + (el.height || 0))
  }

  const pad = 60
  const contentW = maxX - minX + pad * 2
  const contentH = maxY - minY + pad * 2
  const zoom = Math.min(1, Math.max(0.2, Math.min(viewportW / contentW, viewportH / contentH) * 0.9))

  // Excalidraw scrollX/scrollY: positive = content shifts right/down on screen
  // Center the content in the viewport
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const scrollX = viewportW / 2 / zoom - centerX
  const scrollY = viewportH / 2 / zoom - centerY

  return { zoom, scrollX, scrollY }
}

export function dslToExcalidraw(dsl: DiagramDSL): ExcalidrawEl[] {
  if (dsl.nodes.length === 0) return []

  idCounter = 0
  const elements: ExcalidrawEl[] = []
  const positions = layoutPositions(dsl.nodes, dsl.edges, dsl.type)
  const shapeIds = new Map<string, string>()
  const isHorizontal = dsl.type === 'sequence' || dsl.type === 'comparison'

  dsl.nodes.forEach((node, i) => {
    const pos = positions.get(node.id)!
    const shape = makeShape(node, pos.x, pos.y, pos.w, i)
    shapeIds.set(node.id, shape.id)
    const label = makeLabel(node.label, pos.x, pos.y, pos.w, shape.id)
    shape.boundElements = [{ id: label.id, type: 'text' }]
    elements.push(shape, label)
  })

  for (const edge of dsl.edges) {
    const fromPos = positions.get(edge.from)
    const toPos = positions.get(edge.to)
    const fromShapeId = shapeIds.get(edge.from)
    const toShapeId = shapeIds.get(edge.to)
    if (!fromPos || !toPos || !fromShapeId || !toShapeId) continue

    const arrow = makeArrow(fromShapeId, toShapeId, fromPos, toPos, isHorizontal)
    elements.push(arrow)

    const fromShape = elements.find(e => e.id === fromShapeId)
    const toShape = elements.find(e => e.id === toShapeId)
    if (fromShape?.boundElements) fromShape.boundElements.push({ id: arrow.id, type: 'arrow' })
    if (toShape?.boundElements) toShape.boundElements.push({ id: arrow.id, type: 'arrow' })

    if (edge.label) {
      const midX = (fromPos.x + toPos.x) / 2
      const midY = (fromPos.y + toPos.y) / 2
      elements.push({
        id: uid(), type: 'text',
        x: midX + (isHorizontal ? fromPos.w / 2 : fromPos.w / 2 + 10),
        y: midY + (isHorizontal ? -20 : NODE_H / 2),
        width: 100, height: 20,
        text: edge.label,
        strokeColor: '#868e96',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        roundness: null,
        fontSize: 13, fontFamily: 1,
        textAlign: 'center', verticalAlign: 'middle',
        containerId: null,
      })
    }
  }

  return elements
}

export function parseDiagramDSL(raw: string): DiagramDSL | null {
  try {
    const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    const jsonStr = fenced ? fenced[1].trim() : raw.trim()
    const bracketStart = jsonStr.indexOf('{')
    const bracketEnd = jsonStr.lastIndexOf('}')
    if (bracketStart === -1 || bracketEnd === -1) return null

    const parsed = JSON.parse(jsonStr.slice(bracketStart, bracketEnd + 1))
    if (!parsed.nodes || !Array.isArray(parsed.nodes)) return null
    if (!parsed.edges || !Array.isArray(parsed.edges)) return null

    const validTypes = ['flowchart', 'hierarchy', 'sequence', 'mindmap', 'comparison']
    const type = validTypes.includes(parsed.type) ? parsed.type : 'flowchart'

    const nodes = parsed.nodes
      .filter((n: Record<string, unknown>) => n.id && n.label)
      .slice(0, 20)
      .map((n: Record<string, unknown>) => ({
        id: String(n.id),
        label: String(n.label),
        style: ['rectangle', 'rounded', 'diamond', 'ellipse'].includes(n.style as string) ? n.style : undefined,
      }))

    const nodeIds = new Set(nodes.map((n: DiagramNode) => n.id))
    const edges = parsed.edges
      .filter((e: Record<string, unknown>) => e.from && e.to && nodeIds.has(String(e.from)) && nodeIds.has(String(e.to)))
      .map((e: Record<string, unknown>) => ({
        from: String(e.from),
        to: String(e.to),
        label: e.label ? String(e.label) : undefined,
      }))

    return { title: parsed.title ? String(parsed.title) : '', type, nodes, edges }
  } catch {
    return null
  }
}
