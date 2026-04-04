import { useEffect, useLayoutEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import { Loader2, PanelLeftClose, PanelLeftOpen, MessageSquare, Sun, Moon, BookOpen, Contrast } from 'lucide-react'
import { useStore } from '@app/store/useStore'
import { Reader } from '@app/components/Reader'
import { TableOfContents } from '@app/components/TableOfContents'
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

const viewModes: { value: ViewMode; label: string }[] = [
  { value: 'read', label: 'Read' },
  { value: 'mindmap', label: 'Mind Map' },
  { value: 'summary-cards', label: 'Cards' },
  { value: 'treemap', label: 'Treemap' },
  { value: 'knowledge-graph', label: 'Graph' },
  { value: 'coach', label: 'Coach' },
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
  const [aiActionResult, setAiActionResult] = useState<{ action: string; text: string; result?: string } | null>(null)
  const lastScrollSectionRef = useRef<string>('')

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
          const idx = cycle.indexOf(theme)
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
          // TTS will be handled by the TtsPlayer component
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

  const themeClasses: Record<Theme, string> = { light: 'bg-gray-50', dark: 'bg-gray-950', sepia: 'bg-sepia-100', 'high-contrast': 'bg-black' }
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
          <div className="flex-1" />
          {/* Theme toggle */}
          <div className="flex items-center gap-0.5 mr-1">
            <button
              onClick={() => setTheme('light')}
              className={`p-1 rounded transition-colors ${theme === 'light' ? 'bg-amber-100 text-amber-700' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
              title="Light theme"
            >
              <Sun className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={`p-1 rounded transition-colors ${theme === 'dark' ? 'bg-blue-950/50 text-blue-300' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
              title="Dark theme"
            >
              <Moon className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setTheme('sepia')}
              className={`p-1 rounded transition-colors ${theme === 'sepia' ? 'bg-amber-100 text-amber-800' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
              title="Sepia theme"
            >
              <BookOpen className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setTheme('high-contrast')}
              className={`p-1 rounded transition-colors ${theme === 'high-contrast' ? 'bg-gray-800 text-yellow-300' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
              title="High Contrast theme"
            >
              <Contrast className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            onClick={() => setCommentsOpen(!commentsOpen)}
            className={`p-1 rounded text-xs transition-colors ${
              commentsOpen
                ? 'bg-teal-100 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300'
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
            }`}
            title="Comments & Prompt Builder"
          >
            <MessageSquare className="h-3.5 w-3.5" />
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

      {/* Comments panel */}
      {commentsOpen && (
        <aside className="shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto" style={{ width: 300 }}>
          <Suspense fallback={<LazyFallback />}>
            <ErrorBoundary name="Comments">
              <CommentsPanel onClose={() => setCommentsOpen(false)} />
            </ErrorBoundary>
          </Suspense>
        </aside>
      )}

      {/* Selection menu (highlight, AI explain, comment, copy) */}
      {markdown && viewMode === 'read' && <SelectionMenu />}

      {/* TTS */}
      <TtsPlayer />

      {/* Feature 6: AI Action overlay (auto-dismisses after 8s) */}
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
    </div>
  )
}
