import { useEffect, useLayoutEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import { MessageSquare, MessageSquareText, PanelLeftOpen, Loader2, Menu, Volume2, X } from 'lucide-react'
import { useStore, type ViewMode } from './store/useStore'
import { useAdapter } from './provider/hooks'
import { SAMPLE_MARKDOWN } from './lib/sample-doc'
import { extractToc } from './lib/markdown'
import { Upload } from './components/Upload'
import { Reader } from './components/Reader'
import { Toolbar } from './components/Toolbar'
import { OutlinePanel } from './components/OutlinePanel'
import { TtsPlayer } from './components/TtsPlayer'
import { SelectionMenu } from './components/SelectionMenu'
import { SearchOverlay } from './components/SearchOverlay'
import { ResizeHandle } from './components/ResizeHandle'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OnboardingOverlay } from './components/OnboardingOverlay'
import { TelemetryBanner } from './components/TelemetryBanner'
import { Sidebar } from './components/Sidebar'
import { FEATURE_FLAGS, resolveEnabledFeatures, enableFeature as enableFeatureFlag, disableFeature as disableFeatureFlag, resetFeatures } from './lib/feature-flags'
import { MdReaderProvider } from './provider'
import { DexieAdapter } from './adapters/dexie-adapter'

const dexieAdapter = new DexieAdapter()

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
const CollectionView = lazy(() => import('./components/CollectionView').then((m) => ({ default: m.CollectionView })))
const ShareDialog = lazy(() => import('./components/ShareDialog').then((m) => ({ default: m.ShareDialog })))
const RemoteBanner = lazy(() => import('./components/RemoteBanner').then((m) => ({ default: m.RemoteBanner })))
const RepoBrowser = lazy(() => import('./components/RepoBrowser').then((m) => ({ default: m.RepoBrowser })))

function LazyFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
    </div>
  )
}

