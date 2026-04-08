import { useState, useCallback, lazy, Suspense } from 'react'
import { Loader2, RefreshCw, Download, ChevronDown, Pencil, Image } from 'lucide-react'
import { useStore } from '../store/useStore'
import { generateDiagramDSL } from '../lib/ai'
import { parseDiagramDSL, dslToExcalidraw, type DiagramDSL } from '../lib/excalidraw-converter'
import { DiagramSVG } from './DiagramSVG'

const ExcalidrawViewer = lazy(() => import('./ExcalidrawViewer').then(m => ({ default: m.ExcalidrawViewer })))

type DiagramType = DiagramDSL['type'] | 'auto'
const DIAGRAM_TYPES: { value: DiagramType; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'flowchart', label: 'Flowchart' },
  { value: 'hierarchy', label: 'Hierarchy' },
  { value: 'sequence', label: 'Sequence' },
  { value: 'mindmap', label: 'Mind Map' },
  { value: 'comparison', label: 'Comparison' },
]

export function DiagramGenerator() {
  const markdown = useStore(s => s.markdown)
  const fileName = useStore(s => s.fileName)
  const cachedDsl = useStore(s => s.diagramDsl)
  const setCachedDsl = useStore(s => s.setDiagramDsl)

  const [diagramType, setDiagramType] = useState<DiagramType>('auto')
  const [generating, setGenerating] = useState(false)
  const dsl = cachedDsl
  const setDsl = setCachedDsl
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'svg' | 'excalidraw'>('svg')

  const generate = useCallback(async () => {
    if (!markdown) return
    setGenerating(true)
    setError(null)

    try {
      // Try up to 3 times — small models occasionally produce malformed JSON
      let parsed: DiagramDSL | null = null
      for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
        const raw = await generateDiagramDSL(markdown)
        parsed = parseDiagramDSL(raw)
      }

      if (!parsed) {
        // Keep previous diagram if one exists, just show error
        setError(dsl ? 'Regeneration failed — keeping previous diagram. Try again.' : 'Failed to generate diagram. Try again or select a specific diagram type.')
        setGenerating(false)
        return
      }

      // Override type if user selected one
      if (diagramType !== 'auto') {
        parsed.type = diagramType
      }

      setDsl(parsed)
      setViewMode('svg')
      setError(null)
    } catch (err) {
      // Keep previous diagram on error
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }, [markdown, diagramType, dsl])

  const handleExcalidrawExport = useCallback(() => {
    if (!dsl) return
    const elements = dslToExcalidraw(dsl)
    const data = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'md-reader',
      elements,
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    }, null, 2)

    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(fileName ?? 'diagram').replace(/\.md$/, '')}.excalidraw`
    a.click()
    URL.revokeObjectURL(url)
  }, [dsl, fileName])

  const excalidrawElements = dsl && viewMode === 'excalidraw' ? dslToExcalidraw(dsl) : null

  return (
    <div className="flex flex-col w-full h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-3 border-b border-gray-200 dark:border-gray-700">
        <div className="relative">
          <select
            value={diagramType}
            onChange={e => setDiagramType(e.target.value as DiagramType)}
            className="appearance-none bg-gray-100 dark:bg-gray-800 text-sm rounded-lg pl-3 pr-8 py-1.5 border border-gray-200 dark:border-gray-700"
          >
            {DIAGRAM_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
        </div>

        <button
          onClick={generate}
          disabled={generating || !markdown}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50"
        >
          {generating ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating...</>
          ) : dsl ? (
            <><RefreshCw className="h-3.5 w-3.5" /> Regenerate</>
          ) : (
            'Generate Diagram'
          )}
        </button>

        {dsl && (
          <>
            {/* View mode toggle */}
            <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('svg')}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs ${viewMode === 'svg' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                title="SVG preview"
              >
                <Image className="h-3 w-3" /> Preview
              </button>
              <button
                onClick={() => setViewMode('excalidraw')}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs ${viewMode === 'excalidraw' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                title="Open in Excalidraw editor"
              >
                <Pencil className="h-3 w-3" /> Edit
              </button>
            </div>

            {/* Export as .excalidraw */}
            <button
              onClick={handleExcalidrawExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
              title="Download as .excalidraw file (editable in excalidraw.com)"
            >
              <Download className="h-3.5 w-3.5" /> .excalidraw
            </button>

            <span className="text-xs text-gray-400 ml-auto">
              {dsl.type} &middot; {dsl.nodes.length} nodes
            </span>
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 relative overflow-hidden min-h-0">
        {error && (
          <div className="p-4 m-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-lg">
            {error}
          </div>
        )}

        {dsl && viewMode === 'svg' ? (
          <DiagramSVG dsl={dsl} />
        ) : dsl && viewMode === 'excalidraw' && excalidrawElements ? (
          <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>}>
            <ExcalidrawViewer elements={excalidrawElements} />
          </Suspense>
        ) : !generating ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <p className="text-sm">Click &quot;Generate Diagram&quot; to visualize this document</p>
            <p className="text-xs">AI will extract key concepts and create a diagram</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
