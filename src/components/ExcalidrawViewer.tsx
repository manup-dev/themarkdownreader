import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { extractTextFromExcalidraw } from '../lib/excalidraw-text'
import { calculateFitZoom, type ExcalidrawEl } from '../lib/excalidraw-converter'
import '@excalidraw/excalidraw/index.css'

interface ExcalidrawViewerProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  elements?: any[]
  appState?: Record<string, unknown>
  inline?: boolean
  /** Legacy: raw Excalidraw JSON string (used by CollectionReader) */
  content?: string
  /** Legacy: file name (used by CollectionReader) */
  fileName?: string
}

export function ExcalidrawViewer({ elements: elementsProp, appState, inline, content }: ExcalidrawViewerProps) {
  const elements = useMemo(() => {
    if (elementsProp) return elementsProp
    if (content) {
      try {
        const parsed = JSON.parse(content)
        return parsed.elements ?? parsed
      } catch { return [] }
    }
    return []
  }, [elementsProp, content])

  const [expanded, setExpanded] = useState(!inline)
  const [fullscreen, setFullscreen] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [ExcalidrawComponent, setExcalidrawComponent] = useState<React.ComponentType<any> | null>(null)

  useEffect(() => {
    import('@excalidraw/excalidraw').then(mod => {
      setExcalidrawComponent(() => mod.Excalidraw)
    })
  }, [])

  // Pre-compute scroll/zoom to center elements in viewport
  const fitState = useMemo(() => {
    const viewW = inline ? 600 : Math.max(800, typeof window !== 'undefined' ? window.innerWidth - 200 : 1200)
    const viewH = inline ? 320 : Math.max(400, typeof window !== 'undefined' ? window.innerHeight - 200 : 600)
    return calculateFitZoom(elements as ExcalidrawEl[], viewW, viewH)
  }, [elements, inline])

  // Also use API as backup for scrollToContent after mount
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onExcalidrawAPI = useCallback((api: any) => {
    if (!api) return
    const tryFit = (attempt: number) => {
      try {
        const els = api.getSceneElements?.() ?? []
        if (els.length > 0) {
          api.scrollToContent(els, { fitToContent: true, animate: false })
        } else if (attempt < 5) {
          setTimeout(() => tryFit(attempt + 1), 500)
        }
      } catch { /* scrollToContent may not exist */ }
    }
    setTimeout(() => tryFit(0), 300)
  }, [])

  const extractedText = useMemo(
    () => extractTextFromExcalidraw(elements),
    [elements]
  )

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

  if (!ExcalidrawComponent) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
        <span className="text-sm text-gray-400">Loading Excalidraw...</span>
      </div>
    )
  }

  if (inline && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 border border-blue-200 dark:border-blue-800"
      >
        <Maximize2 className="h-4 w-4" />
        Show diagram ({elements.length} elements)
      </button>
    )
  }

  const containerClass = fullscreen
    ? 'fixed inset-0 z-50 bg-white dark:bg-gray-900'
    : inline
      ? 'h-80 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden'
      : 'h-full'

  return (
    <div className={`relative ${containerClass}`}>
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        {inline && (
          <button
            onClick={() => setExpanded(false)}
            className="p-1.5 bg-white dark:bg-gray-800 rounded shadow text-gray-500 hover:text-gray-700"
            title="Collapse"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={() => setFullscreen(!fullscreen)}
          className="p-1.5 bg-white dark:bg-gray-800 rounded shadow text-gray-500 hover:text-gray-700"
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>
      <ExcalidrawComponent
        excalidrawAPI={onExcalidrawAPI}
        initialData={{
          elements,
          appState: {
            ...appState,
            zenModeEnabled: false,
            viewModeEnabled: false, // allow interaction in edit mode
            zoom: { value: fitState.zoom },
            scrollX: fitState.scrollX,
            scrollY: fitState.scrollY,
          },
        }}
        theme={isDark ? 'dark' : 'light'}
        zenModeEnabled={false}
        gridModeEnabled={false}
      />
      {extractedText && (
        <span className="sr-only">{extractedText}</span>
      )}
    </div>
  )
}