function AppContent() {
  const adapter = useAdapter()
  // Track whether a state change came from popstate (back/forward) to avoid re-pushing
  const isPopStateRef = useRef(false)
  const markdown = useStore((s) => s.markdown)
  const theme = useStore((s) => s.theme)
  const viewMode = useStore((s) => s.viewMode)
  const workspaceMode = useStore((s) => s.workspaceMode)
  const folderFiles = useStore((s) => s.folderFiles)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const chatWidth = useStore((s) => s.chatWidth)
  const setChatWidth = useStore((s) => s.setChatWidth)
  // Single source of truth for sidebar visibility: store.sidebarCollapsed.
  // Toolbar's sidebar-toggle button + Ctrl+\ shortcut + the floating
  // re-open button (further down this file) all flip the same store
  // field via toggleSidebar(), avoiding the dual-state sync bug where
  // App's local sidebarOpen and Sidebar's internal sidebarCollapsed
  // could disagree.
  const sidebarOpen = !sidebarCollapsed
  const [chatOpen, setChatOpen] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentCount, setCommentCount] = useState(0)
  const [focusMode, setFocusMode] = useState(false)
  const [fabMenuOpen, setFabMenuOpen] = useState(false)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [repoBrowserHref, setRepoBrowserHref] = useState<string | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [mobileTocOpen, setMobileTocOpen] = useState(false)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const setMarkdown = useStore((s) => s.setMarkdown)
  const activeDocId = useStore((s) => s.activeDocId)
  const dyslexicFont = useStore((s) => s.dyslexicFont)

  // Unified view: hydrate folder session from cache on mount (no prompt) +
  // install the __mdReaderLoadCollection test hook (used by E2E tests).
  // Both previously lived inside CollectionReader.tsx; promoted to App level
  // as part of the 2026-04-15 unified view refactor so they survive the
  // CollectionReader deletion. The global hook keeps its original
  // (files, name) signature so existing E2E tests continue to work.
  useEffect(() => {
    useStore.getState().hydrateFolderFromCache().catch(() => {
      // Non-fatal: cache read failed, user can re-open the folder manually.
    })

    const w = window as unknown as {
      __mdReaderLoadCollection?: (
        files: Array<{ path: string; content: string }>,
        name: string,
      ) => Promise<void>
    }
    w.__mdReaderLoadCollection = async (rawFiles, name) => {
      const { saveCollectionCache } = await import('./lib/docstore')
      await saveCollectionCache(name, rawFiles, 0)
      const files = rawFiles.map((f) => ({
        path: f.path,
        name: f.path.split('/').pop() ?? f.path,
        content: f.content,
      }))
      useStore.getState().setFolderSession(null, files)
    }

    // Debug hook: expose the last backend-detection diagnostic so users
    // can check *why* a particular backend was chosen. Usage in DevTools:
    //   await window.__mdReaderDetectInfo()
    // Returns { at, preferred, ollamaHealthy, webGPUAvailable,
    //           gemmaLoadedInMemory, gemmaCacheHit, openRouterKeySet,
    //           chosenBackend, reason }. Helpful for reproducing the
    // "picked OpenRouter even though I have gemma4 cached" class of bugs.
    const wd = window as unknown as { __mdReaderDetectInfo?: () => Promise<unknown> }
    wd.__mdReaderDetectInfo = async () => {
      const ai = await import('./lib/ai')
      const info = ai.getDetectInfo()
      console.log('[md-reader] last detect info:', info)
      return info
    }

    return () => {
      delete w.__mdReaderLoadCollection
      delete wd.__mdReaderDetectInfo
    }
  }, [])

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

    // Handle share URLs: #url=<doc>[&annot=<url|base64>][&hash=…] or
    // #repo=<owner/name>&path=…. The share-loader does SSRF-guarded fetch
    // for both doc and annotation sidecar, imports the events as local
    // Dexie rows (so the existing UI renders them), and returns banner
    // data for the RemoteBanner component.
    const hasShareParams = /[#&?](url|repo)=/.test(hash)
    if (hasShareParams) {
      // Snapshot the full URL NOW. The history-syncing effect lower in this
      // file will rewrite the hash to `#<viewMode>` before the dynamic
      // import resolves, so the loader needs the URL up-front rather than
      // reading window.location.href at call time.
      const capturedHref = window.location.href
      // Folder shares (github-repo with non-.md path) render a browser
      // pane; single-doc shares (url-pair, inline, or repo+single .md)
      // hand off to the share-loader for fetch + import. Detect the folder
      // shape here to skip share-loader's null-return for folders.
      const isFolderShare = /[#&?]repo=/.test(hash) && !/path=[^&]*\.md(?:&|$)/.test(hash)
      if (isFolderShare) {
        // Clear any persisted doc so the browser pane (gated on !markdown)
        // actually renders. Also clear remoteShare since this isn't a doc.
        useStore.getState().setMarkdown('')
        useStore.getState().setRemoteShare(null)
        setRepoBrowserHref(capturedHref)
        return
      }
      import('./lib/share-loader').then(async ({ loadShareFromHash }) => {
        try {
          const result = await loadShareFromHash({ href: capturedHref })
          if (!result) return
          // setActiveDocId so downstream consumers (CommentsPanel, highlight
          // rendering, analysis lookups) query the right Dexie row. Must
          // fire before setMarkdown — setMarkdown resets viewMode to 'read'
          // which some effects key off, and those effects read activeDocId.
          useStore.getState().setActiveDocId(result.docId)
          setMarkdown(result.markdown, result.fileName)
          useStore.getState().setRemoteShare(result.banner)
        } catch (err) {
          console.error('md-reader: Failed to load share URL:', err)
        }
      })
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
      adapter.getCommentCount(activeDocId).then((c) => { if (!cancelled) setCommentCount(c) })
    }
    fetchCount()
    const interval = setInterval(fetchCount, 3000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [activeDocId])

  // Keyboard shortcuts: Escape closes chat/focus, Ctrl+Shift+F toggles focus mode,
  // Cmd/Ctrl+\ toggles the sidebar.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setChatOpen(false); setCommentsOpen(false); setFocusMode(false); setFabMenuOpen(false) }
      if (e.ctrlKey && e.shiftKey && e.key === 'F') { e.preventDefault(); setFocusMode((f) => !f) }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
        e.preventDefault()
        setShareDialogOpen((o) => !o)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return
        }
        e.preventDefault()
        useStore.getState().toggleSidebar()
      }
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

  // Feature flags: expose console API on window.mdReader
  useEffect(() => {
    const refreshStore = () => useStore.getState().refreshFeatureFlags()

    const api = {
      enableFeature(id: string) {
        const known = FEATURE_FLAGS.find(f => f.id === id)
        if (!known) { console.warn(`Unknown feature: "${id}". Run mdReader.listFeatures() to see available flags.`); return }
        enableFeatureFlag(id)
        refreshStore()
        console.log(`Enabled "${known.label}". Refresh not needed — UI updated.`)
      },
      disableFeature(id: string) {
        const known = FEATURE_FLAGS.find(f => f.id === id)
        if (!known) { console.warn(`Unknown feature: "${id}".`); return }
        disableFeatureFlag(id)
        refreshStore()
        console.log(`Disabled "${known.label}".`)
      },
      listFeatures() {
        const enabled = resolveEnabledFeatures()
        console.table(FEATURE_FLAGS.map(f => ({
          id: f.id,
          label: f.label,
          enabled: enabled.has(f.id),
          description: f.description,
        })))
      },
      resetFeatures() {
        resetFeatures()
        refreshStore()
        console.log('All feature flag overrides cleared.')
      },
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).mdReader = { ...(window as any).mdReader, ...api }
  }, [])

  // Use getState() to avoid stale closures during rapid dragging
  const handleChatResize = useCallback((delta: number) => {
    const cur = useStore.getState().chatWidth
    setChatWidth(Math.max(250, Math.min(600, cur - delta)))
  }, [setChatWidth])

  // Repo browser takes precedence — when a folder share URL landed, the
  // user should see the folder listing regardless of any persisted doc
  // state (Zustand persist hydrates asynchronously and would otherwise
  // restore a previous markdown after we clear it).
  if (repoBrowserHref) {
    return (
      <Suspense fallback={<LazyFallback />}>
        <RepoBrowser
          href={repoBrowserHref}
          onOpenFile={(url) => { setRepoBrowserHref(null); window.location.href = url }}
          onOpenFolder={(url) => { setRepoBrowserHref(url) }}
        />
      </Suspense>
    )
  }

  if (!markdown && !workspaceMode && !folderFiles) {
    return <Upload />
  }

  const themeClasses: Record<string, string> = { light: 'bg-gray-50', dark: 'bg-gray-950', sepia: 'bg-sepia-100', 'high-contrast': 'bg-black' }
  // Library-level modes render full-width without the unified sidebar.
  const isLibraryView = viewMode === 'workspace' || viewMode === 'cross-doc-graph' || viewMode === 'correlation' || viewMode === 'similarity-map'
  // Modes that participate in the unified shell (Sidebar + main pane).
  const isUnifiedShellView = !isLibraryView
  // Legacy flag: true for any non-reading (library OR collection) view — used
  // by chat/comments/TTS/FAB guards to match previous behavior.
  const isWorkspaceView = isLibraryView || viewMode === 'collection'
  const hasDocState = !!markdown || !!folderFiles
  const showSidebar = sidebarOpen && hasDocState && isUnifiedShellView
  const showChat = chatOpen && markdown && !isWorkspaceView
  const showComments = commentsOpen && markdown && !isWorkspaceView
  const showTts = !!markdown && !isWorkspaceView

  return (
    <div className={`flex h-screen ${themeClasses[theme]} ${focusMode ? 'focus-mode' : ''} ${dyslexicFont ? 'font-dyslexic' : ''}`}>
      <a href="#main-content" className="skip-to-content">Skip to content</a>
      <KeyboardShortcuts />

      {/* Unified sidebar: rendered by <Sidebar> (OutlinePanel for single-file,
          FileExplorer for folder mode). The component manages its own chrome
          and internally honors store.sidebarCollapsed. */}
      {showSidebar && <ErrorBoundary name="Sidebar"><Sidebar /></ErrorBoundary>}

      {/* Main content */}
      <div id="main-content" className="flex-1 flex flex-col min-w-0" role="main">
        <Toolbar />
        <Suspense fallback={null}>
          <RemoteBanner />
        </Suspense>
        <div className="flex-1 flex min-h-0">
          {/* Sidebar toggle — visible in any unified-shell view so users
              can re-open the sidebar regardless of which reading tab they
              were on when they toggled focus mode. Previously gated on
              read/coach only, which stranded users in mindmap/treemap/
              podcast/diagram/collection. */}
          {!showSidebar && isUnifiedShellView && hasDocState && (
            <button
              onClick={toggleSidebar}
              aria-label="Show sidebar"
              title="Show sidebar (Ctrl+\\)"
              className="absolute top-24 left-2 z-10 p-1.5 bg-white dark:bg-gray-800 sepia:bg-sepia-50 border border-gray-200 dark:border-gray-700 sepia:border-sepia-200 rounded-lg shadow-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}

          {/* Views — fade transition on switch, ErrorBoundary + Suspense for lazy loads */}
          <div key={viewMode} className={`flex-1 flex min-h-0 ${viewDirection === 'right' ? 'animate-slide-in-right' : viewDirection === 'left' ? 'animate-slide-in-left' : 'animate-scale-in'}`}>
            <Suspense fallback={<LazyFallback />}>
              {/* Library + cross-doc modes render full-width, no unified sidebar */}
              {viewMode === 'workspace' && <ErrorBoundary name="Workspace"><Workspace /></ErrorBoundary>}
              {viewMode === 'cross-doc-graph' && <ErrorBoundary name="Doc Graph"><CrossDocGraph /></ErrorBoundary>}
              {viewMode === 'correlation' && <ErrorBoundary name="Correlations"><CorrelationView /></ErrorBoundary>}
              {viewMode === 'similarity-map' && <ErrorBoundary name="Similarity Map"><SimilarityMap /></ErrorBoundary>}

              {/* Collection tab: folder dashboard (part of unified reading shell) */}
              {viewMode === 'collection' && <ErrorBoundary name="Collection"><CollectionView /></ErrorBoundary>}

              {/* Reading modes (single-file OR active file within a folder) */}
              {viewMode !== 'workspace' && viewMode !== 'cross-doc-graph' && viewMode !== 'correlation' && viewMode !== 'similarity-map' && viewMode !== 'collection' && markdown && (
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
            <OutlinePanel maxLevel={6} />
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

      {/* Share dialog — opened via Ctrl+Shift+S keyboard shortcut. Lazy-
          mounted so the first open pays the cost; keeps first paint lean. */}
      <Suspense fallback={null}>
        {shareDialogOpen && (
          <ShareDialog
            open={shareDialogOpen}
            onClose={() => setShareDialogOpen(false)}
          />
        )}
      </Suspense>
    </div>
  )
}

export default function App() {
  return (
    <MdReaderProvider adapter={dexieAdapter}>
      <AppContent />
    </MdReaderProvider>
  )
}
