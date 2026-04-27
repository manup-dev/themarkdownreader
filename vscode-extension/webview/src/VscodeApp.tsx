import { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { Loader2, PanelLeftClose, PanelLeftOpen, MessageSquare, Sun, Moon, BookOpen, Contrast, BookText, GitBranch, LayoutGrid, TreePine, Share2, GraduationCap, Maximize2, Minimize2, X, Sparkles } from 'lucide-react'
import { useStore } from '@app/store/useStore'
import { Reader } from '@app/components/Reader'
import { OutlinePanel } from '@app/components/OutlinePanel'
import { TtsPlayer } from '@app/components/TtsPlayer'
import { ResizeHandle } from '@app/components/ResizeHandle'
import { KeyboardShortcuts } from '@app/components/KeyboardShortcuts'
import { ErrorBoundary } from '@app/components/ErrorBoundary'
import { SelectionMenu } from '@app/components/SelectionMenu'
import { getVsCodeApi } from './vscodeApi'
import type { ViewMode, Theme } from '@app/store/useStore'

const MindMapView = lazy(() => import('@app/components/MindMap').then((m) => ({ default: m.MindMapView })))
const SummaryCardsView = lazy(() => import('@app/components/SummaryCards').then((m) => ({ default: m.SummaryCardsView })))
const TreemapView = lazy(() => import('@app/components/TreemapView').then((m) => ({ default: m.TreemapView })))
const KnowledgeGraphView = lazy(() => import('@app/components/KnowledgeGraph').then((m) => ({ default: m.KnowledgeGraphView })))
const CoachView = lazy(() => import('@app/components/Coach').then((m) => ({ default: m.CoachView })))
const CommentsPanel = lazy(() => import('@app/components/CommentsPanel').then((m) => ({ default: m.CommentsPanel })))

function LazyFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
    </div>
  )
}

