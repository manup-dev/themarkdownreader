import { useCallback, useRef, useState, useEffect } from 'react'
import { Upload as UploadIcon, Link, FileText, Library, PenLine, ArrowRight, Clock, FolderOpen, Chrome, Code2, Shield, Mic, Network, GraduationCap } from 'lucide-react'
import { useStore } from '../store/useStore'
import { getAllDocuments, type StoredDocument } from '../lib/docstore'
import { SAMPLE_MARKDOWN } from '../lib/sample-doc'

type Mode = 'home' | 'editor'

export function Upload() {
  const setMarkdown = useStore((s) => s.setMarkdown)
  const setWorkspaceMode = useStore((s) => s.setWorkspaceMode)
  const setViewMode = useStore((s) => s.setViewMode)
  const openDocument = useStore((s) => s.openDocument)
  const [mode, setMode] = useState<Mode>('home')
  const [url, setUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [recentDocs, setRecentDocs] = useState<StoredDocument[]>([])

  // Delight #35: Load recent documents from IndexedDB
  useEffect(() => {
    getAllDocuments().then((docs) => setRecentDocs(docs.slice(0, 3))).catch(() => {})
  }, [])

  // Browser extension support: handle #url= hash and postMessage from extension
  useEffect(() => {
    // Note: #url= hash handling is done in App.tsx so it works even when Upload isn't mounted

    // Handle postMessage from browser extension (validate origin)
    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from same origin or GitHub
      const trustedOrigins = [window.location.origin, 'https://github.com']
      if (!trustedOrigins.includes(event.origin)) return
      if (event.data?.type === 'md-reader-load' && event.data.markdown) {
        setMarkdown(event.data.markdown, event.data.fileName || 'document.md')
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [setMarkdown])
  const [editorText, setEditorText] = useState('')
  const [dragging, setDragging] = useState(false)
  const [isFirstVisit] = useState(() => !localStorage.getItem('md-reader-visited'))
  const [error, setError] = useState<string | null>(null)
  const [starDismissed, setStarDismissed] = useState(() => !!localStorage.getItem('md-reader-star-dismissed'))
  const fileRef = useRef<HTMLInputElement>(null)

  const loadFile = useCallback(
    (file: File) => {
      setError(null)
      if (!file.name.endsWith('.md') && !file.name.endsWith('.markdown') && !file.name.endsWith('.txt')) {
        setError('Please upload a .md, .markdown, or .txt file')
        return
      }
      if (file.size > 10 * 1024 * 1024) {
        setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`)
        return
      }
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target?.result as string
        setMarkdown(text, file.name)
      }
      reader.onerror = () => setError('Failed to read file')
      reader.readAsText(file)
    },
    [setMarkdown],
  )

  const fetchUrl = useCallback(async () => {
    if (!url.trim() || fetching) return
    setError(null)
    setFetching(true)
    try {
      let targetUrl = url.trim()
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = 'https://' + targetUrl
      } else if (targetUrl.startsWith('http://')) {
        targetUrl = targetUrl.replace('http://', 'https://')
      }
      // Validate URL and block private/local hostnames (SSRF protection)
      let parsed: URL
      try {
        parsed = new URL(targetUrl)
      } catch {
        throw new Error('Invalid URL')
      }
      // Strip IPv6 brackets for matching, block all private/local addresses
      const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
      const privatePatterns = [
        /^localhost$/,
        /^127\.0\.0\.1$/,
        /^0\.0\.0\.0$/,
        /^192\.168\./,
        /^10\./,
        /^172\.(1[6-9]|2\d|3[01])\./,
        /\.local$/,
        /^::1$/,                        // IPv6 loopback
        /^::$/,                         // IPv6 unspecified
        /^::ffff:127\./,               // IPv4-mapped IPv6 loopback
        /^::ffff:10\./,                // IPv4-mapped IPv6 private
        /^::ffff:192\.168\./,          // IPv4-mapped IPv6 private
        /^::ffff:172\.(1[6-9]|2\d|3[01])\./, // IPv4-mapped IPv6 private
        /^fe80:/,                       // IPv6 link-local
        /^fc00:/,                       // IPv6 unique local
        /^fd/,                          // IPv6 unique local
      ]
      if (parsed.protocol === 'file:') {
        throw new Error('file:// URLs are not allowed')
      }
      if (privatePatterns.some((p) => p.test(hostname))) {
        throw new Error('URLs pointing to private/local networks are not allowed')
      }
      // Auto-convert GitHub blob/tree URLs to raw URLs
      const ghBlobMatch = targetUrl.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)/)
      if (ghBlobMatch) {
        targetUrl = `https://raw.githubusercontent.com/${ghBlobMatch[1]}/${ghBlobMatch[2]}`
      }
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Content-type check: only allow text-like responses
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType && !contentType.includes('text') && !contentType.includes('markdown') && !contentType.includes('octet-stream')) {
        throw new Error('URL does not appear to point to a text file')
      }
      // Size check: reject files > 10MB
      const contentLength = res.headers.get('content-length')
      if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
        throw new Error('File too large (max 10MB)')
      }
      const text = await res.text()
      if (text.length > 10 * 1024 * 1024) throw new Error('File too large (max 10MB)')
      const name = targetUrl.split('/').pop()?.split('?')[0] || 'document.md'
      setMarkdown(text, name)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch URL. Make sure it points to a raw markdown file.')
    } finally {
      setFetching(false)
    }
  }, [url, fetching, setMarkdown])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) loadFile(file)
    },
    [loadFile],
  )

  const handleEditorSubmit = () => {
    const text = editorText.trim()
    if (!text) return
    setMarkdown(text, 'untitled.md')
  }

  const handleMultipleFiles = useCallback(async (files: FileList) => {
    const { addDocument } = await import('../lib/docstore')
    for (const file of Array.from(files)) {
      if (!file.name.match(/\.(md|markdown|txt)$/)) continue
      const text = await file.text()
      await addDocument(file.name, text)
    }
    setWorkspaceMode(true)
    setViewMode('workspace')
  }, [setWorkspaceMode, setViewMode])

  const loadSample = () => {
    setMarkdown(SAMPLE_MARKDOWN, 'welcome.md')
  }

  // Delight #6: Ctrl+V paste-to-open globally on upload screen
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (mode !== 'home') return
      const text = e.clipboardData?.getData('text')
      if (text && text.length > 10 && (text.includes('\n') || text.startsWith('#'))) {
        e.preventDefault()
        localStorage.setItem('md-reader-visited', '1')
        setMarkdown(text, 'pasted.md')
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [mode, setMarkdown])

  // ─── Editor mode ─────────────────────────────────────────────────────

  if (mode === 'editor') {
    return (
      <div className="flex flex-col h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 animate-fade-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <button
            onClick={() => { if (editorText.trim() && !window.confirm('Discard your markdown?')) return; setMode('home') }}
            className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            &larr; Back
          </button>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Paste or write markdown
            <span className="ml-2 text-[10px] text-gray-400 cursor-help" title={"# Heading\n**bold** *italic*\n- bullet list\n1. numbered\n`code` ```code block```\n[link](url)\n> quote\n| table | row |"}>
              syntax?
            </span>
          </span>
          <button
            onClick={handleEditorSubmit}
            disabled={!editorText.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-40"
          >
            Open in reader
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <textarea
          value={editorText}
          onChange={(e) => setEditorText(e.target.value)}
          placeholder="# Paste or type your markdown here...&#10;&#10;Start writing and click 'Open in reader' when ready."
          autoFocus
          className="flex-1 p-6 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono text-sm leading-relaxed resize-none focus:outline-none placeholder-gray-400"
        />
      </div>
    )
  }

  // ─── Home mode ───────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col items-center min-h-screen p-8 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900"
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className="max-w-xl w-full space-y-6 mt-[10vh]">
        {/* ── Hero area (above the fold) ─────────────────────────── */}
        <div className="text-center space-y-2">
          {/* Reading streak — compact */}
          {(() => {
            const count = parseInt(localStorage.getItem('md-reader-docs-read') ?? '0')
            const today = new Date().toDateString()
            const lastDate = localStorage.getItem('md-reader-streak-date')
            let streak = parseInt(localStorage.getItem('md-reader-streak') ?? '0')
            if (lastDate !== today && count > 0) {
              const yesterday = new Date(Date.now() - 86400000).toDateString()
              streak = lastDate === yesterday ? streak + 1 : 1
              localStorage.setItem('md-reader-streak', String(streak))
              localStorage.setItem('md-reader-streak-date', today)
            }
            return (count > 0 || streak > 0) ? (
              <div className="flex items-center justify-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                {count > 0 && <span>{count} document{count !== 1 ? 's' : ''} read</span>}
                {streak > 0 && <span className="text-amber-500">{streak > 3 ? '\u{1F525} ' : ''}{streak}-day streak</span>}
              </div>
            ) : null
          })()}
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-gray-400 dark:text-gray-500">
            md-reader
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-gray-900 dark:text-gray-50 leading-[1.1]">
            <span className="bg-gradient-to-r from-blue-400 to-purple-600 bg-clip-text text-transparent">
              Read it.
            </span>
            <span className="text-gray-300 dark:text-gray-600 mx-2 font-light">→</span>
            <span className="bg-gradient-to-r from-purple-600 to-emerald-500 bg-clip-text text-transparent">
              Ship it.
            </span>
          </h1>
          <p className="text-base text-gray-500 dark:text-gray-400 pt-1">
            Comprehend. Then act. Without the alt-tab. Local, offline, MIT.
          </p>
          <div className="flex items-center justify-center gap-1.5 pt-1">
            <Shield className="h-3.5 w-3.5 text-green-500" />
            <span className="text-xs text-green-600 dark:text-green-400 font-medium">
              Open source &middot; MIT licensed &middot; Your files never leave your device
            </span>
          </div>
        </div>

        {/* Hero artifacts — 3 headline features */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
              icon: Mic,
              label: 'Podcast',
              desc: 'Two AI voices discussing your doc',
              gradient: 'from-blue-500/10 to-blue-500/5',
              border: 'hover:border-blue-400 dark:hover:border-blue-500',
              iconColor: 'text-blue-500',
            },
            {
              icon: Network,
              label: 'Mind map',
              desc: 'Auto-generated visual outline',
              gradient: 'from-purple-500/10 to-purple-500/5',
              border: 'hover:border-purple-400 dark:hover:border-purple-500',
              iconColor: 'text-purple-500',
            },
            {
              icon: GraduationCap,
              label: 'AI tutor',
              desc: 'Explains and quizzes you',
              gradient: 'from-emerald-500/10 to-emerald-500/5',
              border: 'hover:border-emerald-400 dark:hover:border-emerald-500',
              iconColor: 'text-emerald-500',
            },
          ].map(({ icon: Icon, label, desc, gradient, border, iconColor }) => (
            <button
              key={label}
              onClick={loadSample}
              className={`group relative flex flex-col items-start gap-2 p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gradient-to-br ${gradient} ${border} hover:shadow-md transition-all text-left`}
            >
              <Icon className={`h-5 w-5 ${iconColor}`} />
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">{desc}</p>
              </div>
              <span className="absolute top-3 right-3 text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">Try →</span>
            </button>
          ))}
        </div>

        {/* Drop zone — prominent */}
        <div
          className={`border-2 border-dashed rounded-2xl p-14 text-center cursor-pointer transition-all ${
            dragging
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 scale-[1.02]'
              : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 bg-white/50 dark:bg-gray-900/50'
          }`}
          onClick={() => fileRef.current?.click()}
        >
          <UploadIcon className="mx-auto h-10 w-10 text-gray-400 mb-3" />
          <p className="text-gray-600 dark:text-gray-300 font-medium">
            Drop a markdown file here or click to upload
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {isFirstVisit ? 'Drop a file, paste with Ctrl+V, or click to browse' : '.md, .markdown, or .txt'}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.markdown,.txt"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files
              if (!files) return
              if (files.length === 1) {
                loadFile(files[0])
              } else if (files.length > 1) {
                handleMultipleFiles(files)
              }
            }}
          />
        </div>

        {/* URL input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="url"
              placeholder="Paste a URL to a raw markdown file..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchUrl()}
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <button
            data-fetch-btn
            onClick={fetchUrl}
            disabled={fetching}
            className="px-5 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium text-sm disabled:opacity-50"
          >
            {fetching ? 'Fetching...' : 'Fetch'}
          </button>
        </div>

        {/* Continue Reading CTA for last unfinished doc */}
        {recentDocs.length > 0 && (() => {
          const lastDoc = recentDocs[0]
          const progress = parseFloat(localStorage.getItem(`md-reader-scroll-${lastDoc.id}`) ?? '0')
          return progress > 5 && progress < 95 ? (
            <button
              onClick={() => openDocument(lastDoc.markdown, lastDoc.fileName, lastDoc.id!)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all text-left"
            >
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center shrink-0">
                <span className="text-blue-600 dark:text-blue-400 text-xs font-bold">{Math.round(progress)}%</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Continue reading</p>
                <p className="text-xs text-blue-500 dark:text-blue-400 truncate">{lastDoc.fileName}</p>
              </div>
            </button>
          ) : null
        })()}

        {/* Action buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={() => setMode('editor')}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-sm transition-all text-center"
          >
            <PenLine className="h-5 w-5 text-blue-500" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Write / Paste</span>
          </button>
          <button
            onClick={loadSample}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/20 hover:border-green-400 dark:hover:border-green-600 hover:shadow-sm transition-all text-center"
          >
            <FileText className="h-5 w-5 text-green-500" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Load Sample</span>
          </button>
          <button
            onClick={() => { setWorkspaceMode(true); setViewMode('workspace') }}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-purple-400 dark:hover:border-purple-600 hover:shadow-sm transition-all text-center"
          >
            <Library className="h-5 w-5 text-purple-500" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Library</span>
          </button>
          <button
            onClick={() => { setWorkspaceMode(true); setViewMode('collection') }}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-amber-400 dark:hover:border-amber-600 hover:shadow-sm transition-all text-center"
          >
            <FolderOpen className="h-5 w-5 text-amber-500" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Open Folder</span>
          </button>
        </div>

        {/* Extensions — only surface after first doc read, so first-visit is uncluttered */}
        {parseInt(localStorage.getItem('md-reader-docs-read') ?? '0') >= 1 && (
          <div className="flex gap-3">
            <a
              href="https://github.com/manup-dev/themarkdownreader/tree/master/browser-extension#readme"
              target="_blank"
              rel="noopener"
              className="flex-1 flex items-center gap-2.5 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-sm transition-all text-sm"
            >
              <Chrome className="h-4 w-4 text-blue-500 shrink-0" />
              <span className="text-gray-600 dark:text-gray-300">Chrome Extension</span>
            </a>
            <a
              href="https://manup-dev.github.io/themarkdownreader/md-reader-latest.vsix"
              download="md-reader-latest.vsix"
              rel="noopener"
              className="flex-1 flex items-center gap-2.5 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-purple-400 dark:hover:border-purple-500 hover:shadow-sm transition-all text-sm"
            >
              <Code2 className="h-4 w-4 text-purple-500 shrink-0" />
              <span className="text-gray-600 dark:text-gray-300">VS Code Extension</span>
            </a>
          </div>
        )}

        {/* GitHub star banner — below action buttons */}
        {parseInt(localStorage.getItem('md-reader-docs-read') ?? '0') >= 3 && !starDismissed && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg text-sm">
            <span className="text-lg">&#11088;</span>
            <span className="text-gray-700 dark:text-gray-300">
              Enjoying md-reader? A <a href="https://github.com/manup-dev/themarkdownreader" target="_blank" rel="noopener" className="font-semibold text-amber-700 dark:text-amber-400 hover:underline">GitHub star</a> helps others find it!
            </span>
            <button
              onClick={() => { localStorage.setItem('md-reader-star-dismissed', 'true'); setStarDismissed(true) }}
              className="ml-auto text-gray-400 hover:text-gray-600 text-xs"
            >
              dismiss
            </button>
          </div>
        )}

        {/* ── Below the fold — subtle secondary content ──────────── */}

        {/* Recent documents (subtle) */}
        {recentDocs.length > 0 && (
          <div className="space-y-1.5 opacity-70 hover:opacity-100 transition-opacity">
            <p className="text-xs text-gray-400 flex items-center gap-1"><Clock className="h-3 w-3" /> Recent</p>
            {recentDocs.map((doc) => {
              const progress = parseFloat(localStorage.getItem(`md-reader-scroll-${doc.id}`) ?? '0')
              const minsLeft = Math.max(1, Math.ceil((doc.wordCount / 230) * (1 - progress / 100)))
              return (
                <button
                  key={doc.id}
                  onClick={() => openDocument(doc.markdown, doc.fileName, doc.id!)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-sm transition-all text-left"
                >
                  <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                      {doc.fileName}
                      <span className="text-[9px] text-gray-400 font-normal ml-1">
                        {(() => { const m = Math.floor((Date.now() - doc.addedAt) / 60000); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m/60)}h ago` : `${Math.floor(m/1440)}d ago` })()}
                      </span>
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${progress >= 99 ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, progress)}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">
                        {progress >= 99 ? '\u2713 Done' : `${Math.round(progress)}% \u00b7 ${minsLeft}m left`}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {error && (
          <p className="text-center text-red-500 text-sm">{error}</p>
        )}
      </div>
    </div>
  )
}
