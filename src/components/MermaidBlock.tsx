import { useEffect, useRef, useState, useId } from 'react'
import { useStore } from '../store/useStore'

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, code: string) => Promise<{ svg: string; bindFunctions?: (el: Element) => void }>
}

let mermaidPromise: Promise<MermaidApi> | null = null
let lastInitTheme: string | null = null

async function loadMermaid(theme: string): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => mod.default as unknown as MermaidApi)
  }
  const mermaid = await mermaidPromise
  if (lastInitTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' || theme === 'high-contrast' ? 'dark' : theme === 'sepia' ? 'neutral' : 'default',
      fontFamily: 'inherit',
    })
    lastInitTheme = theme
  }
  return mermaid
}

export function MermaidBlock({ code }: { code: string }) {
  const theme = useStore((s) => s.theme)
  const reactId = useId()
  const safeId = 'mmd-' + reactId.replace(/:/g, '-')
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(null)
    loadMermaid(theme)
      .then((mermaid) => mermaid.render(safeId + '-svg', code))
      .then(({ svg, bindFunctions }) => {
        if (cancelled || !containerRef.current) return
        containerRef.current.innerHTML = svg
        const svgEl = containerRef.current.querySelector('svg')
        if (svgEl) {
          svgEl.removeAttribute('height')
          svgEl.style.maxWidth = '100%'
          svgEl.style.height = 'auto'
        }
        bindFunctions?.(containerRef.current)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
      })
    return () => { cancelled = true }
  }, [code, theme, safeId])

  return (
    <div className="my-4 rounded-lg border border-gray-200 dark:border-gray-800 sepia:border-sepia-200 bg-white dark:bg-gray-900 sepia:bg-sepia-50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 sepia:border-sepia-200 text-xs text-gray-500 dark:text-gray-400 sepia:text-sepia-700">
        <span className="font-mono">mermaid</span>
        <button
          type="button"
          onClick={() => setShowSource((v) => !v)}
          className="px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 sepia:hover:bg-sepia-100 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none"
        >
          {showSource ? 'Hide source' : 'Show source'}
        </button>
      </div>
      {error ? (
        <div className="p-3">
          <p className="text-sm text-red-600 dark:text-red-400 mb-2">Diagram failed to render: {error}</p>
          <pre className="text-xs overflow-auto bg-gray-50 dark:bg-gray-950 sepia:bg-sepia-100 p-2 rounded"><code>{code}</code></pre>
        </div>
      ) : (
        <div ref={containerRef} data-testid="mermaid-diagram" className="p-3 overflow-auto flex justify-center" />
      )}
      {showSource && !error && (
        <pre className="text-xs overflow-auto bg-gray-50 dark:bg-gray-950 sepia:bg-sepia-100 p-2 border-t border-gray-200 dark:border-gray-800 sepia:border-sepia-200"><code>{code}</code></pre>
      )}
    </div>
  )
}
