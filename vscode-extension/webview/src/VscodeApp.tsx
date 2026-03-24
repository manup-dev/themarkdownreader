import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import { Loader2, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useStore } from '@app/store/useStore'
import { Reader } from '@app/components/Reader'
import { TableOfContents } from '@app/components/TableOfContents'
import { TtsPlayer } from '@app/components/TtsPlayer'
import { ResizeHandle } from '@app/components/ResizeHandle'
import { KeyboardShortcuts } from '@app/components/KeyboardShortcuts'
import { ErrorBoundary } from '@app/components/ErrorBoundary'
import { getVsCodeApi } from './vscodeApi'
import type { ViewMode, Theme } from '@app/store/useStore'

const MindMapView = lazy(() => import('@app/components/MindMap').then((m) => ({ default: m.MindMapView })))
const SummaryCardsView = lazy(() => import('@app/components/SummaryCards').then((m) => ({ default: m.SummaryCardsView })))
const TreemapView = lazy(() => import('@app/components/TreemapView').then((m) => ({ default: m.TreemapView })))

function LazyFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
    </div>
  )
}

const viewModes: { value: ViewMode; label: string }[] = [
  { value: 'read', label: 'Read' },
  { value: 'mindmap', label: 'Mind Map' },
  { value: 'summary-cards', label: 'Cards' },
  { value: 'treemap', label: 'Treemap' },
]

export function VscodeApp() {
  const markdown = useStore((s) => s.markdown)
  const theme = useStore((s) => s.theme)
  const viewMode = useStore((s) => s.viewMode)
  const sidebarWidth = useStore((s) => s.sidebarWidth)
  const setMarkdown = useStore((s) => s.setMarkdown)
  const setTheme = useStore((s) => s.setTheme)
  const setFontSize = useStore((s) => s.setFontSize)
  const setViewMode = useStore((s) => s.setViewMode)
  const setSidebarWidth = useStore((s) => s.setSidebarWidth)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Apply theme
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark', 'sepia')
    if (theme === 'dark') root.classList.add('dark')
    if (theme === 'sepia') root.classList.add('sepia')
  }, [theme])

  // Listen for messages from VS Code extension host
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data
      switch (msg.type) {
        case 'setMarkdown':
        case 'updateMarkdown':
          setMarkdown(msg.content, msg.fileName)
          break
        case 'config':
          if (msg.theme) setTheme(msg.theme as Theme)
          if (msg.fontSize) setFontSize(msg.fontSize)
          if (msg.defaultView) setViewMode(msg.defaultView as ViewMode)
          break
        case 'readAloud':
          // TTS will be handled by the TtsPlayer component
          break
      }
    }

    window.addEventListener('message', handleMessage)

    // Tell extension host we're ready
    const vscode = getVsCodeApi()
    vscode?.postMessage({ type: 'ready' })

    return () => window.removeEventListener('message', handleMessage)
  }, [setMarkdown, setTheme, setFontSize, setViewMode])

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth(Math.max(150, Math.min(350, sidebarWidth + delta)))
  }, [sidebarWidth, setSidebarWidth])

  const themeClasses = { light: 'bg-gray-50', dark: 'bg-gray-950', sepia: 'bg-sepia-100' }
  const showSidebar = sidebarOpen && markdown && viewMode === 'read'

  if (!markdown) {
    return (
      <div className={`flex items-center justify-center h-screen ${themeClasses[theme]}`}>
        <div className="text-center space-y-3">
          <h2 className="text-xl font-bold text-gray-700 dark:text-gray-200">md-reader</h2>
          <p className="text-sm text-gray-400">Open a markdown file to start reading.</p>
          <p className="text-xs text-gray-300 dark:text-gray-600">Ctrl+Shift+R when a .md file is open</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex h-screen ${themeClasses[theme]}`}>
      <KeyboardShortcuts />

      {/* Sidebar */}
      {showSidebar && (
        <>
          <aside
            className="shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto p-3"
            style={{ width: sidebarWidth }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Contents</span>
              <button onClick={() => setSidebarOpen(false)} className="p-0.5 text-gray-400 hover:text-gray-600">
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            </div>
            <TableOfContents />
          </aside>
          <ResizeHandle onResize={handleSidebarResize} />
        </>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* View tabs */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm">
          {!showSidebar && viewMode === 'read' && (
            <button onClick={() => setSidebarOpen(true)} className="p-1 text-gray-400 hover:text-gray-600 mr-1">
              <PanelLeftOpen className="h-3.5 w-3.5" />
            </button>
          )}
          {viewModes.map((vm) => (
            <button
              key={vm.value}
              onClick={() => setViewMode(vm.value)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                viewMode === vm.value
                  ? 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {vm.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <Suspense fallback={<LazyFallback />}>
          {viewMode === 'read' && <Reader />}
          {viewMode === 'mindmap' && <ErrorBoundary name="Mind Map"><MindMapView /></ErrorBoundary>}
          {viewMode === 'summary-cards' && <ErrorBoundary name="Cards"><SummaryCardsView /></ErrorBoundary>}
          {viewMode === 'treemap' && <ErrorBoundary name="Treemap"><TreemapView /></ErrorBoundary>}
        </Suspense>
      </div>

      {/* TTS */}
      <TtsPlayer />
    </div>
  )
}
