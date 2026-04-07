/**
 * SVG-based diagram renderer — renders DiagramDSL as clean, auto-fitting SVG.
 * Replaces Excalidraw for generated diagrams (lighter, more reliable, theme-aware).
 */
import { useMemo, useRef, useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import type { DiagramDSL, DiagramNode, DiagramEdge } from '../lib/excalidraw-converter'

const NODE_H = 44
const PAD_X = 20
const GAP_X = 140
const GAP_Y = 100
const ARROW_GAP = 8
const COLORS = ['#339af0', '#51cf66', '#fcc419', '#ff6b6b', '#845ef7', '#ff922b', '#20c997', '#cc5de8']

interface Pos { x: number; y: number; w: number; h: number }

function measureLabel(text: string): number {
  return Math.max(140, text.length * 8.5 + PAD_X * 2)
}

function layoutNodes(nodes: DiagramNode[], edges: DiagramEdge[], type: DiagramDSL['type']): Map<string, Pos> {
  const positions = new Map<string, Pos>()

  if (type === 'mindmap') {
    const center = nodes[0]
    if (!center) return positions
    const cw = measureLabel(center.label)
    const spokes = nodes.slice(1)
    const radius = Math.max(200, spokes.length * 45)
    const cx = radius + cw / 2 + 50, cy = radius + NODE_H / 2 + 50
    positions.set(center.id, { x: cx - cw / 2, y: cy - NODE_H / 2, w: cw, h: NODE_H })
    spokes.forEach((node, i) => {
      const w = measureLabel(node.label)
      const angle = (i / spokes.length) * 2 * Math.PI - Math.PI / 2
      positions.set(node.id, {
        x: cx + Math.cos(angle) * radius - w / 2,
        y: cy + Math.sin(angle) * radius - NODE_H / 2,
        w, h: NODE_H,
      })
    })
  } else if (type === 'hierarchy') {
    // BFS tree layout
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
    const remaining = nodes.filter(n => !visited.has(n.id))
    if (remaining.length > 0) levels.push(remaining)

    // Find max width for centering
    const levelWidths = levels.map(level =>
      level.reduce((sum, n) => sum + measureLabel(n.label) + GAP_X, -GAP_X)
    )
    const maxWidth = Math.max(...levelWidths)

    levels.forEach((level, ly) => {
      const totalW = levelWidths[ly]
      let x = (maxWidth - totalW) / 2 + 50
      level.forEach(node => {
        const w = measureLabel(node.label)
        positions.set(node.id, { x, y: 50 + ly * (NODE_H + GAP_Y), w, h: NODE_H })
        x += w + GAP_X
      })
    })
  } else if (type === 'sequence' || type === 'comparison') {
    let x = 50
    nodes.forEach(node => {
      const w = measureLabel(node.label)
      positions.set(node.id, { x, y: 100, w, h: NODE_H })
      x += w + GAP_X
    })
  } else {
    // Flowchart: grid
    const cols = nodes.length <= 3 ? 1 : nodes.length <= 6 ? 2 : 3
    const colWidths: number[] = new Array(cols).fill(0)
    // Pre-measure column widths
    nodes.forEach((node, i) => {
      const col = i % cols
      colWidths[col] = Math.max(colWidths[col], measureLabel(node.label))
    })
    const colStarts: number[] = [50]
    for (let c = 1; c < cols; c++) colStarts[c] = colStarts[c - 1] + colWidths[c - 1] + GAP_X

    nodes.forEach((node, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const w = colWidths[col]
      positions.set(node.id, {
        x: colStarts[col],
        y: 50 + row * (NODE_H + GAP_Y),
        w, h: NODE_H,
      })
    })
  }

  return positions
}

function nodeShape(style: DiagramNode['style'], pos: Pos, color: string, isDark: boolean) {
  const stroke = isDark ? '#e9ecef' : '#495057'

  if (style === 'diamond') {
    const cx = pos.x + pos.w / 2, cy = pos.y + pos.h / 2
    const rx = pos.w / 2, ry = pos.h / 2
    return (
      <polygon
        points={`${cx},${cy - ry} ${cx + rx},${cy} ${cx},${cy + ry} ${cx - rx},${cy}`}
        fill={color} stroke={stroke} strokeWidth={1.5}
      />
    )
  }

  if (style === 'ellipse') {
    return (
      <ellipse
        cx={pos.x + pos.w / 2} cy={pos.y + pos.h / 2}
        rx={pos.w / 2} ry={pos.h / 2}
        fill={color} stroke={stroke} strokeWidth={1.5}
      />
    )
  }

  // rectangle or rounded
  return (
    <rect
      x={pos.x} y={pos.y} width={pos.w} height={pos.h}
      rx={style === 'rounded' ? 20 : 8}
      fill={color} stroke={stroke} strokeWidth={1.5}
    />
  )
}

function arrowPath(from: Pos, to: Pos, isHorizontal: boolean): string {
  // Determine best exit/entry sides based on relative positions
  const fcx = from.x + from.w / 2, fcy = from.y + from.h / 2
  const tcx = to.x + to.w / 2, tcy = to.y + to.h / 2
  const dx = tcx - fcx, dy = tcy - fcy

  if (isHorizontal || Math.abs(dx) > Math.abs(dy) * 1.5) {
    // Horizontal arrow: exit right, enter left (or vice versa)
    const goRight = dx > 0
    const sx = goRight ? from.x + from.w + ARROW_GAP : from.x - ARROW_GAP
    const sy = fcy
    const ex = goRight ? to.x - ARROW_GAP : to.x + to.w + ARROW_GAP
    const ey = tcy
    const cpOff = Math.max(40, Math.abs(ex - sx) * 0.4)
    const cp1x = goRight ? sx + cpOff : sx - cpOff
    const cp2x = goRight ? ex - cpOff : ex + cpOff
    return `M ${sx} ${sy} C ${cp1x} ${sy}, ${cp2x} ${ey}, ${ex} ${ey}`
  }

  // Vertical arrow: exit bottom, enter top (or vice versa)
  const goDown = dy > 0
  const sx = fcx
  const sy = goDown ? from.y + from.h + ARROW_GAP : from.y - ARROW_GAP
  const ex = tcx
  const ey = goDown ? to.y - ARROW_GAP : to.y + to.h + ARROW_GAP
  const cpOff = Math.max(30, Math.abs(ey - sy) * 0.4)
  const cp1y = goDown ? sy + cpOff : sy - cpOff
  const cp2y = goDown ? ey - cpOff : ey + cpOff
  return `M ${sx} ${sy} C ${sx} ${cp1y}, ${ex} ${cp2y}, ${ex} ${ey}`
}

interface DiagramSVGProps {
  dsl: DiagramDSL
}

export function DiagramSVG({ dsl }: DiagramSVGProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const isHorizontal = dsl.type === 'sequence' || dsl.type === 'comparison'

  const { positions, viewBox } = useMemo(() => {
    const pos = layoutNodes(dsl.nodes, dsl.edges, dsl.type)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of pos.values()) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x + p.w)
      maxY = Math.max(maxY, p.y + p.h)
    }
    const pad = 60
    const contentW = maxX - minX + pad * 2
    const contentH = maxY - minY + pad * 2
    // Match ~16:9 viewport aspect ratio so diagram fills the screen
    const targetAR = 2.0
    const currentAR = contentW / contentH
    let vw = contentW, vh = contentH
    if (currentAR < targetAR) {
      vw = contentH * targetAR
    } else {
      vh = contentW / targetAR
    }
    const vx = minX - pad - (vw - contentW) / 2
    const vy = minY - pad - (vh - contentH) / 2
    return {
      positions: pos,
      viewBox: `${vx} ${vy} ${vw} ${vh}`,
    }
  }, [dsl])

  const bgColor = isDark ? '#111827' : '#f9fafb'
  const edgeColor = isDark ? '#6b7280' : '#9ca3af'
  const labelColor = isDark ? '#d1d5db' : '#6b7280'

  return (
    <div ref={containerRef} className={`relative ${fullscreen ? 'fixed inset-0 z-50 bg-gray-950' : 'w-full h-full'}`}>
      <div className="absolute top-2 right-2 z-10">
        <button
          onClick={() => setFullscreen(!fullscreen)}
          className="p-1.5 bg-white dark:bg-gray-800 rounded shadow text-gray-500 hover:text-gray-700"
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>
      <svg
        viewBox={viewBox}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ background: bgColor }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill={edgeColor} />
          </marker>
        </defs>

        {/* Edges */}
        {dsl.edges.map((edge, i) => {
          const from = positions.get(edge.from)
          const to = positions.get(edge.to)
          if (!from || !to) return null
          const d = arrowPath(from, to, isHorizontal)
          const midX = (from.x + from.w / 2 + to.x + to.w / 2) / 2
          const midY = (from.y + from.h / 2 + to.y + to.h / 2) / 2
          return (
            <g key={`edge-${i}`}>
              <path d={d} fill="none" stroke={edgeColor} strokeWidth={1.5} markerEnd="url(#arrowhead)" />
              {edge.label && (
                <g>
                  <rect
                    x={midX - edge.label.length * 3.2 - 4} y={midY - 16}
                    width={edge.label.length * 6.4 + 8} height={16}
                    rx={3} fill={bgColor} fillOpacity={0.85}
                  />
                  <text x={midX} y={midY - 6} textAnchor="middle" fill={labelColor}
                    fontSize={10} fontFamily="system-ui, sans-serif" fontWeight={400}>
                    {edge.label.length > 20 ? edge.label.slice(0, 18) + '...' : edge.label}
                  </text>
                </g>
              )}
            </g>
          )
        })}

        {/* Nodes */}
        {dsl.nodes.map((node, i) => {
          const pos = positions.get(node.id)
          if (!pos) return null
          const color = COLORS[i % COLORS.length]
          return (
            <g key={node.id}>
              {nodeShape(node.style, pos, color, isDark)}
              <text
                x={pos.x + pos.w / 2} y={pos.y + pos.h / 2}
                textAnchor="middle" dominantBaseline="central"
                fill="#ffffff" fontSize={13}
                fontFamily="system-ui, sans-serif" fontWeight={600}
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
              >
                {node.label}
              </text>
            </g>
          )
        })}

        {/* Title */}
        {dsl.title && (
          <text
            x={parseFloat(viewBox.split(' ')[0]) + parseFloat(viewBox.split(' ')[2]) / 2}
            y={parseFloat(viewBox.split(' ')[1]) + 20}
            textAnchor="middle" fill={isDark ? '#9ca3af' : '#6b7280'}
            fontSize={14} fontFamily="system-ui, sans-serif" fontWeight={600}
          >
            {dsl.title}
          </text>
        )}
      </svg>
    </div>
  )
}
