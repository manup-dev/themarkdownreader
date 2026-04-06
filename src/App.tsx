import { useEffect, useLayoutEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import { MessageSquare, MessageSquareText, PanelLeftClose, PanelLeftOpen, Loader2, Menu, Volume2, X } from 'lucide-react'
import { useStore, type ViewMode } from './store/useStore'
import { getCommentCount } from './lib/docstore'
import { SAMPLE_MARKDOWN } from './lib/sample-doc'
import { extractToc } from './lib/markdown'
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
import { OnboardingOverlay } from './components/OnboardingOverlay'
import { TelemetryBanner } from './components/TelemetryBanner'

// Lazy load heavy/optional components
const Chat = lazy(() => import('./components/Chat').then((m) => ({ default: m.Chat })))
const CommentsPanel = lazy(() => import('./components/CommentsPanel').then((m) => ({ default: m.CommentsPanel })))
const MindMapView = lazy(() => import('./components/MindMap').then((m) => ({ default: m.MindMapView })))
const SummaryCardsView = lazy(() => import('./components/SummaryCards').then((m) => ({ default: m.SummaryCardsView })))
const TreemapView = lazy(() => import('./components/TreemapView').then((m) => ({ default: m.TreemapView })))
const KnowledgeGraphView = lazy(() => import('./components/KnowledgeGraph').then((m) => ({ default: m.KnowledgeGraphView })))
const CoachView = lazy(() => import('./components/Coach').then((m) => ({ default: m.CoachView })))
const PodcastPlayer = lazy(() => import('./components/PodcastPlayer').then(m => ({ default: m.PodcastPlayer })))
const DiagramGenerator = lazy(() => import('./components/DiagramGenerator').then(m => ({ default: m.DiagramGenerator })))
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

function App() {
  // Track whether a state change came from popstate (back/forward) to avoid re-pushing
  const isPopStateRef = useRef(false)
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
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentCount, setCommentCount] = useState(0)
  const [focusMode, setFocusMode] = useState(false)
  const [fabMenuOpen, setFabMenuOpen] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [mobileTocOpen, setMobileTocOpen] = useState(false)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const setMarkdown = useStore((s) => s.setMarkdown)
  const activeDocId = useStore((s) => s.activeDocId)
  const dyslexicFont = useStore((s) => s.dyslexicFont)

  // Browser extension: handle incoming markdown from extension
  useEffect(() => {
    const hash = window.location.hash

    // Handle #md=<base64> — inline markdown payload from extension
    if (hash.startsWith('#md=')) {
      const encoded = hash.slice(4)
      window.history.replaceState(null, '', window.location.pathname)
      try {
        const json = decodeURIComponent(escape(atob(encoded)))
        const { markdown: md, fileName } = JSON.parse(json)
        if (md) setMarkdown(md, fileName || 'document.md')
      } catch (err) {
        console.error('md-reader: Failed to decode extension payload:', err)
      }
      return
    }

    // Handle #url=<encoded-url> — fetch raw content (public repos only)
    if (hash.startsWith('#url=')) {
      const encodedUrl = hash.slice(5)
      window.history.replaceState(null, '', window.location.pathname)
      try {
        const targetUrl = decodeURIComponent(encodedUrl)
        if (!targetUrl.startsWith('https://') && !targetUrl.startsWith('http://')) return
        const fileName = targetUrl.split('/').pop() || 'document.md'
        fetch(targetUrl)
          .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text() })
          .then((md) => setMarkdown(md, fileName))
          .catch((err) => console.error('md-reader: Failed to fetch from extension URL:', err))
      } catch { /* invalid URL encoding */ }
      return
    }

    // Handle #ext-pending — large file fallback, wait for postMessage
    if (hash === '#ext-pending') {
      window.history.replaceState(null, '', window.location.pathname)
    }

    // Listen for postMessage from extension (large file fallback)
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'md-reader-load' && event.data.markdown) {
        setMarkdown(event.data.markdown, event.data.fileName || 'document.md')
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [setMarkdown])

  // Demo mode: ?demo=true loads sample document for first-time visitors
  // CLI mode: ?cli=true fetches content served by `npx md-reader file.md`
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    // Demo mode
    if (params.get('demo') === 'true' && !markdown) {
      setMarkdown(SAMPLE_MARKDOWN, 'welcome.md')
      window.history.replaceState(null, '', window.location.pathname)
      return
    }

    // CLI mode: fetch content served by `npx md-reader file.md`
    if (params.get('cli') === 'true') {
      fetch('/__cli__/content')
        .then(res => res.json())
        .then(data => {
          if (data.markdown) {
            setMarkdown(data.markdown, data.fileName || 'document.md')
          }
          window.history.replaceState(null, '', window.location.pathname)
        })
        .catch(() => {
          // Not running via CLI, ignore
        })
    }
  }, [markdown, setMarkdown])

  // MCP integration: handle #file=<path>&view=<mode> from MCP server
  useEffect(() => {
    function handleMcpHash() {
      const hash = window.location.hash
      if (!hash.includes('file=')) return

      // Parse hash params: #file=<path>&view=<mode>&tts=true&section=<heading>
      const params = new URLSearchParams(hash.slice(1))
      const filePath = params.get('file')
      const view = (params.get('view') || 'read') as ViewMode
      const tts = params.get('tts') === 'true'
      const section = params.get('section')

      if (!filePath) return

      // Clear hash immediately so browser history useEffect doesn't conflict
      window.history.replaceState(null, '', window.location.pathname)

      // Note: URLSearchParams.get() already decodes percent-encoding, so no
      // additional decodeURIComponent() call is needed here.
      const fileName = filePath.split('/').pop() || 'document.md'

      fetch(`/api/file?path=${encodeURIComponent(filePath)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to load file: HTTP ${res.status}`)
          return res.text()
        })
        .then((md) => {
          setMarkdown(md, fileName)
          useStore.getState().setViewMode(view)

          // Compute TOC locally — the store's toc is populated by Reader's
          // useEffect which hasn't run yet at this point
          const toc = extractToc(md)

          // Start TTS if requested
          if (tts) {
            import('./lib/tts').then(({ tts: ttsEngine }) => {
              ttsEngine.loadMarkdown(md)
              if (section) {
                const matchIdx = toc.findIndex((t) =>
                  t.text.toLowerCase().includes(section.toLowerCase())
                )
                ttsEngine.play(matchIdx >= 0 ? matchIdx : 0)
              } else {
                ttsEngine.play(0)
              }
              useStore.getState().setTtsPlaying(true)
            }).catch(() => { /* TTS module load failed — non-critical */ })
          }

          // Navigate to section if specified (for coach view)
          if (section && !tts) {
            const match = toc.find((t) =>
              t.text.toLowerCase().includes(section.toLowerCase())
            )
            if (match) {
              useStore.getState().setActiveSection(match.id)
            }
          }
        })
        .catch((err) => console.error('md-reader: MCP file load failed:', err))
    }

    // Run on mount (fresh tab) AND on hash change (reused tab from MCP server)
    handleMcpHash()
    window.addEventListener('hashchange', handleMcpHash)
    return () => window.removeEventListener('hashchange', handleMcpHash)
  }, [setMarkdown])

  // Trigger onboarding on first document load
  useEffect(() => {
    if (markdown && !localStorage.getItem('md-reader-onboarding-done')) {
      // Small delay so the UI renders first
      const t = setTimeout(() => setShowOnboarding(true), 800)
      return () => clearTimeout(t)
    }
  }, [markdown])

  // Track previous view for directional transitions
  const [prevViewMode, setPrevViewMode] = useState(viewMode)
  if (viewMode !== prevViewMode) {
    // React pattern: update state during render for derived state (no extra re-render)
    setPrevViewMode(viewMode)
  }
  const viewDirection = (() => {
    const views: ViewMode[] = ['read', 'summary-cards', 'mindmap', 'treemap', 'knowledge-graph', 'coach']
    const prev = views.indexOf(prevViewMode)
    const curr = views.indexOf(viewMode)
    return curr > prev ? 'right' : curr < prev ? 'left' : 'none'
  })()

  // Close mobile TOC when view changes
  useEffect(() => { setMobileTocOpen(false) }, [viewMode]) // Intentional: reset on view switch

  // ─── Browser history integration ────────────────────────────────────
  // Push to history when view changes so back/forward navigates between views
  useEffect(() => {
    if (isPopStateRef.current) { isPopStateRef.current = false; return }
    const state = { viewMode, workspaceMode, fileName: useStore.getState().fileName }
    const url = `#${viewMode}`
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
      isPopStateRef.current = true
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

  // Apply theme class before paint to prevent flash of wrong theme on code blocks
  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark', 'sepia', 'high-contrast')
    if (theme === 'dark' || theme === 'high-contrast') root.classList.add('dark')
    if (theme === 'sepia') root.classList.add('sepia')
    if (theme === 'high-contrast') root.classList.add('high-contrast')
  }, [theme])

  // Refresh comment count periodically and on doc change
  useEffect(() => {
    if (!activeDocId) {
      setCommentCount(0)
      return undefined  // explicit return for cleanup consistency
    }
    let cancelled = false
    const fetchCount = () => {
      if (cancelled) return
      getCommentCount(activeDocId).then((c) => { if (!cancelled) setCommentCount(c) })
    }
    fetchCount()
    const interval = setInterval(fetchCount, 3000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [activeDocId])

  // Keyboard shortcuts: Escape closes chat/focus, Ctrl+Shift+F toggles focus mode
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setChatOpen(false); setCommentsOpen(false); setFocusMode(false); setFabMenuOpen(false) }
      if (e.ctrlKey && e.shiftKey && e.key === 'F') { e.preventDefault(); setFocusMode((f) => !f) }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // Offline detection
  useEffect(() => {
    const goOffline = () => setIsOffline(true)
    const goOnline = () => setIsOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => { window.removeEventListener('offline', goOffline); window.removeEventListener('online', goOnline) }
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
  const showComments = commentsOpen && markdown && !isWorkspaceView
  const showTts = !!markdown && !isWorkspaceView

  return (
    <div className={`flex h-screen ${themeClasses[theme]} ${focusMode ? 'focus-mode' : ''} ${dyslexicFont ? 'font-dyslexic' : ''}`}>
      <a href="#main-content" className="skip-to-content">Skip to content</a>
      <KeyboardShortcuts />

      {/* Sidebar: TOC (resizable, collapsible) */}
      {showSidebar && (
        <>
          <aside
            className="shrink-0 border-r border-gray-200 dark:border-gray-800 sepia:border-sepia-200 bg-white dark:bg-gray-900 sepia:bg-sepia-50 overflow-y-auto p-4"
            style={{ width: sidebarWidth }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="text-sm font-bold text-gray-700 dark:text-gray-200 sepia:text-sepia-800">md-reader</span>
                <span className="block text-[9px] text-gray-400 -mt-0.5">Table of Contents</span>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 sepia:text-sepia-800"
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
      <div id="main-content" className="flex-1 flex flex-col min-w-0" role="main">
        <Toolbar />
        <div className="flex-1 flex min-h-0">
          {/* Sidebar toggle */}
          {!showSidebar && markdown && (viewMode === 'read' || viewMode === 'coach') && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="absolute top-24 left-2 z-10 p-1.5 bg-white dark:bg-gray-800 sepia:bg-sepia-50 border border-gray-200 dark:border-gray-700 sepia:border-sepia-200 rounded-lg shadow-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}

          {/* Views — fade transition on switch, ErrorBoundary + Suspense for lazy loads */}
          <div key={viewMode} className={`flex-1 flex min-h-0 ${viewDirection === 'right' ? 'animate-slide-in-right' : viewDirection === 'left' ? 'animate-slide-in-left' : 'animate-scale-in'}`}>
            <Suspense fallback={<LazyFallback />}>
              {isWorkspaceView && viewMode === 'workspace' && <ErrorBoundary name="Workspace"><Workspace /></ErrorBoundary>}
              {isWorkspaceView && viewMode === 'cross-doc-graph' && <ErrorBoundary name="Doc Graph"><CrossDocGraph /></ErrorBoundary>}
              {isWorkspaceView && viewMode === 'correlation' && <ErrorBoundary name="Correlations"><CorrelationView /></ErrorBoundary>}
              {isWorkspaceView && viewMode === 'similarity-map' && <ErrorBoundary name="Similarity Map"><SimilarityMap /></ErrorBoundary>}
              {isWorkspaceView && viewMode === 'collection' && <ErrorBoundary name="Collection"><CollectionReader /></ErrorBoundary>}

              {!isWorkspaceView && markdown && (
                <>
                  {viewMode === 'read' && <ErrorBoundary name="Reader"><Reader /></ErrorBoundary>}
                  {viewMode === 'mindmap' && <ErrorBoundary name="Mind Map"><MindMapView /></ErrorBoundary>}
                  {viewMode === 'summary-cards' && <ErrorBoundary name="Summary Cards"><SummaryCardsView /></ErrorBoundary>}
                  {viewMode === 'treemap' && <ErrorBoundary name="Treemap"><TreemapView /></ErrorBoundary>}
                  {viewMode === 'knowledge-graph' && <ErrorBoundary name="Knowledge Graph"><KnowledgeGraphView /></ErrorBoundary>}
                  {viewMode === 'coach' && <ErrorBoundary name="Coach"><CoachView /></ErrorBoundary>}
                  {viewMode === 'podcast' && <ErrorBoundary name="Podcast"><PodcastPlayer /></ErrorBoundary>}
                  {viewMode === 'diagram' && (
                    <ErrorBoundary name="Diagram">
                      <Suspense fallback={<LazyFallback />}>
                        <DiagramGenerator />
                      </Suspense>
                    </ErrorBoundary>
                  )}
                </>
              )}
            </Suspense>
          </div>

          {/* Chat panel (resizable, collapsible) */}
          {showChat && (
            <>
              <ResizeHandle onResize={handleChatResize} />
              <aside
                className="shrink-0 max-w-[100vw] border-l border-gray-200 dark:border-gray-800 sepia:border-sepia-200 bg-white dark:bg-gray-900 sepia:bg-sepia-50"
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

          {/* Comments panel (slide-out sidebar) */}
          {showComments && !showChat && (
            <>
              <ResizeHandle onResize={handleChatResize} />
              <aside
                className="shrink-0 max-w-[100vw] border-l border-gray-200 dark:border-gray-800 sepia:border-sepia-200 bg-white dark:bg-gray-900 sepia:bg-sepia-50"
                style={{ width: chatWidth }}
              >
                <Suspense fallback={<LazyFallback />}>
                  <ErrorBoundary name="Comments">
                    <CommentsPanel onClose={() => setCommentsOpen(false)} />
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

      {/* Unified FAB with expandable menu */}
      {markdown && !isWorkspaceView && (
        <div className="fixed bottom-6 right-6 z-20 flex flex-col items-center gap-2">
          {/* Mini menu items — slide up when open */}
          <div className={`flex flex-col items-center gap-2 transition-all duration-200 ${fabMenuOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
            {/* TTS */}
            <button
              onClick={() => { setFabMenuOpen(false); document.querySelector<HTMLButtonElement>('[data-tts-player]')?.click() }}
              className="p-2.5 rounded-full bg-emerald-600 text-white shadow-md hover:bg-emerald-700 hover:scale-110 transition-all"
              title="Read Aloud (TTS)"
            >
              <Volume2 className="h-4 w-4" />
            </button>
            {/* Comments */}
            <button
              onClick={() => { setFabMenuOpen(false); setCommentsOpen(!commentsOpen); if (!commentsOpen) setChatOpen(false) }}
              className={`p-2.5 rounded-full shadow-md hover:scale-110 transition-all relative ${
                commentsOpen ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300' : 'bg-teal-600 text-white hover:bg-teal-700'
              }`}
              title={commentsOpen ? 'Close comments' : 'View comments'}
            >
              <MessageSquareText className="h-4 w-4" />
            </button>
            {/* Chat */}
            <button
              onClick={() => { setFabMenuOpen(false); setChatOpen(!chatOpen); if (!chatOpen) setCommentsOpen(false) }}
              className={`p-2.5 rounded-full shadow-md hover:scale-110 transition-all ${
                chatOpen ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300' : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
              title={chatOpen ? 'Close chat' : 'Chat with document'}
            >
              <MessageSquare className="h-4 w-4" />
            </button>
          </div>

          {/* Main FAB */}
          <button
            data-chat-fab
            onClick={() => setFabMenuOpen(!fabMenuOpen)}
            className={`p-3.5 rounded-full shadow-lg transition-all focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none relative ${
              fabMenuOpen
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rotate-0'
                : 'bg-blue-600 text-white hover:bg-blue-700 animate-pulse-once hover:scale-110'
            }`}
            title={fabMenuOpen ? 'Close menu (Esc)' : 'Tools menu'}
          >
            {fabMenuOpen ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
            {!fabMenuOpen && commentCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-white text-blue-600 text-[10px] font-bold min-w-[1.1rem] h-[1.1rem] px-0.5 rounded-full flex items-center justify-center shadow-sm">
                {commentCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Mobile TOC hamburger button (visible < 768px only) */}
      {markdown && (viewMode === 'read' || viewMode === 'coach') && (
        <button
          onClick={() => setMobileTocOpen(!mobileTocOpen)}
          className="mobile-toc-hamburger fixed top-2 left-2 z-30 p-2 bg-white dark:bg-gray-800 sepia:bg-sepia-50 border border-gray-200 dark:border-gray-700 sepia:border-sepia-200 rounded-lg shadow-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          title="Table of Contents"
        >
          <Menu className="h-4 w-4" />
        </button>
      )}

      {/* Mobile TOC slide-in panel */}
      {mobileTocOpen && (
        <div className="mobile-toc-panel fixed inset-0 z-40" onClick={() => setMobileTocOpen(false)}>
          <div
            className="absolute left-0 top-0 h-full w-72 bg-white dark:bg-gray-900 sepia:bg-sepia-50 border-r border-gray-200 dark:border-gray-800 sepia:border-sepia-200 p-4 overflow-y-auto shadow-xl animate-slide-in-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-bold text-gray-700 dark:text-gray-200 sepia:text-sepia-800">Table of Contents</span>
              <button onClick={() => setMobileTocOpen(false)} className="p-1 text-gray-400 hover:text-gray-600">&times;</button>
            </div>
            <TableOfContents />
          </div>
          <div className="absolute inset-0 bg-black/30" />
        </div>
      )}

      {/* Onboarding overlay for first-time users */}
      {showOnboarding && <OnboardingOverlay onComplete={() => setShowOnboarding(false)} />}

      {/* Offline indicator */}
      {isOffline && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white text-xs text-center py-1 font-medium">
          You're offline — AI features are unavailable
        </div>
      )}

      {/* Telemetry opt-in banner (shows once) */}
      <TelemetryBanner />
    </div>
  )
}

export default App
