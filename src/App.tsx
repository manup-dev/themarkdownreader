import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import { MessageSquare, PanelLeftClose, PanelLeftOpen, Loader2 } from 'lucide-react'
import { useStore } from './store/useStore'
import { Upload } from './components/Upload'
import { Reader } from './components/Reader'
import { Toolbar } from './components/Toolbar'
import { TableOfContents } from './components/TableOfContents'
import { TtsPlayer } from './components/TtsPlayer'
import { SelectionMenu } from './components/SelectionMenu'
import { SearchOverlay } from './components/SearchOverlay'
import { ResizeHandle } from './components/ResizeHandle'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { ErrorBoundary } from './components/ErrorBoundary'

// Lazy load heavy/optional components
const Chat = lazy(() => import('./components/Chat').then((m) => ({ default: m.Chat })))
const MindMapView = lazy(() => import('./components/MindMap').then((m) => ({ default: m.MindMapView })))
const SummaryCardsView = lazy(() => import('./components/SummaryCards').then((m) => ({ default: m.SummaryCardsView })))
const TreemapView = lazy(() => import('./components/TreemapView').then((m) => ({ default: m.TreemapView })))
const KnowledgeGraphView = lazy(() => import('./components/KnowledgeGraph').then((m) => ({ default: m.KnowledgeGraphView })))
const CoachView = lazy(() => import('./components/Coach').then((m) => ({ default: m.CoachView })))
const Workspace = lazy(() => import('./components/Workspace').then((m) => ({ default: m.Workspace })))
const CrossDocGraph = lazy(() => import('./components/CrossDocGraph').then((m) => ({ default: m.CrossDocGraph })))
const CorrelationView = lazy(() => import('./components/CorrelationView').then((m) => ({ default: m.CorrelationView })))
const SimilarityMap = lazy(() => import('./components/SimilarityMap').then((m) => ({ default: m.SimilarityMap })))
const CollectionReader = lazy(() => import('./components/CollectionReader').then((m) => ({ default: m.CollectionReader })))

function LazyFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
    </div>
  )
}

// Track whether a state change came from popstate (back/forward) to avoid re-pushing
let isPopState = false