const viewModes: { value: ViewMode; label: string; icon: typeof BookText }[] = [
  { value: 'read', label: 'Read', icon: BookText },
  { value: 'mindmap', label: 'Mind Map', icon: GitBranch },
  { value: 'summary-cards', label: 'Cards', icon: LayoutGrid },
  { value: 'treemap', label: 'Treemap', icon: TreePine },
  { value: 'knowledge-graph', label: 'Graph', icon: Share2 },
  { value: 'coach', label: 'Coach', icon: GraduationCap },
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
  const fileName = useStore((s) => s.fileName)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentsExpanded, setCommentsExpanded] = useState(false)
  const [commentsWidth, setCommentsWidth] = useState(() => {
    if (typeof window === 'undefined') return 360
    const saved = window.localStorage?.getItem('md-reader-vscode-sidekick-width')
    const parsed = saved ? parseInt(saved, 10) : NaN
    return Number.isFinite(parsed) ? Math.max(280, Math.min(720, parsed)) : 360
  })
  const [aiActionResult, setAiActionResult] = useState<{ action: string; text: string; result?: string } | null>(null)
  const lastScrollSectionRef = useRef<string>('')
  const [ttsAutoPlay, setTtsAutoPlay] = useState(false)

  // Apply theme before paint to prevent code block flash
  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark', 'sepia', 'high-contrast')
    if (theme === 'dark' || theme === 'high-contrast') root.classList.add('dark')
    if (theme === 'sepia') root.classList.add('sepia')
    if (theme === 'high-contrast') root.classList.add('high-contrast')
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
        case 'toggleTheme': {
          const cycle: Theme[] = ['light', 'dark', 'sepia', 'high-contrast']
          const currentTheme = useStore.getState().theme
          const idx = cycle.indexOf(currentTheme)
          setTheme(cycle[(idx + 1) % cycle.length])
          break
        }
        case 'toggleFocusMode':
          document.documentElement.classList.toggle('focus-mode')
          break
        case 'setFontSize':
          if (typeof msg.size === 'number') setFontSize(msg.size)
          break
        case 'toggleToc':
          setSidebarOpen((prev) => !prev)
          break
        case 'readAloud':
          setTtsAutoPlay(true)
          break
        // Feature 6: AI action on selected text (summarize/explain)
        case 'aiAction': {
          const action = msg.action as string
          const text = msg.text as string
          setAiActionResult({ action, text })
          // Show the text in an overlay — the AI processing would happen
          // via the existing AI infrastructure if available
          const vscodeApi = getVsCodeApi()
          vscodeApi?.postMessage({
            type: 'info',
            text: `${action === 'summarize' ? 'Summarizing' : 'Explaining'} selection (${text.length} chars)...`,
          })
          break
        }
        // Feature 6: Read selected text aloud
        case 'readAloudText': {
          const textToRead = msg.text as string
          if (textToRead && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel()
            const utterance = new SpeechSynthesisUtterance(textToRead)
            utterance.rate = 1.0
            utterance.pitch = 1.0
            utterance.onerror = (e) => {
              console.warn('TTS error:', e.error)
              const vscodeApi = getVsCodeApi()
              vscodeApi?.postMessage({ type: 'info', text: `TTS failed: ${e.error || 'unknown error'}` })
            }
            window.speechSynthesis.speak(utterance)
          }
          break
        }
        // Feature 9: Copy reader content as rich text
        case 'copyRichText': {
          const article = document.querySelector('article') || document.querySelector('.prose')
          if (article) {
            const htmlContent = article.innerHTML
            const plainText = article.textContent || ''
            try {
              const blob = new Blob([htmlContent], { type: 'text/html' })
              const textBlob = new Blob([plainText], { type: 'text/plain' })
              navigator.clipboard.write([
                new ClipboardItem({
                  'text/html': blob,
                  'text/plain': textBlob,
                }),
              ]).then(() => {
                const vscodeApi = getVsCodeApi()
                vscodeApi?.postMessage({ type: 'info', text: 'Copied reader content as rich text' })
              }).catch(() => {
                // Fallback: use execCommand
                const selection = window.getSelection()
                const range = document.createRange()
                range.selectNodeContents(article)
                selection?.removeAllRanges()
                selection?.addRange(range)
                document.execCommand('copy')
                selection?.removeAllRanges()
                const vscodeApi = getVsCodeApi()
                vscodeApi?.postMessage({ type: 'info', text: 'Copied reader content as rich text' })
              })
            } catch {
              // Fallback for environments without ClipboardItem
              const selection = window.getSelection()
              const range = document.createRange()
              range.selectNodeContents(article)
              selection?.removeAllRanges()
              selection?.addRange(range)
              document.execCommand('copy')
              selection?.removeAllRanges()
              const vscodeApi = getVsCodeApi()
              vscodeApi?.postMessage({ type: 'info', text: 'Copied reader content as rich text' })
            }
          }
          break
        }
        case 'sendToTerminal': {
          // Forward to extension host
          const vscApi = getVsCodeApi()
          vscApi?.postMessage({ type: 'sendToTerminal', text: msg.text })
          break
        }
        case 'scrollToSection': {
          const sectionId = msg.sectionId as string
          // Avoid re-scrolling to the same section repeatedly
          if (sectionId && sectionId !== lastScrollSectionRef.current) {
            lastScrollSectionRef.current = sectionId
            const el = document.getElementById(sectionId)
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          }
          break
        }
      }
    }

    window.addEventListener('message', handleMessage)

    // Tell extension host we're ready
    const vscode = getVsCodeApi()
    vscode?.postMessage({ type: 'ready' })

    return () => window.removeEventListener('message', handleMessage)
  }, [setMarkdown, setTheme, setFontSize, setViewMode])

  // Feature 3: Send reading progress to extension host
  useEffect(() => {
    if (!markdown) return

    const vscode = getVsCodeApi()
    if (!vscode) return

    const totalWords = markdown.split(/\s+/).filter(Boolean).length
    const totalMinutes = Math.max(1, Math.ceil(totalWords / 230))

    let throttleTimer: ReturnType<typeof setTimeout> | null = null
    const handleScroll = () => {
      if (throttleTimer) return
      throttleTimer = setTimeout(() => {
        throttleTimer = null
        const scrollTop = document.documentElement.scrollTop || document.body.scrollTop
        const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight
        if (scrollHeight <= 0) return

        const percent = Math.min(100, Math.round((scrollTop / scrollHeight) * 100))
        const minutesLeft = Math.max(0, Math.round(totalMinutes * (1 - percent / 100)))

        vscode.postMessage({ type: 'progress', percent, minutesLeft, totalWords, fileName: fileName ?? undefined })
      }, 200)
    }

    // Send initial progress
    handleScroll()

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (throttleTimer) clearTimeout(throttleTimer)
    }
  }, [markdown, fileName])

  // Auto-dismiss AI action overlay after 8 seconds
  useEffect(() => {
    if (!aiActionResult) return
    const timer = setTimeout(() => setAiActionResult(null), 8000)
    return () => clearTimeout(timer)
  }, [aiActionResult])

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth(Math.max(150, Math.min(350, sidebarWidth + delta)))
  }, [sidebarWidth, setSidebarWidth])

  // Sidekick (right) panel resize: drag handle is on its LEFT edge, so a
  // negative delta (dragging left) should grow the panel.
  const handleCommentsResize = useCallback((delta: number) => {
    if (commentsExpanded) return
    setCommentsWidth((w) => {
      const next = Math.max(280, Math.min(720, w - delta))
      try { window.localStorage?.setItem('md-reader-vscode-sidekick-width', String(next)) } catch { /* localStorage may be blocked */ }
      return next
    })
  }, [commentsExpanded])

  const effectiveCommentsWidth = useMemo(() => {
    if (!commentsExpanded) return commentsWidth
    if (typeof window === 'undefined') return 720
    return Math.max(720, Math.min(960, Math.round(window.innerWidth * 0.55)))
  }, [commentsExpanded, commentsWidth])

  const themeClasses: Record<Theme, string> = { light: 'bg-gray-50', dark: 'bg-gray-950', sepia: 'bg-sepia-100', 'high-contrast': 'bg-black' }
  const showSidebar = sidebarOpen && markdown && viewMode === 'read'

  if (!markdown) {
    return (
      <div className={`vscode-webview md-reader-empty-gradient flex items-center justify-center h-screen ${themeClasses[theme]}`}>
        <div className="text-center space-y-4 max-w-sm px-6">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <BookText className="h-8 w-8 text-white" strokeWidth={2.25} />
          </div>
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight text-gray-800 dark:text-gray-100">md-reader</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              A calm, focused reading experience for markdown.
            </p>
          </div>
          <div className="pt-2 flex flex-col items-center gap-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">Open any <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300">.md</code> file, then press</p>
            <div className="flex items-center gap-1.5">
              <span className="md-reader-kbd">Ctrl</span>
              <span className="text-gray-400 text-xs">+</span>
              <span className="md-reader-kbd">Shift</span>
              <span className="text-gray-400 text-xs">+</span>
              <span className="md-reader-kbd">R</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
  <>
    <div className={`vscode-webview flex h-screen ${themeClasses[theme]}`}>
      <KeyboardShortcuts />

      {/* Sidebar */}
      {showSidebar && (
        <>
          <aside
            className="shrink-0 border-r border-gray-200 dark:border-gray-800 sepia:border-sepia-200 bg-white dark:bg-gray-900 sepia:bg-sepia-50 overflow-y-auto"
            style={{ width: sidebarWidth }}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 border-b border-gray-200/70 dark:border-gray-800/70 bg-white/90 dark:bg-gray-900/90 sepia:bg-sepia-50/90 backdrop-blur-sm">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400">Outline</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                title="Hide outline"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="pb-3">
              <OutlinePanel maxLevel={6} />
            </div>
          </aside>
          <ResizeHandle onResize={handleSidebarResize} />
        </>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* View tabs */}
        <div className="md-reader-toolbar flex items-center gap-1 px-3 py-2 border-b border-gray-200 dark:border-gray-800 sepia:border-sepia-200 bg-white/80 dark:bg-gray-900/80 sepia:bg-sepia-50/80">
          {!showSidebar && viewMode === 'read' && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-md text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors mr-1"
              title="Show outline"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-gray-100/60 dark:bg-gray-800/40 sepia:bg-sepia-200/50">
            {viewModes.map((vm) => {
              const Icon = vm.icon
              const isActive = viewMode === vm.value
              return (
                <button
                  key={vm.value}
                  onClick={() => setViewMode(vm.value)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all ${
                    isActive
                      ? 'md-reader-tab-active'
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-white/70 dark:hover:bg-gray-700/60'
                  }`}
                  title={vm.label}
                  aria-pressed={isActive}
                >
                  <Icon className="h-[15px] w-[15px]" strokeWidth={isActive ? 2.4 : 2} />
                  <span className="hidden md:inline">{vm.label}</span>
                </button>
              )
            })}
          </div>
          <div className="flex-1" />
          {/* Theme toggle */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-gray-100/60 dark:bg-gray-800/40 sepia:bg-sepia-200/50 mr-1">
            <button
              onClick={() => setTheme('light')}
              className={`p-1.5 rounded-md transition-all ${theme === 'light' ? 'bg-amber-100 text-amber-700 shadow-sm' : 'text-gray-500 hover:text-amber-600 dark:text-gray-400 dark:hover:text-amber-300 hover:bg-white/70 dark:hover:bg-gray-700/60'}`}
              title="Light theme"
              aria-pressed={theme === 'light'}
            >
              <Sun className="h-[15px] w-[15px]" />
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={`p-1.5 rounded-md transition-all ${theme === 'dark' ? 'bg-indigo-500/20 text-indigo-200 shadow-sm ring-1 ring-indigo-400/30' : 'text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-300 hover:bg-white/70 dark:hover:bg-gray-700/60'}`}
              title="Dark theme"
              aria-pressed={theme === 'dark'}
            >
              <Moon className="h-[15px] w-[15px]" />
            </button>
            <button
              onClick={() => setTheme('sepia')}
              className={`p-1.5 rounded-md transition-all ${theme === 'sepia' ? 'bg-amber-200/60 text-amber-900 shadow-sm' : 'text-gray-500 hover:text-amber-700 dark:text-gray-400 dark:hover:text-amber-300 hover:bg-white/70 dark:hover:bg-gray-700/60'}`}
              title="Sepia theme"
              aria-pressed={theme === 'sepia'}
            >
              <BookOpen className="h-[15px] w-[15px]" />
            </button>
            <button
              onClick={() => setTheme('high-contrast')}
              className={`p-1.5 rounded-md transition-all ${theme === 'high-contrast' ? 'bg-gray-900 text-yellow-300 shadow-sm ring-1 ring-yellow-400/30' : 'text-gray-500 hover:text-yellow-600 dark:text-gray-400 dark:hover:text-yellow-300 hover:bg-white/70 dark:hover:bg-gray-700/60'}`}
              title="High Contrast theme"
              aria-pressed={theme === 'high-contrast'}
            >
              <Contrast className="h-[15px] w-[15px]" />
            </button>
          </div>
          <button
            onClick={() => setCommentsOpen(!commentsOpen)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all ${
              commentsOpen
                ? 'md-reader-sidekick-toggle-active'
                : 'text-gray-600 dark:text-gray-300 hover:text-teal-700 dark:hover:text-teal-200 hover:bg-gray-100 dark:hover:bg-gray-800 ring-1 ring-transparent hover:ring-teal-400/20'
            }`}
            title="Toggle Sidekick (notes, comments, prompt builder)"
            aria-pressed={commentsOpen}
          >
            <MessageSquare className="h-[15px] w-[15px]" strokeWidth={commentsOpen ? 2.4 : 2} />
            <span className="hidden md:inline">Sidekick</span>
          </button>
        </div>

        {/* Content */}
        <Suspense fallback={<LazyFallback />}>
          {viewMode === 'read' && <Reader />}
          {viewMode === 'mindmap' && <ErrorBoundary name="Mind Map"><MindMapView /></ErrorBoundary>}
          {viewMode === 'summary-cards' && <ErrorBoundary name="Cards"><SummaryCardsView /></ErrorBoundary>}
          {viewMode === 'treemap' && <ErrorBoundary name="Treemap"><TreemapView /></ErrorBoundary>}
          {viewMode === 'knowledge-graph' && <ErrorBoundary name="Graph"><KnowledgeGraphView /></ErrorBoundary>}
          {viewMode === 'coach' && <ErrorBoundary name="Coach"><CoachView /></ErrorBoundary>}
        </Suspense>
      </div>

      {/* Sidekick dashboard (Comments + Prompt Builder) */}
      {commentsOpen && (
        <>
          <ResizeHandle onResize={handleCommentsResize} />
          <aside
            className="md-reader-sidekick shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col"
            style={{
              width: effectiveCommentsWidth,
              transition: commentsExpanded ? 'width 220ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
            }}
            aria-label="Notes and AI sidekick"
          >
            {/* Dashboard header */}
            <div className="md-reader-sidekick-header flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-800 sepia:border-sepia-200 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="md-reader-sidekick-badge w-7 h-7 rounded-md flex items-center justify-center shrink-0">
                  <Sparkles className="h-[15px] w-[15px] text-white" strokeWidth={2.4} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[13px] font-semibold tracking-tight text-gray-800 dark:text-gray-100 leading-tight truncate">
                    Sidekick
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400 leading-tight">
                    Notes · Prompts
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => setCommentsExpanded((v) => !v)}
                  className="p-1.5 rounded-md text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  title={commentsExpanded ? 'Restore' : 'Maximize'}
                  aria-pressed={commentsExpanded}
                  aria-label={commentsExpanded ? 'Restore sidekick' : 'Maximize sidekick'}
                >
                  {commentsExpanded ? <Minimize2 className="h-[14px] w-[14px]" /> : <Maximize2 className="h-[14px] w-[14px]" />}
                </button>
                <button
                  onClick={() => { setCommentsOpen(false); setCommentsExpanded(false) }}
                  className="p-1.5 rounded-md text-gray-500 hover:text-rose-600 dark:text-gray-400 dark:hover:text-rose-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  title="Close"
                  aria-label="Close sidekick"
                >
                  <X className="h-[14px] w-[14px]" />
                </button>
              </div>
            </div>
            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <Suspense fallback={<LazyFallback />}>
                <ErrorBoundary name="Comments">
                  <CommentsPanel onClose={() => { setCommentsOpen(false); setCommentsExpanded(false) }} />
                </ErrorBoundary>
              </Suspense>
            </div>
          </aside>
        </>
      )}

      {/* Selection menu (highlight, AI explain, comment, copy) */}
      {markdown && viewMode === 'read' && <SelectionMenu />}
    </div>

    {/* Render fixed-position elements outside .vscode-webview so they aren't hidden */}
    <TtsPlayer autoPlay={ttsAutoPlay} onAutoPlayConsumed={() => setTtsAutoPlay(false)} />

    {aiActionResult && (
      <div className="fixed bottom-4 right-4 max-w-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-4 z-50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
            {aiActionResult.action === 'summarize' ? 'Summary' : 'Explanation'}
          </span>
          <button
            onClick={() => setAiActionResult(null)}
            className="text-gray-400 hover:text-gray-600 text-sm"
          >
            Close
          </button>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-6">
          {aiActionResult.text.slice(0, 300)}{aiActionResult.text.length > 300 ? '...' : ''}
        </p>
      </div>
    )}
  </>
  )
}
