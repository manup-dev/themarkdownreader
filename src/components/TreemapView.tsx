import { useEffect, useRef, useState, useMemo } from 'react'
import * as d3 from 'd3'
import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy'
import { useStore } from '../store/useStore'
import { buildTree, buildTreemapData, type TreemapNode } from '../lib/visualize'
import { slugify } from '../lib/markdown'

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#f97316', '#6366f1']

export function TreemapView() {
  const markdown = useStore((s) => s.markdown)
  const toc = useStore((s) => s.toc)
  const theme = useStore((s) => s.theme)
  const setViewMode = useStore((s) => s.setViewMode)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; words: number } | null>(null)
  const totalWords = useMemo(() => markdown.split(/\s+/).filter(Boolean).length, [markdown])

  useEffect(() => {
    if (!containerRef.current) return

    const el = containerRef.current
    const width = el.clientWidth
    const height = el.clientHeight

    // Clear
    d3.select(el).select('svg').remove()

    const tree = buildTree(markdown, toc)
    const data = buildTreemapData(tree)

    const root = hierarchy<TreemapNode>(data)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

    treemap<TreemapNode>()
      .size([width, height])
      .padding(3)
      .tile(treemapSquarify)(root)

    const svg = d3.select(el)
      .append('svg')
      .attr('width', width)
      .attr('height', height)

    const isDark = theme === 'dark'

    const leaves = root.leaves() as HierarchyRectangularNode<TreemapNode>[]

    const cell = svg.selectAll('g')
      .data(leaves)
      .join('g')
      .attr('transform', (d) => `translate(${d.x0},${d.y0})`)
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        const id = slugify(d.data.name)
        setViewMode('read')
        setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 100)
      })
      .on('mouseenter', (event, d) => {
        const rect = el.getBoundingClientRect()
        setTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          name: d.data.name,
          words: d.value ?? 0,
        })
      })
      .on('mouseleave', () => setTooltip(null))

    cell.append('rect')
      .attr('width', (d) => Math.max(0, d.x1! - d.x0!))
      .attr('height', (d) => Math.max(0, d.y1! - d.y0!))
      .attr('rx', 4)
      .attr('fill', (_d, i) => COLORS[i % COLORS.length])
      .attr('fill-opacity', isDark ? 0.7 : 0.85)
      .attr('stroke', isDark ? '#1f2937' : '#ffffff')
      .attr('stroke-width', 2)

    // Dynamic text color based on background luminance for WCAG contrast
    const textColor = (_d: unknown, i: number) => {
      const bg = COLORS[i % COLORS.length]
      const r = parseInt(bg.slice(1, 3), 16)
      const g = parseInt(bg.slice(3, 5), 16)
      const b = parseInt(bg.slice(5, 7), 16)
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      return luminance > 0.6 ? '#1f2937' : '#ffffff'
    }

    cell.append('text')
      .attr('x', 6)
      .attr('y', 18)
      .text((d) => {
        const w = (d.x1! - d.x0!)
        const maxChars = Math.floor(w / 7)
        const name = d.data.name
        return name.length > maxChars ? name.slice(0, maxChars - 1) + '...' : name
      })
      .attr('fill', textColor)
      .attr('font-size', '12px')
      .attr('font-weight', '600')
      .style('pointer-events', 'none')

    cell.append('text')
      .attr('x', 6)
      .attr('y', 34)
      .text((d) => {
        const words = d.value ?? 0
        const mins = Math.max(1, Math.ceil(words / 230))
        return `${words} words · ${mins}m read`
      })
      .attr('fill', (_d: unknown, i: number) => {
        const base = textColor(_d, i)
        return base === '#ffffff' ? 'rgba(255,255,255,0.7)' : 'rgba(31,41,55,0.6)'
      })
      .attr('font-size', '10px')
      .style('pointer-events', 'none')

  }, [markdown, toc, theme, setViewMode])

  return (
    <div className="flex-1 overflow-hidden relative" ref={containerRef} role="img" aria-label="Document treemap visualization showing section sizes. Click a section to navigate to it.">
      <div className="absolute bottom-4 right-4 z-10 text-xs text-gray-400 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm px-2 py-1 rounded">
        Area = content size. Click a section to read it.
      </div>
      {tooltip && (
        <div
          className="absolute z-20 bg-gray-900 text-white text-xs px-3 py-2 rounded-lg shadow-lg pointer-events-none"
          style={{ left: tooltip.x + 10, top: tooltip.y - 40 }}
        >
          <div className="font-semibold">{tooltip.name}</div>
          <div className="text-gray-300">{tooltip.words} words &middot; {Math.max(1, Math.ceil(tooltip.words / 230))}m read &middot; {totalWords > 0 ? Math.round((tooltip.words / totalWords) * 100) : 0}%</div>
        </div>
      )}
    </div>
  )
}