function App() {
  const markdown = useStore((s) => s.markdown)
  const theme = useStore((s) => s.theme)
  const viewMode = useStore((s) => s.viewMode)
  const workspaceMode = useStore((s) => s.workspaceMode)
  const sidebarWidth = useStore((s) => s.sidebarWidth)
  const chatWidth = useStore((s) => s.chatWidth)
  const setSidebarWidth = useStore((s) => s.setSidebarWidth)
  const setChatWidth = useStore((s) => s.setChatWidth)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)

  // ─── Browser history integration ────────────────────────────────────
  // Push to history when view changes so back/forward navigates between views
  useEffect(() => {
    if (isPopState) { isPopState = false; return }
    const state = { viewMode, workspaceMode, fileName: useStore.getState().fileName }
    const url = viewMode === 'read' && !workspaceMode
      ? `#${viewMode}`
      : `#${viewMode}`
    // Replace on first load, push on subsequent changes
    if (!window.history.state?.viewMode) {
      window.history.replaceState(state, '', url)
    } else if (window.history.state.viewMode !== viewMode || window.history.state.workspaceMode !== workspaceMode) {
      window.history.pushState(state, '', url)
    }
  }, [viewMode, workspaceMode])

  // Listen for back/forward button
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (!e.state?.viewMode) return
      isPopState = true
      const s = useStore.getState()
      if (e.state.workspaceMode !== s.workspaceMode) {
        s.setWorkspaceMode(e.state.workspaceMode)
      }
      if (e.state.viewMode !== s.viewMode) {
        s.setViewMode(e.state.viewMode)
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark', 'sepia', 'high-contrast')
    if (theme === 'dark' || theme === 'high-contrast') root.classList.add('dark')
    if (theme === 'sepia') root.classList.add('sepia')
    if (theme === 'high-contrast') root.classList.add('high-contrast')
  }, [theme])

  // Keyboard shortcuts: Escape closes chat/focus, Ctrl+Shift+F toggles focus mode
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setChatOpen(false); setFocusMode(false) }
      if (e.ctrlKey && e.shiftKey && e.key === 'F') { e.preventDefault(); setFocusMode((f) => !f) }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // Use getState() to avoid stale closures during rapid dragging
  const handleSidebarResize = useCallback((delta: number) => {
    const cur = useStore.getState().sidebarWidth
    setSidebarWidth(Math.max(180, Math.min(400, cur + delta)))
  }, [setSidebarWidth])

  const handleChatResize = useCallback((delta: number) => {
    const cur = useStore.getState().chatWidth
    setChatWidth(Math.max(250, Math.min(600, cur - delta)))
  }, [setChatWidth])

  if (!markdown && !workspaceMode) {
    return <Upload />
  }

  const themeClasses: Record<string, string> = { light: 'bg-gray-50', dark: 'bg-gray-950', sepia: 'bg-sepia-100', 'high-contrast': 'bg-black' }
  const isWorkspaceView = viewMode === 'workspace' || viewMode === 'cross-doc-graph' || viewMode === 'correlation' || viewMode === 'similarity-map' || viewMode === 'collection'
  const showSidebar = sidebarOpen && markdown && (viewMode === 'read' || viewMode === 'coach')
  const showChat = chatOpen && markdown && !isWorkspaceView
  const showTts = !!markdown && !isWorkspaceView

  return (
    <div className={`flex h-screen ${themeClasses[theme]} ${focusMode ? 'focus-mode' : ''}`}>
      <KeyboardShortcuts />

      {/* Sidebar: TOC (resizable, collapsible) */}
      {showSidebar && (
        <>
          <aside
            className="shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto p-4"
            style={{ width: sidebarWidth }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-sm font-bold text-gray-700 dark:text-gray-200">md-reader</span>
                <span className="block text-[9px] text-gray-400 -mt-0.5">Table of Contents</span>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            <TableOfContents />
          </aside>
          <ResizeHandle onResize={handleSidebarResize} />
        </>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <Toolbar />
        <div className="flex-1 flex min-h-0">
          {/* Sidebar toggle */}
          {!showSidebar && markdown && (viewMode === 'read' || viewMode === 'coach') && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="absolute top-24 left-2 z-10 p-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}

          {/* Views — fade transition on switch, ErrorBoundary + Suspense for lazy loads */}
          <div key={viewMode} className="flex-1 flex min-h-0 animate-scale-in">
            <Suspense fallback={<LazyFallback />}>
              {isWorkspaceView && viewMode === 'workspace' && <ErrorBoundary name="Workspace"><Workspace /></ErrorBoundary>}
              {isWorkspaceView && viewMode === 'cross-doc-graph' && <ErrorBoundary name="Doc Graph"><CrossDocGraph /></ErrorBoundary>}
              {isWorkspaceView && viewMode === 'correlation' && <ErrorBoundary name="Correlations"><CorrelationView /></ErrorBoundary>}
              {isWorkspaceView && viewMode === 'similarity-map' && <ErrorBoundary name="Similarity Map"><SimilarityMap /></ErrorBoundary>}
              {isWorkspaceView && viewMode === 'collection' && <ErrorBoundary name="Collection"><CollectionReader /></ErrorBoundary>}

              {!isWorkspaceView && markdown && (
                <>
                  {viewMode === 'read' && <Reader />}
                  {viewMode === 'mindmap' && <ErrorBoundary name="Mind Map"><MindMapView /></ErrorBoundary>}
                  {viewMode === 'summary-cards' && <ErrorBoundary name="Summary Cards"><SummaryCardsView /></ErrorBoundary>}
                  {viewMode === 'treemap' && <ErrorBoundary name="Treemap"><TreemapView /></ErrorBoundary>}
                  {viewMode === 'knowledge-graph' && <ErrorBoundary name="Knowledge Graph"><KnowledgeGraphView /></ErrorBoundary>}
                  {viewMode === 'coach' && <ErrorBoundary name="Coach"><CoachView /></ErrorBoundary>}
                </>
              )}
            </Suspense>
          </div>

          {/* Chat panel (resizable, collapsible) */}
          {showChat && (
            <>
              <ResizeHandle onResize={handleChatResize} />
              <aside
                className="shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
                style={{ width: chatWidth }}
              >
                <Suspense fallback={<LazyFallback />}>
                  <ErrorBoundary name="Chat">
                    <Chat />
                  </ErrorBoundary>
                </Suspense>
              </aside>
            </>
          )}
        </div>
      </div>

      {/* TTS Player */}
      {showTts && <TtsPlayer />}

      {/* Selection menu (highlight, AI explain, define, search, copy) */}
      {markdown && viewMode === 'read' && <SelectionMenu />}

      {/* In-document search (Ctrl+K or /) */}
      <SearchOverlay />

      {/* Chat toggle FAB */}
      {markdown && !isWorkspaceView && (
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className={`fixed bottom-6 right-6 p-3.5 rounded-full shadow-lg transition-all z-20 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none ${
            chatOpen
              ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:scale-110'
              : 'bg-blue-600 text-white hover:bg-blue-700 animate-pulse-once hover:scale-110'
          }`}
          title={chatOpen ? 'Close chat (Esc)' : 'Ask about this document'}
        >
          <MessageSquare className="h-5 w-5" />
        </button>
      )}
    </div>
  )
}

export default App
