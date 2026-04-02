import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { Loader2, RefreshCw } from 'lucide-react'
import { useStore } from '../store/useStore'
import { extractConceptsAndRelations } from '../lib/ai'

function highlightTextInReader(term: string) {
  // Switch to read view and highlight all occurrences
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let count = 0
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.textContent?.toLowerCase().includes(term.toLowerCase())) {
      const el = node.parentElement
      if (el && el.closest('article')) {
        const isSepia = document.documentElement.classList.contains('sepia')
        el.style.background = isSepia ? '#e8d5be' : '#fef08a'
        el.style.transition = 'background 300ms'
        if (count === 0) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        count++
        setTimeout(() => { el.style.background = '' }, 3000)
      }
    }
  }
  return count
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string
  label: string
  type: string
  fx?: number | null
  fy?: number | null
}

interface GraphEdge {
  source: string | GraphNode
  target: string | GraphNode
  label: string
}

const TYPE_COLORS: Record<string, string> = {
  concept: '#3b82f6',
  person: '#8b5cf6',
  technology: '#10b981',
  process: '#f59e0b',
  default: '#6b7280',
}

export function KnowledgeGraphView() {
  const markdown = useStore((s) => s.markdown)
  const theme = useStore((s) => s.theme)
  const setViewMode = useStore((s) => s.setViewMode)
  const svgRef = useRef<SVGSVGElement>(null)
  const [loading, setLoading] = useState(false)
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; type: string; connections: string[] } | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  // Reset graph when markdown changes — render-time state adjustment
  const [prevMarkdown, setPrevMarkdown] = useState(markdown)
  if (prevMarkdown !== markdown) {
    setPrevMarkdown(markdown)
    setGraphData(null)
  }

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const generate = useCallback(async () => {
    // Abort any in-flight request
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort

    setLoading(true)
    setError(null)
    try {
      const text = markdown.slice(0, 5000)
      const timeout = setTimeout(() => abort.abort(), 10000)
      const result = await extractConceptsAndRelations(text, abort.signal)
      clearTimeout(timeout)
      if (!mountedRef.current) return
      if (result.nodes.length === 0) {
        setError('Could not extract concepts. Try again or use a longer document.')
      } else if (result.nodes.length < 3) {
        setGraphData(result)
        setError('Few concepts found. Try a longer or more technical document for a richer graph.')
      } else {
        setGraphData(result)
      }
    } catch (e) {
      if (!mountedRef.current || abort.signal.aborted) return
      setError(`Failed: ${e instanceof Error ? e.message : 'Unknown error'}. Click refresh to retry.`)
    }
    if (mountedRef.current) setLoading(false)
  }, [markdown])

  // Auto-generate on mount or markdown change — run once, not on every generate reference change
  useEffect(() => {
    generate() // eslint-disable-line react-hooks/set-state-in-effect -- async data fetch sets loading state
    return () => { abortRef.current?.abort() }
  }, [markdown]) // eslint-disable-line react-hooks/exhaustive-deps

  // Render force-directed graph
  useEffect(() => {
    if (!graphData || !svgRef.current) return

    const svg = d3.select(svgRef.current)
    const width = svgRef.current.clientWidth
    const height = svgRef.current.clientHeight
    const isDark = theme === 'dark'
    const isSepia = theme === 'sepia'

    svg.selectAll('*').remove()

    const nodes: GraphNode[] = graphData.nodes.map((n) => ({ ...n }))
    const edges: GraphEdge[] = graphData.edges
      .filter((e) => nodes.find((n) => n.id === e.source) && nodes.find((n) => n.id === e.target))
      .map((e) => ({ ...e }))

    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, d3.SimulationLinkDatum<GraphNode>>(edges as d3.SimulationLinkDatum<GraphNode>[]).id((d) => d.id).distance(150))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(50))

    // Zoom
    const g = svg.append('g')
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on('zoom', (event) => g.attr('transform', event.transform)) as never,
    )

    // Edges
    const link = g.append('g')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', isSepia ? '#d6c4a8' : isDark ? '#4b5563' : '#d1d5db')
      .attr('stroke-width', 1.5)

    // Edge labels
    const linkLabel = g.append('g')
      .selectAll('text')
      .data(edges)
      .join('text')
      .text((d) => d.label)
      .attr('font-size', '9px')
      .attr('fill', isSepia ? '#78716c' : isDark ? '#6b7280' : '#9ca3af')
      .attr('text-anchor', 'middle')

    // Nodes
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart()
            d.fx = d.x
            d.fy = d.y
          })
          .on('drag', (event, d) => {
            d.fx = event.x
            d.fy = event.y
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0)
            d.fx = null
            d.fy = null
          }) as never,
      )

    node.on('click', (_event, d) => {
      // Switch to reader and highlight this concept
      setViewMode('read')
      setTimeout(() => highlightTextInReader(d.label), 200)
    })
    node.on('mouseover', (event, d) => {
      const connections = edges
        .map((e) => {
          const src = typeof e.source === 'string' ? e.source : (e.source as GraphNode).id
          const tgt = typeof e.target === 'string' ? e.target : (e.target as GraphNode).id
          if (src === d.id) return nodes.find((n) => n.id === tgt)?.label
          if (tgt === d.id) return nodes.find((n) => n.id === src)?.label
          return null
        })
        .filter(Boolean) as string[]
      const rect = svgRef.current!.getBoundingClientRect()
      setTooltip({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        label: d.label,
        type: d.type,
        connections,
      })
    })
    node.on('mouseout', () => setTooltip(null))

    node.append('circle')
      .attr('r', 20)
      .attr('fill', (d) => TYPE_COLORS[d.type] ?? TYPE_COLORS.default)
      .attr('stroke', isSepia ? '#e8d5be' : isDark ? '#1f2937' : '#ffffff')
      .attr('stroke-width', 2.5)
      .style('cursor', 'pointer')

    node.append('text')
      .text((d) => d.label)
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('fill', isSepia ? '#3d3122' : isDark ? '#e5e7eb' : '#374151')
      .attr('text-anchor', 'middle')
      .attr('dy', 32)

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
        .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
        .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
        .attr('y2', (d) => (d.target as GraphNode).y ?? 0)

      linkLabel
        .attr('x', (d) => (((d.source as GraphNode).x ?? 0) + ((d.target as GraphNode).x ?? 0)) / 2)
        .attr('y', (d) => (((d.source as GraphNode).y ?? 0) + ((d.target as GraphNode).y ?? 0)) / 2 - 6)

      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => { simulation.stop() }
  }, [graphData, theme, setViewMode])

  return (
    <div className="flex-1 overflow-hidden relative">
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        <span className="text-xs text-gray-400 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm px-2 py-1 rounded">
          {graphData ? `${graphData.nodes.length} concepts, ${graphData.edges.length} relationships` : 'Click a concept to find it in the text'}. Drag to rearrange, scroll to zoom.
        </span>
        <button
          onClick={generate}
          disabled={loading}
          aria-label="Regenerate graph"
          className="text-xs bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm px-2 py-1 rounded text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {graphData && (
          <button
            onClick={() => {
              if (!graphData) return
              const lines = ['## Concepts', ...graphData.nodes.map((n) => `- ${n.label} (${n.type})`), '', '## Relationships', ...graphData.edges.map((e) => {
                const src = typeof e.source === 'string' ? e.source : (e.source as {label:string}).label
                const tgt = typeof e.target === 'string' ? e.target : (e.target as {label:string}).label
                return `- ${src} → ${tgt}: ${e.label}`
              })]
              navigator.clipboard.writeText(lines.join('\n'))
            }}
            aria-label="Copy graph as text"
            className="text-xs bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm px-2 py-1 rounded text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            title="Copy graph as markdown"
          >
            Copy
          </button>
        )}
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm px-3 py-2 rounded text-xs flex gap-3">
        {Object.entries(TYPE_COLORS).filter(([k]) => k !== 'default').map(([type, color]) => (
          <span key={type} className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: color }} />
            {type}
          </span>
        ))}
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-gray-950/50 z-20">
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Extracting concepts... (may take up to 10s)
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <p className="text-gray-400 text-sm">{error}</p>
            <p className="text-gray-400/60 text-xs mt-2">Works best with technical documents (1000+ words). Click the refresh button to retry.</p>
          </div>
        </div>
      )}

      {tooltip && (
        <div
          className="absolute z-20 bg-gray-900 text-white text-xs px-3 py-2 rounded-lg shadow-lg pointer-events-none max-w-48"
          style={{ left: tooltip.x + 15, top: tooltip.y - 10 }}
        >
          <div className="font-semibold">{tooltip.label}</div>
          <div className="text-gray-400 text-[10px] mb-1">{tooltip.type}</div>
          {tooltip.connections.length > 0 && (
            <div className="border-t border-gray-700 pt-1 mt-1">
              <div className="text-[10px] text-gray-400 mb-0.5">Related to:</div>
              {tooltip.connections.map((c) => (
                <div key={c} className="text-[10px] text-blue-300">→ {c}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <svg
        ref={svgRef}
        className="w-full h-full"
        role="img"
        aria-label="Knowledge graph showing extracted concepts and their relationships. Drag nodes to rearrange, scroll to zoom."
        style={{ background: theme === 'dark' ? '#0a0a0f' : theme === 'sepia' ? '#faf6f1' : '#ffffff' }}
      />
    </div>
  )
}
