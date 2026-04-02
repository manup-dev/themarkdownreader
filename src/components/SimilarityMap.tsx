import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { Loader2, RefreshCw } from 'lucide-react'
import { useStore } from '../store/useStore'
import { computeUmapProjection, computeCommunities } from '../lib/docstore'

const COMMUNITY_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#f97316', '#6366f1', '#ef4444', '#84cc16']

export function SimilarityMap() {
  const theme = useStore((s) => s.theme)
  const openDocument = useStore((s) => s.openDocument)
  const svgRef = useRef<SVGSVGElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)

  const render = useCallback(async () => {
    if (!svgRef.current) return
    setLoading(true)
    setError(null)

    try {
      // Compute communities first, then UMAP
      await computeCommunities()
      const points = await computeUmapProjection()

      if (points.length < 3) {
        setError('Need at least 3 documents for a similarity map.')
        setLoading(false)
        return
      }

      const svg = d3.select(svgRef.current)
      const width = svgRef.current.clientWidth
      const height = svgRef.current.clientHeight
      const isDark = theme === 'dark'
      const isSepia = theme === 'sepia'

      svg.selectAll('*').remove()

      const xExtent = d3.extent(points, (d) => d.x) as [number, number]
      const yExtent = d3.extent(points, (d) => d.y) as [number, number]
      const padding = 60

      const xScale = d3.scaleLinear().domain(xExtent).range([padding, width - padding])
      const yScale = d3.scaleLinear().domain(yExtent).range([padding, height - padding])

      const g = svg.append('g')
      svg.call(
        d3.zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.5, 4])
          .on('zoom', (event) => g.attr('transform', event.transform)) as never,
      )

      // Draw community hulls (convex hulls for each community)
      const communities = d3.group(points, (d) => d.communityId)
      for (const [communityId, members] of communities) {
        if (members.length < 3) continue
        const hullPoints: [number, number][] = members.map((m) => [xScale(m.x), yScale(m.y)])
        const hull = d3.polygonHull(hullPoints)
        if (hull) {
          g.append('path')
            .attr('d', `M${hull.map((p) => p.join(',')).join('L')}Z`)
            .attr('fill', COMMUNITY_COLORS[communityId % COMMUNITY_COLORS.length])
            .attr('fill-opacity', isSepia ? 0.1 : isDark ? 0.08 : 0.06)
            .attr('stroke', COMMUNITY_COLORS[communityId % COMMUNITY_COLORS.length])
            .attr('stroke-opacity', 0.2)
            .attr('stroke-width', 1)
        }
      }

      // Draw points
      const { getAllDocuments } = await import('../lib/docstore')
      const allDocs = await getAllDocuments()
      const docMap = new Map(allDocs.map((d) => [d.id!, d]))

      g.selectAll('circle')
        .data(points)
        .join('circle')
        .attr('cx', (d) => xScale(d.x))
        .attr('cy', (d) => yScale(d.y))
        .attr('r', 8)
        .attr('fill', (d) => COMMUNITY_COLORS[d.communityId % COMMUNITY_COLORS.length])
        .attr('stroke', isSepia ? '#e8d5be' : isDark ? '#1f2937' : '#ffffff')
        .attr('stroke-width', 2)
        .attr('cursor', 'pointer')
        .on('dblclick', (_event, d) => {
          const doc = docMap.get(d.docId)
          if (doc) openDocument(doc.markdown, doc.fileName, doc.id!)
        })
        .on('mouseenter', (event, d) => {
          const rect = svgRef.current!.getBoundingClientRect()
          setTooltip({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top - 45,
            text: `${d.fileName}\nCluster ${d.communityId + 1}\nDouble-click to open`,
          })
        })
        .on('mouseleave', () => setTooltip(null))

      // Labels
      g.selectAll('text.label')
        .data(points)
        .join('text')
        .attr('class', 'label')
        .attr('x', (d) => xScale(d.x))
        .attr('y', (d) => yScale(d.y) + 20)
        .text((d) => {
          const name = d.fileName.replace(/\.(md|markdown|txt)$/, '')
          return name.length > 20 ? name.slice(0, 19) + '...' : name
        })
        .attr('font-size', '9px')
        .attr('fill', isSepia ? '#5c4a32' : isDark ? '#9ca3af' : '#6b7280')
        .attr('text-anchor', 'middle')
        .style('pointer-events', 'none')

    } catch (e) {
      setError('Failed to compute similarity map.')
      console.error(e)
    }
    setLoading(false)
  }, [theme, openDocument])

  useEffect(() => { render() }, [render])

  return (
    <div className="flex-1 overflow-hidden relative">
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        <span className="text-xs text-gray-400 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm px-2 py-1 rounded">
          UMAP similarity map. Colors = topic clusters (Louvain). Double-click to open.
        </span>
        <button
          onClick={render}
          disabled={loading}
          className="text-xs bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm px-2 py-1 rounded text-gray-500 hover:text-gray-700"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm px-3 py-2 rounded text-xs">
        <span className="text-gray-400">Nearby = similar content. Clusters = detected topic groups.</span>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-gray-950/50 z-20">
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Computing UMAP projection + Louvain communities...
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-gray-400 text-sm">{error}</p>
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
