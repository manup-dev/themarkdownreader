import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { Loader2, RefreshCw } from 'lucide-react'
import { useStore } from '../store/useStore'
import { getAllDocuments, getDocLinks } from '../lib/docstore'

interface DocNode extends d3.SimulationNodeDatum {
  id: number
  fileName: string
  wordCount: number
  fx?: number | null
  fy?: number | null
}

interface DocEdge {
  source: number | DocNode
  target: number | DocNode
  strength: number
  sharedTerms: string[]
}

export function CrossDocGraph() {
  const theme = useStore((s) => s.theme)
  const openDocument = useStore((s) => s.openDocument)
  const svgRef = useRef<SVGSVGElement>(null)
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [docCount, setDocCount] = useState(0)

  const loadAndRender = useCallback(async () => {
    if (!svgRef.current) return
    setLoading(true)

    const docs = await getAllDocuments()
    setDocCount(docs.length)
    if (docs.length < 2) {
      setLoading(false)
      return
    }
    const links = await getDocLinks()

    const svg = d3.select(svgRef.current)
    const width = svgRef.current.clientWidth
    const height = svgRef.current.clientHeight
    const isDark = theme === 'dark'

    svg.selectAll('*').remove()

    const nodes: DocNode[] = docs.map((d) => ({
      id: d.id!,
      fileName: d.fileName,
      wordCount: d.wordCount,
    }))

    const edges: DocEdge[] = links.map((l) => ({
      source: l.source.id!,
      target: l.target.id!,
      strength: l.strength,
      sharedTerms: l.sharedTerms,
    }))

    const maxWords = Math.max(...nodes.map((n) => n.wordCount), 1)
    const radiusScale = (wc: number) => 15 + (wc / maxWords) * 30

    const simulation = d3.forceSimulation<DocNode>(nodes)
      .force('link', d3.forceLink<DocNode, d3.SimulationLinkDatum<DocNode>>(edges as d3.SimulationLinkDatum<DocNode>[]).id((d) => d.id).distance(180).strength((d) => {
        const e = d as unknown as DocEdge
        return e.strength
      }))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d) => radiusScale((d as DocNode).wordCount) + 10))

    const g = svg.append('g')
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on('zoom', (event) => g.attr('transform', event.transform)) as never,
    )

    // Edges with thickness based on strength
    const link = g.append('g')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', isDark ? '#4b5563' : '#d1d5db')
      .attr('stroke-width', (d) => 1 + d.strength * 6)
      .attr('stroke-opacity', (d) => 0.3 + d.strength * 0.7)

    // Edge labels (shared terms)
    const linkLabel = g.append('g')
      .selectAll('text')
      .data(edges)
      .join('text')
      .text((d) => d.sharedTerms.slice(0, 3).join(', '))
      .attr('font-size', '8px')
      .attr('fill', isDark ? '#6b7280' : '#9ca3af')
      .attr('text-anchor', 'middle')

    // Doc nodes
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer')
      .on('dblclick', async (_event, d) => {
        const doc = docs.find((dc) => dc.id === d.id)
        if (doc) openDocument(doc.markdown, doc.fileName, doc.id!)
      })
      .on('mouseenter', (event, d) => {
        const rect = svgRef.current!.getBoundingClientRect()
        setTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top - 50,
          text: `${d.fileName}\n${d.wordCount.toLocaleString()} words\nDouble-click to open`,
        })
      })
      .on('mouseleave', () => setTooltip(null))
      .call(
        d3.drag<SVGGElement, DocNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart()
            d.fx = d.x; d.fy = d.y
          })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0)
            d.fx = null; d.fy = null
          }) as never,
      )

    const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#f97316', '#6366f1']

    node.append('circle')
      .attr('r', (d) => radiusScale(d.wordCount))
      .attr('fill', (_d, i) => colors[i % colors.length])
      .attr('stroke', isDark ? '#1f2937' : '#ffffff')
      .attr('stroke-width', 3)
      .attr('fill-opacity', 0.85)

    node.append('text')
      .text((d) => {
        const name = d.fileName.replace(/\.(md|markdown|txt)$/, '')
        return name.length > 18 ? name.slice(0, 17) + '...' : name
      })
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .attr('fill', isDark ? '#e5e7eb' : '#374151')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => radiusScale(d.wordCount) + 14)

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as DocNode).x ?? 0)
        .attr('y1', (d) => (d.source as DocNode).y ?? 0)
        .attr('x2', (d) => (d.target as DocNode).x ?? 0)
        .attr('y2', (d) => (d.target as DocNode).y ?? 0)

      linkLabel
        .attr('x', (d) => (((d.source as DocNode).x ?? 0) + ((d.target as DocNode).x ?? 0)) / 2)
        .attr('y', (d) => (((d.source as DocNode).y ?? 0) + ((d.target as DocNode).y ?? 0)) / 2 - 8)

      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    setLoading(false)
    return () => simulation.stop()
  }, [theme, openDocument])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAndRender().then((fn) => { cleanup = fn as (() => void) | undefined })
    return () => { cleanup?.() }
  }, [loadAndRender])

  return (
    <div className="flex-1 overflow-hidden relative">
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        <span className="text-xs text-gray-400 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm px-2 py-1 rounded">
          Document relationships. Node size = word count. Edge thickness = similarity. Double-click to open.
        </span>
        <button
          onClick={() => loadAndRender()}
          className="text-xs bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm px-2 py-1 rounded text-gray-500 hover:text-gray-700"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-gray-950/50 z-20">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      )}

      {!loading && docCount < 2 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-400">Requires at least 2 documents to show relationships.</p>
            <p className="text-gray-400/60 text-xs mt-2">Upload more documents in the Library.</p>
          </div>
        </div>
      )}

      {tooltip && (
        <div
          className="absolute z-30 bg-gray-900 text-white text-xs px-3 py-2 rounded-lg shadow-lg pointer-events-none whitespace-pre-line"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}

      <svg
        ref={svgRef}
        className="w-full h-full"
        style={{ background: theme === 'dark' ? '#0a0a0f' : theme === 'sepia' ? '#faf6f1' : '#ffffff' }}
      />
    </div>
  )
}
