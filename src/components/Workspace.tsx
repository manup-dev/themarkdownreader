import { useState, useEffect, useCallback, useRef } from 'react'
import { Trash2, Upload as UploadIcon, FolderOpen, Database, Search, Loader2, Sparkles, Network, BarChart3, Download, UploadCloud, Map, AlertTriangle, ArrowUpDown, Bookmark } from 'lucide-react'
import { useStore } from '../store/useStore'
import { addDocument, removeDocument, getAllDocuments, getDocStats, clearAllData, exportLibrary, importLibrary, requestPersistentStorage, finalizeImport, saveCollectionCache, type StoredDocument } from '../lib/docstore'
import { openDirectory, hasDirectoryAccess } from '../lib/fs-access'
import { generateCollectionOverview, askAcrossDocuments } from '../lib/correlate'
import { estimateDifficulty } from '../lib/markdown'
import { trackEvent } from '../lib/telemetry'

function IndexProgressDisplay({ progress }: { progress: { current: number; total: number; fileName: string; startedAt: number; errors: string[] } }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Date.now() - progress.startedAt), 1000)
    return () => clearInterval(timer)
  }, [progress.startedAt])

  const elapsedSec = Math.floor(elapsed / 1000)
  const pct = Math.round((progress.current / progress.total) * 100)
  const isSlow = elapsedSec > 30
  const isVerySlow = elapsedSec > 120

  // Estimate remaining time
  const perFile = progress.current > 0 ? elapsed / progress.current : 0
  const remaining = Math.max(0, Math.ceil(((progress.total - progress.current) * perFile) / 1000))

  const formatTime = (sec: number) => {
    if (sec < 60) return `${sec}s`
    return `${Math.floor(sec / 60)}m ${sec % 60}s`
  }

  return (
    <div className="space-y-3">
      <Loader2 className="h-8 w-8 text-blue-500 animate-spin mx-auto" />
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
          Indexing {progress.current} of {progress.total} documents
        </p>
        {progress.fileName && (
          <p className="text-xs text-gray-400 mt-1 truncate max-w-xs mx-auto" title={progress.fileName}>
            {progress.fileName}
          </p>
        )}
      </div>
      <div className="max-w-xs mx-auto">
        <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <p className="text-[10px] text-gray-400">{pct}% complete</p>
          <p className="text-[10px] text-gray-400">
            {formatTime(elapsedSec)}{remaining > 0 && progress.current < progress.total ? ` · ~${formatTime(remaining)} left` : ''}
          </p>
        </div>
      </div>
      {isSlow && (
        <p className={`text-[11px] ${isVerySlow ? 'text-amber-500' : 'text-gray-400'}`}>
          {isVerySlow
            ? 'This is taking longer than expected. Large files need more time to index — please hang tight.'
            : 'Building search index and extracting structure...'}
        </p>
      )}
      {progress.errors.length > 0 && (
        <div className="text-left max-w-xs mx-auto bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2 space-y-1">
          <p className="text-[10px] font-medium text-red-600 dark:text-red-400">
            {progress.errors.length} file{progress.errors.length > 1 ? 's' : ''} failed:
          </p>
          {progress.errors.slice(-3).map((err, i) => (
            <p key={i} className="text-[10px] text-red-500 dark:text-red-400 truncate" title={err}>{err}</p>
          ))}
        </div>
      )}
    </div>
  )
}

