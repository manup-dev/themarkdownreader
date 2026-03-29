import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { Download, Maximize2, Layers, Target, ChevronDown, ChevronUp } from 'lucide-react'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'
import { useStore } from '../store/useStore'
import { trackEvent } from '../lib/telemetry'

const transformer = new Transformer()

interface MmNode {
  content?: string
  children?: MmNode[]
  payload?: { fold?: number }
  state?: { depth?: number; id?: number; el?: SVGGElement }
}

/** Count total nodes in a markmap tree */
function countNodes(node: MmNode): number {
  let count = 1
  if (node.children) for (const c of node.children) count += countNodes(c)
  return count
}

/** Collapse all nodes deeper than maxDepth */
function collapseDeep(node: MmNode, maxDepth: number, depth = 0) {
  if (!node.children) return
  for (const child of node.children) {
    if (depth >= maxDepth) {
      // Fold this node and don't recurse deeper (children stay hidden)
      if (!child.payload) child.payload = {}
      child.payload.fold = 1
    } else {
      // Ensure this node is unfolded, then check its children
      if (child.payload) child.payload.fold = 0
      collapseDeep(child, maxDepth, depth + 1)
    }
  }
}

export function MindMapView() {
  const markdown = useStore((s) => s.markdown)
  const theme = useStore((s) => s.theme)
  const fileName = useStore((s) => s.fileName)
  const activeSection = useStore((s) => s.activeSection)
  const toc = useStore((s) => s.toc)
  const svgRef = useRef<SVGSVGElement>(null)
  const mmRef = useRef<Markmap | null>(null)
  const rootRef = useRef<MmNode | null>(null)
  const [showHint, setShowHint] = useState(true)

  // Determine if doc is "large" and compute smart defaults
  const nodeCount = useMemo(() => {
    const { root } = transformer.transform(markdown)
    return countNodes(root)
  }, [markdown])
  const isLargeDoc = nodeCount > 40

  // Depth slider: auto-collapse for large docs
  const [maxDepth, setMaxDepth] = useState(2)
  const [showDepthControl, setShowDepthControl] = useState(false)

  // Derive highlight directly from activeSection (no extra state/effect)
  const highlightSlug = activeSection

  useEffect(() => {
    if (!svgRef.current) return

    const { root } = transformer.transform(markdown)
    rootRef.current = root as MmNode

    // Collapse nodes deeper than selected depth
    if (maxDepth <= 6) {
      collapseDeep(root as MmNode, maxDepth)
    }

    if (mmRef.current) {
      mmRef.current.destroy()
      mmRef.current = null
    }

    svgRef.current.innerHTML = ''

    const isDark = theme === 'dark'
    const isSepia = theme === 'sepia'

    mmRef.current = Markmap.create(svgRef.current, {
      autoFit: true,
      duration: 300,
      maxWidth: 280,
      paddingX: 16,
      initialExpandLevel: maxDepth <= 6 ? maxDepth : -1,
      color: (node: { state?: { depth?: number } }) => {
        const depth = node.state?.depth ?? 0
        if (isDark) {
          const colors = ['#60a5fa', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#22d3ee']
          return colors[depth % colors.length]
        }
        if (isSepia) {
          const colors = ['#92400e', '#78350f', '#854d0e', '#713f12', '#65a30d', '#0d9488']
          return colors[depth % colors.length]
        }
        const colors = ['#2563eb', '#7c3aed', '#db2777', '#d97706', '#059669', '#0891b2']
        return colors[depth % colors.length]
      },
    }, root)

    const textColor = isDark ? '#e5e7eb' : isSepia ? '#3d3122' : '#1f2937'
    const lineColor = isDark ? '#374151' : isSepia ? '#d6c4a8' : '#d1d5db'

    const style = document.createElement('style')
    style.textContent = `
      .markmap-node text { fill: ${textColor} !important; }
      .markmap-node line { stroke: ${lineColor} !important; }
      .markmap-link { stroke: ${lineColor} !important; }
      .markmap-node.mm-highlight rect { stroke: #3b82f6 !important; stroke-width: 2px !important; rx: 4; }
      .markmap-node.mm-highlight text { font-weight: bold !important; }
    `
    svgRef.current.prepend(style)

    // Ensure fit-to-view after initial render settles
    setTimeout(() => mmRef.current?.fit(), 100)

    // Ctrl+click node to navigate to section in reader
    const svgEl = svgRef.current
    const handleNodeClick = (e: MouseEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      const target = e.target as Element
      const textEl = target.closest('text') || (target.tagName === 'text' ? target : null)
      if (!textEl) return
      const nodeText = textEl.textContent?.trim()
      if (!nodeText) return
      // Find matching TOC entry
      const tocEntries = useStore.getState().toc
      const match = tocEntries.find((t) => nodeText.includes(t.text) || t.text.includes(nodeText))
      if (match) {
        e.preventDefault()
        useStore.getState().setViewMode('read')
        setTimeout(() => {
          const el = document.getElementById(match.id)
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            el.style.transition = 'background 300ms'
            el.style.background = 'rgba(59,130,246,0.15)'
            setTimeout(() => { el.style.background = '' }, 1500)
          }
        }, 200)
      }
    }
    svgEl?.addEventListener('click', handleNodeClick)

    return () => {
      svgEl?.removeEventListener('click', handleNodeClick)
      mmRef.current?.destroy()
      mmRef.current = null
    }
  }, [markdown, theme, maxDepth, isLargeDoc])

  // Highlight the active section node in the mind map
  // Only depends on highlightSlug and toc — not markdown/theme/maxDepth which trigger
  // the main effect that rebuilds the SVG (causing stale DOM queries)
  useEffect(() => {
    if (!highlightSlug || !svgRef.current || !mmRef.current) return
    // Small delay to let markmap finish rendering after a rebuild
    const timer = setTimeout(() => {
      if (!svgRef.current) return
      svgRef.current.querySelectorAll('.mm-highlight').forEach((el) => el.classList.remove('mm-highlight'))
      const textEls = svgRef.current.querySelectorAll('.markmap-node text')
      const tocMatch = toc.find((t) => t.id === highlightSlug)
      if (!tocMatch) return
      for (const textEl of textEls) {
        const content = textEl.textContent?.trim() ?? ''
        if (content.includes(tocMatch.text) || tocMatch.text.includes(content)) {
          const gEl = textEl.closest('.markmap-node')
          if (gEl) {
            gEl.classList.add('mm-highlight')
            gEl.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
          }
          break
        }
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [highlightSlug, toc])

  // Delight #18: Download mind map as PNG
  const handleDownload = useCallback(() => {
    const svg = svgRef.current
    if (!svg) return

    const svgData = new XMLSerializer().serializeToString(svg)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    img.onload = () => {
      canvas.width = img.width * 2
      canvas.height = img.height * 2
      ctx.scale(2, 2)
      const bgColor = theme === 'dark' ? '#0a0a0f' : theme === 'sepia' ? '#faf6f1' : '#ffffff'
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, img.width, img.height)
      ctx.drawImage(img, 0, 0)

      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(pngBlob)
        a.download = `${(fileName ?? 'mindmap').replace(/\.md$/, '')}-mindmap.png`
        a.click()
        URL.revokeObjectURL(a.href)
      })
      URL.revokeObjectURL(url)
    }
    img.src = url
  }, [theme, fileName])

  // Fit to view
  const handleFit = useCallback(() => {
    mmRef.current?.fit()
  }, [])

  // Focus on active section: expand path to current section and zoom in
  const handleFocusSection = useCallback(() => {
    if (!activeSection || !rootRef.current || !mmRef.current) return
    const tocMatch = toc.find((t) => t.id === activeSection)
    if (!tocMatch) return
    // Find and highlight
    // highlightSlug is derived from activeSection, no setState needed
    // Refit after a moment to let markmap update
    setTimeout(() => mmRef.current?.fit(), 200)
  }, [activeSection, toc])

  const bgColor = theme === 'dark' ? '#0a0a0f' : theme === 'sepia' ? '#faf6f1' : '#ffffff'

  return (
    <div className="flex-1 overflow-hidden relative">
      {/* Controls toolbar */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        {showHint && (
          <span
            className="text-xs text-gray-400 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm px-2 py-1 rounded cursor-pointer hover:opacity-70"
            onClick={() => setShowHint(false)}
            title="Click to dismiss"
          >
            Scroll to zoom, drag to pan. Ctrl+click a node to jump to that section. &times;
          </span>
        )}
        <button
          onClick={handleFit}
          className="p-1.5 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          title="Fit to view"
          aria-label="Fit to view"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleDownload}
          className="p-1.5 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          title="Download as PNG"
          aria-label="Download as PNG"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        {activeSection && (
          <button
            onClick={handleFocusSection}
            className="p-1.5 bg-blue-500/90 backdrop-blur-sm rounded text-white hover:bg-blue-600"
            title="Focus on current section"
            aria-label="Focus on current section"
          >
            <Target className="h-3.5 w-3.5" />
          </button>
        )}
        {/* Depth control for large documents */}
        <button
          onClick={() => setShowDepthControl(!showDepthControl)}
          className={`p-1.5 backdrop-blur-sm rounded transition-colors ${
            showDepthControl
              ? 'bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400'
              : 'bg-white/80 dark:bg-gray-900/80 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
          title="Adjust depth level"
          aria-label="Adjust depth level"
        >
          <Layers className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Depth slider (shown when toggled) */}
      {showDepthControl && (
        <div className="absolute top-14 left-4 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-lg p-3 flex flex-col gap-2 min-w-[180px]">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>Depth: {maxDepth > 6 ? 'All' : maxDepth}</span>
            <span className="text-[10px]">{nodeCount} nodes</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setMaxDepth((d) => Math.max(1, d - 1)); trackEvent('mindmap_depth_change') }}
              className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              disabled={maxDepth <= 1}
              aria-label="Decrease depth"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
            <input
              type="range"
              min={1}
              max={7}
              value={Math.min(maxDepth, 7)}
              onChange={(e) => { setMaxDepth(parseInt(e.target.value)); trackEvent('mindmap_depth_change') }}
              className="flex-1 h-1.5 accent-blue-500"
              aria-label="Mind map depth level"
            />
            <button
              onClick={() => { setMaxDepth((d) => Math.min(10, d + 1)); trackEvent('mindmap_depth_change') }}
              className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              disabled={maxDepth >= 7}
              aria-label="Increase depth"
            >
              <ChevronUp className="h-3 w-3" />
            </button>
          </div>
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((d) => (
              <button
                key={d}
                onClick={() => { setMaxDepth(d); trackEvent('mindmap_depth_change') }}
                className={`flex-1 text-[10px] py-0.5 rounded ${
                  maxDepth === d
                    ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-medium'
                    : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                H{d}
              </button>
            ))}
            <button
              onClick={() => { setMaxDepth(10); trackEvent('mindmap_depth_change') }}
              className={`flex-1 text-[10px] py-0.5 rounded ${
                maxDepth > 6
                  ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-medium'
                  : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              All
            </button>
          </div>
        </div>
      )}

      {/* Node count badge for large docs */}
      {isLargeDoc && (
        <div className="absolute bottom-4 left-4 z-10 text-[10px] text-gray-400 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm px-2 py-1 rounded">
          {nodeCount} nodes · showing depth {maxDepth > 6 ? 'all' : maxDepth}
        </div>
      )}

      <svg
        ref={svgRef}
        className="w-full h-full"
        role="img"
        aria-label="Mind map visualization of document structure. Scroll to zoom, drag to pan, click nodes to expand or collapse."
        style={{ background: bgColor }}
      />
    </div>
  )
}
