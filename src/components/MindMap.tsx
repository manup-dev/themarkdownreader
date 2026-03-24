import { useEffect, useRef, useCallback, useState } from 'react'
import { Download, Maximize2 } from 'lucide-react'
import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'
import { useStore } from '../store/useStore'

const transformer = new Transformer()

export function MindMapView() {
  const markdown = useStore((s) => s.markdown)
  const theme = useStore((s) => s.theme)
  const fileName = useStore((s) => s.fileName)
  const svgRef = useRef<SVGSVGElement>(null)
  const mmRef = useRef<Markmap | null>(null)
  const [showHint, setShowHint] = useState(true)

  useEffect(() => {
    if (!svgRef.current) return

    const { root } = transformer.transform(markdown)

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
  }, [markdown, theme])

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

  const bgColor = theme === 'dark' ? '#0a0a0f' : theme === 'sepia' ? '#faf6f1' : '#ffffff'

  return (
    <div className="flex-1 overflow-hidden relative">
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
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleDownload}
          className="p-1.5 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          title="Download as PNG"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>
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