export function Workspace() {
  const setViewMode = useStore((s) => s.setViewMode)
  const openDocument = useStore((s) => s.openDocument)
  const [docs, setDocs] = useState<StoredDocument[]>([])
  const [stats, setStats] = useState<{ totalDocs: number; totalWords: number; totalChunks: number; totalHighlights: number; storageEstimate: string } | null>(null)
  const [dupWarning, setDupWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [indexProgress, setIndexProgress] = useState<{ current: number; total: number; fileName: string; startedAt: number; errors: string[] } | null>(null)
  const [sortBy, setSortBy] = useState<'name' | 'words' | 'date' | 'difficulty'>(() => (localStorage.getItem('md-reader-sort') as 'name' | 'words' | 'date' | 'difficulty') || 'date')
  const [queued, setQueued] = useState<Set<number>>(() => {
    const saved = localStorage.getItem('md-reader-queue')
    return saved ? new Set(JSON.parse(saved)) : new Set()
  })
  const toggleQueue = (id: number) => {
    setQueued((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      localStorage.setItem('md-reader-queue', JSON.stringify([...next]))
      return next
    })
  }
  const [overview, setOverview] = useState<string | null>(null)
  const [loadingOverview, setLoadingOverview] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ docFileName: string; sectionPath: string; text: string; answer?: string }> | null>(null)
  const [searchAnswer, setSearchAnswer] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    const allDocs = await getAllDocuments()
    setDocs(allDocs)
    if (allDocs.length >= 2) trackEvent('library_multi_doc')
    const s = await getDocStats()
    setStats(s)
  }, [])

  // Request persistent storage on mount
  useEffect(() => { requestPersistentStorage() }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    document.title = stats ? `Library (${stats.totalDocs}) — md-reader` : 'Library — md-reader'
    return () => { document.title = 'md-reader — Read it. Ship it.' }
  }, [stats])

  const handleFiles = useCallback(async (files: FileList) => {
    setLoading(true)
    setDupWarning(null)
    const dupNames: string[] = []
    const errors: string[] = []
    const validFiles = Array.from(files).filter((f) => f.name.match(/\.(md|markdown|txt|excalidraw)$/))
    const total = validFiles.length
    const isBatch = total > 1
    const startedAt = Date.now()
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i]
      setIndexProgress({ current: i + 1, total, fileName: file.name, startedAt, errors })
      try {
        const text = await file.text()
        const result = await addDocument(file.name, text, isBatch ? { skipPostProcessing: true } : undefined)
        if (result.isExactDuplicate) {
          dupNames.push(`${file.name} (exact duplicate, skipped)`)
        } else if (result.nearDuplicates.length > 0) {
          dupNames.push(`${file.name} (similar to: ${result.nearDuplicates.map((d) => d.fileName).join(', ')})`)
        }
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }
    if (isBatch) {
      setIndexProgress({ current: total, total, fileName: 'Building search index...', startedAt, errors })
      await finalizeImport()
    }
    if (dupNames.length > 0) setDupWarning(dupNames.join('\n'))
    await refresh()
    if (errors.length > 0) {
      setIndexProgress({ current: total, total, fileName: '', startedAt, errors })
      await new Promise((r) => setTimeout(r, 3000))
    }
    setIndexProgress(null)
    setLoading(false)
  }, [refresh])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const handleDirectory = useCallback(async () => {
    const result = await openDirectory()
    if (!result || result.files.length === 0) return
    // Save as a collection project and switch to collection view
    const rawFiles = result.files.map((f) => ({ path: f.path, content: f.content }))
    await saveCollectionCache(result.name, rawFiles, 0)
    // Populate Zustand folder session — auto-selects first file (or README.md).
    // The unified shell renders sidebar + tabs automatically.
    const files = result.files.map((f) => ({
      path: f.path,
      name: f.path.split('/').pop() ?? f.path,
      content: f.content,
    }))
    useStore.getState().setFolderSession(result.handle ?? null, files)
    // Drop the user directly into reading the first file (not the Collection
    // dashboard). They can click the Collection tab anytime for the dashboard.
    setViewMode('read')
  }, [setViewMode])

  const handleRemove = useCallback(async (docId: number) => {
    const doc = docs.find((d) => d.id === docId)
    if (!window.confirm(`Delete "${doc?.fileName ?? 'this document'}" from library?`)) return
    await removeDocument(docId)
    await refresh()
  }, [refresh, docs])

  const handleClearAll = useCallback(async () => {
    if (!window.confirm(`Delete all ${docs.length} documents from library? This cannot be undone.`)) return
    await clearAllData()
    await refresh()
    setOverview(null)
  }, [refresh, docs.length])

  const handleOverview = useCallback(async () => {
    setLoadingOverview(true)
    try {
      const text = await generateCollectionOverview()
      setOverview(text)
    } catch { setOverview('Failed to generate overview.') }
    setLoadingOverview(false)
  }, [])

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    setSearchResults(null)
    setSearchAnswer(null)
    try {
      const { answer, sources } = await askAcrossDocuments(searchQuery)
      setSearchAnswer(answer)
      setSearchResults(sources)
    } catch {
      setSearchAnswer('Search failed. Check your AI backend settings.')
    }
    setSearching(false)
  }, [searchQuery])

  const openDoc = useCallback((doc: StoredDocument) => {
    openDocument(doc.markdown, doc.fileName, doc.id!)
  }, [openDocument])

  return (
    <div
      className="flex-1 overflow-y-auto p-6"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
              Document Library
              {stats && stats.totalDocs > 0 && <span className="text-base font-normal text-gray-400 ml-2">({stats.totalDocs} docs, {stats.totalWords.toLocaleString()} words)</span>}
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Upload multiple markdown files to find connections and ask questions across all of them
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('cross-doc-graph')}
              disabled={docs.length < 2}
              title={docs.length < 2 ? 'Requires at least 2 documents' : 'View document relationships'}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-950/60 disabled:opacity-40 transition-colors"
            >
              <Network className="h-3.5 w-3.5" />
              Doc Graph
            </button>
            <button
              onClick={() => setViewMode('correlation')}
              disabled={docs.length < 2}
              title={docs.length < 2 ? 'Requires at least 2 documents' : 'Find correlations between documents'}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/60 disabled:opacity-40 transition-colors"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Correlations
            </button>
            <button
              onClick={() => setViewMode('similarity-map')}
              disabled={docs.length < 3}
              title={docs.length < 3 ? 'Requires at least 3 documents' : 'Visualize document similarity clusters'}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-950/60 disabled:opacity-40 transition-colors"
            >
              <Map className="h-3.5 w-3.5" />
              Similarity Map
            </button>
          </div>
        </div>

        {/* Stats bar */}
        {stats && stats.totalDocs > 0 && (
          <div className="flex items-center gap-4 text-xs text-gray-400 bg-gray-100 dark:bg-gray-900 px-4 py-2 rounded-lg">
            <span className="inline-flex items-center gap-1"><Database className="h-3 w-3" /> {stats.totalDocs} docs</span>
            <span>{stats.totalWords.toLocaleString()} words</span>
            <span>{stats.totalChunks} indexed chunks</span>
            {queued.size > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-500"><Bookmark className="h-3 w-3" /> {queued.size} queued (~{Math.ceil(docs.filter((d) => queued.has(d.id!)).reduce((s, d) => s + d.wordCount, 0) / 230)}m)</span>
            )}
            <span className="ml-auto">Storage: {stats.storageEstimate}</span>
          </div>
        )}

        {/* Difficulty comparison across documents */}
        {docs.length >= 2 && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">Difficulty Distribution</p>
            <div className="space-y-1.5">
              {docs.map((doc) => {
                const diff = estimateDifficulty(doc.markdown)
                const colors: Record<string, string> = {
                  Beginner: 'bg-green-400',
                  Intermediate: 'bg-blue-400',
                  Advanced: 'bg-amber-400',
                  Expert: 'bg-red-400',
                }
                return (
                  <div key={doc.id} className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate w-28 shrink-0" title={doc.fileName}>{doc.fileName}</span>
                    <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${colors[diff] ?? 'bg-gray-400'}`} style={{ width: '100%' }} />
                    </div>
                    <span className={`text-[10px] font-medium shrink-0 w-20 text-right ${
                      diff === 'Beginner' ? 'text-green-600' : diff === 'Intermediate' ? 'text-blue-600' : diff === 'Advanced' ? 'text-amber-600' : 'text-red-600'
                    }`}>{diff}</span>
                  </div>
                )
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">Suggested reading order: easiest → hardest</p>
          </div>
        )}

        {/* Duplicate warning */}
        {dupWarning && (
          <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium mb-1">Duplicate detection</p>
              <pre className="whitespace-pre-wrap">{dupWarning}</pre>
            </div>
            <button onClick={() => setDupWarning(null)} className="ml-auto text-amber-400 hover:text-amber-600 text-sm">&times;</button>
          </div>
        )}

        {/* Upload area */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            loading
              ? 'border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/20'
              : 'border-gray-300 dark:border-gray-700'
          }`}
        >
          {loading && indexProgress ? (
            <IndexProgressDisplay progress={indexProgress} />
          ) : loading ? (
            <div>
              <Loader2 className="h-8 w-8 text-blue-500 animate-spin mx-auto" />
              <p className="text-sm text-gray-500 mt-2">Preparing...</p>
            </div>
          ) : (
            <>
              <UploadIcon className="h-8 w-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-500 mb-4">
                Drop files here, or choose how to import
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  <UploadIcon className="h-4 w-4" />
                  Choose Files
                </button>
                {hasDirectoryAccess() && (
                  <button
                    onClick={handleDirectory}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium"
                  >
                    <FolderOpen className="h-4 w-4" />
                    Choose Folder
                  </button>
                )}
              </div>
              <p className="text-[10px] text-gray-400 mt-3">
                Supported: .md, .markdown, .txt, .excalidraw
              </p>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".md,.markdown,.txt,.excalidraw"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>

        {/* Cross-doc search */}
        {docs.length >= 2 && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Ask a question across all documents..."
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim()}
                className="px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
              </button>
            </div>

            {searchAnswer && (
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4 space-y-2">
                <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{searchAnswer}</p>
                {searchResults && searchResults.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {searchResults.map((r, i) => (
                      <span key={i} className="text-[10px] bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
                        {r.docFileName} &gt; {r.sectionPath}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Collection overview */}
        {docs.length >= 2 && (
          <div>
            {overview ? (
              <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 border border-purple-200 dark:border-purple-800 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-purple-500" />
                  <span className="text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wider">Collection Overview</span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{overview}</p>
              </div>
            ) : (
              <button
                onClick={handleOverview}
                disabled={loadingOverview}
                className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-950/60 transition-colors disabled:opacity-50"
              >
                {loadingOverview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate collection overview
              </button>
            )}
          </div>
        )}

        {/* Document list */}
        {docs.length > 1 && (
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-3 w-3 text-gray-400" />
            <select
              value={sortBy}
              onChange={(e) => { const v = e.target.value as 'name' | 'words' | 'date' | 'difficulty'; setSortBy(v); localStorage.setItem('md-reader-sort', v) }}
              className="text-xs bg-transparent text-gray-500 dark:text-gray-400 border-none focus:outline-none cursor-pointer"
            >
              <option value="date">Recent first</option>
              <option value="name">Name A-Z</option>
              <option value="words">Largest first</option>
              <option value="difficulty">Difficulty</option>
            </select>
          </div>
        )}
        <div className="space-y-2">
          {[...docs].sort((a, b) => {
            if (sortBy === 'name') return a.fileName.localeCompare(b.fileName)
            if (sortBy === 'words') return b.wordCount - a.wordCount
            if (sortBy === 'difficulty') {
              const order = ['Beginner', 'Intermediate', 'Advanced', 'Expert']
              return order.indexOf(estimateDifficulty(a.markdown)) - order.indexOf(estimateDifficulty(b.markdown))
            }
            return (b.id ?? 0) - (a.id ?? 0)
          }).map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3 hover:shadow-sm hover:border-blue-300 dark:hover:border-blue-700 transition-all group"
            >
              <span className="text-base shrink-0" title={estimateDifficulty(doc.markdown)}>
                {(() => {
                  const md = doc.markdown
                  const hasApi = /\b(API|endpoint|GET|POST)\b/i.test(md)
                  const hasCode = (md.match(/```/g) ?? []).length >= 4
                  const hasSteps = /^\d+\.\s/m.test(md) && (md.match(/^\d+\.\s/gm) ?? []).length >= 3
                  const hasTables = (md.match(/^\|/gm) ?? []).length >= 4
                  if (hasApi && hasCode) return '\uD83D\uDD0C'
                  if (hasSteps) return '\uD83D\uDCDD'
                  if (hasTables) return '\uD83D\uDCCA'
                  if (hasCode) return '\u2699\uFE0F'
                  return '\uD83D\uDCD6'
                })()}
              </span>
              <button
                onClick={() => openDoc(doc)}
                className="flex-1 text-left min-w-0"
                title={doc.markdown.replace(/^#+\s+.+$/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/[`*_~[\]()]/g, '').replace(/\n{2,}/g, '\n').trim().slice(0, 150) + '...'}
              >
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {doc.fileName}
                </p>
                <p className="text-xs text-gray-400">
                  {doc.wordCount.toLocaleString()} words &middot; {doc.chunkCount} chunks &middot; {doc.toc.length} sections
                </p>
              </button>
              <button
                onClick={() => toggleQueue(doc.id!)}
                className={`p-1.5 transition-all ${queued.has(doc.id!) ? 'text-amber-500' : 'text-gray-300 opacity-0 group-hover:opacity-100'}`}
                title={queued.has(doc.id!) ? 'Remove from reading queue' : 'Add to reading queue'}
              >
                <Bookmark className={`h-4 w-4 ${queued.has(doc.id!) ? 'fill-amber-500' : ''}`} />
              </button>
              <button
                onClick={() => handleRemove(doc.id!)}
                className="p-1.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                title="Remove from library"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        {docs.length === 0 && (
          <div className="text-center py-12">
            <FolderOpen className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No documents yet. Upload markdown files to get started.</p>
          </div>
        )}

        {docs.length > 0 && (
          <div className="flex items-center justify-center gap-4 pt-4">
            <button
              onClick={async () => {
                const json = await exportLibrary()
                const blob = new Blob([json], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url; a.download = 'md-reader-library.json'; a.click()
                URL.revokeObjectURL(url)
              }}
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-blue-500 transition-colors"
            >
              <Download className="h-3 w-3" /> Export library
            </button>
            <label className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-blue-500 transition-colors cursor-pointer">
              <UploadCloud className="h-3 w-3" /> Import library
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  try {
                    const text = await file.text()
                    await importLibrary(text)
                    await refresh()
                  } catch { /* ignore */ }
                }}
              />
            </label>
            <button
              onClick={handleClearAll}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              Clear all
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
