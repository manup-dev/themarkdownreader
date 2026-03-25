import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { FolderOpen, ChevronRight, ChevronLeft, Clock, FileText, ArrowRight, RefreshCw, BookOpen, GripVertical, Layers, Search, PenTool } from 'lucide-react'

const ExcalidrawViewer = lazy(() => import('./ExcalidrawViewer').then((m) => ({ default: m.ExcalidrawViewer })))
import Markdown from 'react-markdown'
import { slugify } from '../lib/markdown'

// Heading component that generates IDs for anchor link navigation
function CollectionHeading(level: number) {
  return function Heading({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
    const text = typeof children === 'string' ? children : String(children ?? '')
    const id = slugify(text)
    const Tag = `h${level}` as any
    return <Tag id={id} {...props} className="scroll-mt-16">{children}</Tag>
  }
}
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { useStore } from '../store/useStore'
import { buildCollection, resolveRelativePath, type Collection } from '../lib/collection'
import { estimateDifficulty } from '../lib/markdown'
import { openDirectory, readFileList, hasDirectoryAccess, reopenDirectory, type DirectoryFile } from '../lib/fs-access'
import { saveCollectionCache, loadCollectionCache, listProjects, deleteProject } from '../lib/docstore'

export function CollectionReader() {
  const theme = useStore((s) => s.theme)
  const fontSize = useStore((s) => s.fontSize)
  const setMarkdown = useStore((s) => s.setMarkdown)
  const setViewMode = useStore((s) => s.setViewMode)

  const [collection, setCollection] = useState<Collection | null>(null)
  const [currentFileIndex, setCurrentFileIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [projects, setProjects] = useState<Array<{ id: string; name: string; fileCount: number; savedAt: number }>>([])
  const [showProjectSwitcher, setShowProjectSwitcher] = useState(false)
  const [viewedFiles, setViewedFiles] = useState<Set<number>>(() => {
    const saved = localStorage.getItem(`md-reader-collection-viewed-${collection?.name ?? ''}`)
    return saved ? new Set(JSON.parse(saved)) : new Set([0])
  })
  const fallbackInputRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const currentFile = collection?.files[currentFileIndex] ?? null

  // Reorder files via drag-and-drop
  const handleReorder = useCallback((fromIdx: number, toIdx: number) => {
    if (!collection || fromIdx === toIdx) return
    const files = [...collection.files]
    const [moved] = files.splice(fromIdx, 1)
    files.splice(toIdx, 0, moved)
    // Update order field
    files.forEach((f, i) => { f.order = i })
    const updated = { ...collection, files, suggestedOrder: files.map((f) => f.path) }
    setCollection(updated)
    // If we were viewing the moved file, follow it
    if (currentFileIndex === fromIdx) {
      setCurrentFileIndex(toIdx)
    } else if (currentFileIndex > fromIdx && currentFileIndex <= toIdx) {
      setCurrentFileIndex(currentFileIndex - 1)
    } else if (currentFileIndex < fromIdx && currentFileIndex >= toIdx) {
      setCurrentFileIndex(currentFileIndex + 1)
    }
    // Persist new order
    // Compute the correct new index (mirrors the logic above)
    let newIdx = currentFileIndex
    if (currentFileIndex === fromIdx) newIdx = toIdx
    else if (currentFileIndex > fromIdx && currentFileIndex <= toIdx) newIdx = currentFileIndex - 1
    else if (currentFileIndex < fromIdx && currentFileIndex >= toIdx) newIdx = currentFileIndex + 1
    saveCollectionCache(
      updated.name,
      files.map((f) => ({ path: f.path, content: f.markdown })),
      newIdx,
    ).catch(() => {})
    setDragIdx(null)
    setDragOverIdx(null)
  }, [collection, currentFileIndex])

  // Load collection from files + persist to IndexedDB
  const loadFromFiles = useCallback((files: DirectoryFile[], name: string, handle?: FileSystemDirectoryHandle) => {
    setLoading(true)
    const rawFiles = files.map((f) => ({ path: f.path, content: f.content }))
    const coll = buildCollection(rawFiles, name)
    setCollection(coll)
    setCurrentFileIndex(0)
    setLoading(false)
    if (handle) setDirHandle(handle)
    // Persist to IndexedDB so session survives reload
    saveCollectionCache(name, rawFiles, 0).catch(() => {})
  }, [])

  // Expose loadFromFiles for E2E testing
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__mdReaderLoadCollection = (files: Array<{ path: string; content: string }>, name: string) => {
      loadFromFiles(files.map((f) => ({ ...f, lastModified: Date.now() })), name)
    }
    return () => { delete (window as unknown as Record<string, unknown>).__mdReaderLoadCollection }
  }, [loadFromFiles])

  // Auto-restore collection from IndexedDB on mount + load project list
  useEffect(() => {
    listProjects().then(setProjects).catch(() => {})
    if (collection) return // Already loaded
    loadCollectionCache().then((cached) => {
      if (!cached) return
      const coll = buildCollection(cached.files, cached.name)
      setCollection(coll)
      setCurrentFileIndex(Math.min(cached.currentFileIndex, coll.files.length - 1))
      setTimeout(() => {
        const sidebar = document.querySelector('aside')
        const activeBtn = sidebar?.querySelector('[class*="bg-blue-50"]')
        activeBtn?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 200)
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Switch to a different project
  const switchProject = useCallback(async (projId: string) => {
    const cached = await loadCollectionCache(projId)
    if (!cached) return
    const coll = buildCollection(cached.files, cached.name)
    setCollection(coll)
    setCurrentFileIndex(Math.min(cached.currentFileIndex, coll.files.length - 1))
    setSearchQuery('')
    setShowProjectSwitcher(false)
    // Update "last" pointer
    saveCollectionCache(cached.name, cached.files, cached.currentFileIndex).catch(() => {})
    listProjects().then(setProjects).catch(() => {})
  }, [])

  // Refresh project list after saving
  useEffect(() => {
    if (collection) listProjects().then(setProjects).catch(() => {})
  }, [collection])

  // Open directory via File System Access API
  const handleOpenDir = useCallback(async () => {
    const result = await openDirectory()
    if (result) loadFromFiles(result.files, result.name, result.handle)
  }, [loadFromFiles])

  // Fallback: folder input
  const handleFallbackInput = useCallback(async (files: FileList) => {
    const dirFiles = await readFileList(files)
    if (dirFiles.length === 0) return
    // Extract folder name from first file's path
    const firstPath = dirFiles[0].path
    const folderName = firstPath.includes('/') ? firstPath.split('/')[0] : 'Collection'
    loadFromFiles(dirFiles, folderName)
  }, [loadFromFiles])

  // Refresh: re-read directory
  const handleRefresh = useCallback(async () => {
    if (!dirHandle) return
    setLoading(true)
    try {
      const files = await reopenDirectory(dirHandle)
      const coll = buildCollection(
        files.map((f) => ({ path: f.path, content: f.content })),
        dirHandle.name,
      )
      setCollection(coll)
    } catch { /* permission denied or dir deleted */ }
    setLoading(false)
  }, [dirHandle])

  // Navigate to a file by path
  const navigateTo = useCallback((path: string) => {
    if (!collection) return
    const idx = collection.files.findIndex((f) => f.path === path)
    if (idx >= 0) {
      setCurrentFileIndex(idx)
      contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [collection])

  // Open current file in full reader — with back link to collection
  const openInReader = useCallback(() => {
    if (!currentFile) return
    setMarkdown(currentFile.markdown, currentFile.name + '.md')
    setViewMode('read')
    sessionStorage.setItem('md-reader-from-collection', '1')
  }, [currentFile, setMarkdown, setViewMode])

  // Open ALL files merged into one document — enables Cards, Mind Map, Treemap, Graph across entire collection
  const openAllInReader = useCallback(() => {
    if (!collection) return
    const merged = collection.files
      .map((f) => {
        // Add a file separator heading so each file is identifiable in the merged view
        const header = `# ${f.name}\n\n`
        // Strip the original H1 if it exists to avoid duplicate top-level headings
        const content = f.markdown.replace(/^#\s+.+\n+/, '')
        return header + content
      })
      .join('\n\n---\n\n')
    setMarkdown(merged, `${collection.name} (${collection.files.length} files).md`)
    setViewMode('read')
    sessionStorage.setItem('md-reader-from-collection', '1')
  }, [collection, setMarkdown, setViewMode])

  // Scroll to top on file change + persist current position
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
    setViewedFiles(prev => {
      const next = new Set([...prev, currentFileIndex])
      localStorage.setItem(`md-reader-collection-viewed-${collection?.name ?? ''}`, JSON.stringify([...next]))
      return next
    })
    if (collection) {
      saveCollectionCache(
        collection.name,
        collection.files.map((f) => ({ path: f.path, content: f.markdown })),
        currentFileIndex,
      ).catch(() => {})
    }
  }, [currentFileIndex, collection])

  const themeClasses: Record<string, string> = {
    light: 'bg-white text-gray-900',
    dark: 'bg-gray-950 text-gray-100',
    sepia: 'bg-sepia-50 text-sepia-900',
    'high-contrast': 'bg-black text-white',
  }

  // ─── Empty state: no collection loaded ─────────────────────────────────

  if (!collection) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-6 max-w-md w-full">
          <FolderOpen className="h-16 w-16 text-gray-300 dark:text-gray-600 mx-auto" />
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200">Open a folder of markdown files</h2>
            <p className="text-sm text-gray-400 mt-2">
              Point to a directory and md-reader will discover connections between files,
              suggest a reading order, and let you navigate seamlessly.
            </p>
          </div>

          <div className="space-y-3">
            {hasDirectoryAccess() ? (
              <button
                onClick={handleOpenDir}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
              >
                <FolderOpen className="h-5 w-5" />
                Choose Folder
              </button>
            ) : (
              <label className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium cursor-pointer">
                <FolderOpen className="h-5 w-5" />
                Choose Folder
                <input
                  ref={fallbackInputRef}
                  type="file"
                  className="hidden"
                  {...{ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>}
                  onChange={(e) => e.target.files && handleFallbackInput(e.target.files)}
                />
              </label>
            )}
            <p className="text-xs text-gray-400">
              {hasDirectoryAccess()
                ? 'Uses File System Access API — your files stay local, nothing is uploaded.'
                : 'Your browser will read the folder contents locally.'}
            </p>
          </div>

          {/* Previously opened projects */}
          {projects.length > 0 && (
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Recent Projects</p>
              <div className="space-y-2">
                {projects.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 group">
                    <button
                      onClick={() => switchProject(p.id)}
                      className="flex-1 flex items-center gap-3 px-4 py-2.5 bg-gray-50 dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg transition-colors text-left"
                    >
                      <Layers className="h-4 w-4 text-gray-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate block">{p.name}</span>
                        <span className="text-[10px] text-gray-400">{p.fileCount} files</span>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-blue-500 transition-colors shrink-0" />
                    </button>
                    <button
                      onClick={async () => { if (window.confirm(`Delete project "${p.name}"?`)) { await deleteProject(p.id); setProjects(await listProjects()) } }}
                      className="p-1 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      title="Delete project"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─── Collection loaded ─────────────────────────────────────────────────

  return (
    <div className="flex-1 flex min-h-0">
      {/* Sidebar: file list + links */}
      <aside className="w-64 shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto">
        {/* Collection header */}
        <div className="p-3 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 truncate">{collection.name}</h3>
              {projects.length > 1 && (
                <button
                  onClick={() => setShowProjectSwitcher(!showProjectSwitcher)}
                  className="p-0.5 text-gray-400 hover:text-blue-500 shrink-0 transition-colors"
                  title="Switch project"
                >
                  <ChevronRight className={`h-3 w-3 transition-transform ${showProjectSwitcher ? 'rotate-90' : ''}`} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setCollection(null); setCurrentFileIndex(0) }}
                className="p-1 text-gray-400 hover:text-green-500 transition-colors"
                title="Open another directory"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
              {dirHandle && (
                <button onClick={handleRefresh} className="p-1 text-gray-400 hover:text-gray-600" title="Refresh files">
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>
          </div>
          {/* Project switcher dropdown */}
          {showProjectSwitcher && projects.length > 0 && (
            <div className="mt-2 bg-gray-50 dark:bg-gray-800 rounded-lg p-2 space-y-1 animate-scale-in">
              <p className="text-[9px] text-gray-400 uppercase tracking-wider px-1">Projects</p>
              {projects.map((p) => (
                <div key={p.id} className="flex items-center gap-1">
                  <button
                    onClick={() => switchProject(p.id)}
                    className={`flex-1 text-left text-[10px] px-2 py-1 rounded transition-colors truncate ${
                      p.name === collection.name
                        ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-600 font-medium'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {p.name} <span className="text-gray-400">({p.fileCount})</span>
                  </button>
                  {p.name !== collection.name && (
                    <button
                      onClick={async (e) => { e.stopPropagation(); if (window.confirm(`Delete project "${p.name}"?`)) { await deleteProject(p.id); setProjects(await listProjects()) } }}
                      className="p-0.5 text-gray-300 hover:text-red-400 shrink-0"
                      title="Delete project"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => { setCollection(null); setCurrentFileIndex(0); setShowProjectSwitcher(false) }}
                className="w-full text-left text-[10px] px-2 py-1 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/20 rounded transition-colors"
              >
                + Open new directory
              </button>
            </div>
          )}
          <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
            <span>{collection.files.length} files</span>
            <span>{collection.totalWords.toLocaleString()} words</span>
            {(() => {
              const concepts = new Set<string>()
              collection.files.forEach((f) => {
                (f.markdown.match(/\*\*([^*]+)\*\*/g) ?? []).forEach((b) => concepts.add(b.replace(/\*\*/g, '').toLowerCase()))
              })
              return concepts.size > 0 ? <span>{concepts.size} concepts</span> : null
            })()}
            <span>{collection.totalReadingTime >= 60
              ? `${Math.floor(collection.totalReadingTime / 60)}h ${collection.totalReadingTime % 60}m total`
              : `${collection.totalReadingTime}m total`}</span>
          </div>
          <div className="mt-1">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              { sequential: 'bg-blue-100 dark:bg-blue-950/40 text-blue-600',
                wiki: 'bg-purple-100 dark:bg-purple-950/40 text-purple-600',
                hierarchical: 'bg-amber-100 dark:bg-amber-950/40 text-amber-600',
                flat: 'bg-gray-100 dark:bg-gray-800 text-gray-500',
              }[collection.structure]
            }`}>
              {collection.structure}
            </span>
          </div>
          <div className="mt-1.5 h-1 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden" title={`${Math.round(((currentFileIndex + 1) / collection.files.length) * 100)}% through collection`}>
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${((currentFileIndex + 1) / collection.files.length) * 100}%` }} />
          </div>
          {/* Reading heatmap */}
          <div className="flex gap-0.5 mt-1.5 px-3">
            {collection.files.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full ${
                  i === currentFileIndex ? 'bg-blue-500' : viewedFiles.has(i) ? 'bg-green-400' : 'bg-gray-200 dark:bg-gray-700'
                }`}
                title={collection.files[i].name}
              />
            ))}
          </div>
          {collection.files.length > 5 && (
            <div className="mt-2 relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter files..."
                className="w-full pl-7 pr-2 py-1 text-[10px] rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}
        </div>

        {/* File list — grouped by directory, drag to reorder */}
        <div className="p-2 space-y-0.5">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider px-2 mb-1">Files <span className="normal-case">(drag to reorder)</span></p>
          {(() => {
            const filtered = collection.files.filter((f) => !searchQuery || f.name.toLowerCase().includes(searchQuery.toLowerCase()) || f.path.toLowerCase().includes(searchQuery.toLowerCase()))
            let lastDir = ''
            return filtered.map((file) => {
              const idx = collection.files.indexOf(file)
              const isCurrent = idx === currentFileIndex
              const linksFromCurrent = currentFile?.linksTo.includes(file.path)
              const isDragging = dragIdx === idx
              const isDragOver = dragOverIdx === idx
              // Show directory header when directory changes
              const fileDir = file.path.includes('/') ? file.path.split('/').slice(0, -1).join('/') : ''
              const showDirHeader = fileDir !== lastDir && file.depth > 0
              lastDir = fileDir
              return (
                <div key={file.path}>
                  {showDirHeader && (
                    <div className="flex items-center gap-1 px-2 pt-2 pb-0.5">
                      <FolderOpen className="h-3 w-3 text-amber-500" />
                      <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 truncate">{fileDir}/</span>
                    </div>
                  )}
                  <div
                    draggable
                    onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move' }}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIdx(idx) }}
                    onDragLeave={() => { if (dragOverIdx === idx) setDragOverIdx(null) }}
                    onDrop={(e) => { e.preventDefault(); if (dragIdx !== null) handleReorder(dragIdx, idx) }}
                    onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
                    className={`flex items-center gap-1 rounded-lg text-xs transition-all ${
                      isDragging ? 'opacity-40' : ''
                    } ${isDragOver ? 'border-t-2 border-blue-400' : 'border-t-2 border-transparent'}`}
                    style={{ paddingLeft: file.depth > 0 ? `${file.depth * 8}px` : undefined }}
                  >
                    <span className="cursor-grab active:cursor-grabbing p-1 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 shrink-0">
                      <GripVertical className="h-3 w-3" />
                    </span>
                    <button
                      onClick={() => { setCurrentFileIndex(idx); contentRef.current?.scrollTo({ top: 0 }) }}
                      className={`flex-1 text-left flex items-center gap-2 px-1 py-1.5 rounded-lg transition-colors ${
                        isCurrent
                          ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium'
                          : linksFromCurrent
                            ? 'text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/20'
                            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span className="text-[9px] text-gray-300 dark:text-gray-600 w-4 text-right shrink-0">{viewedFiles.has(idx) ? '✓' : idx + 1}</span>
                      {file.fileType === 'excalidraw' ? <PenTool className="h-3 w-3 shrink-0 text-orange-400" /> : <FileText className="h-3 w-3 shrink-0" />}
                      <span className="truncate">{file.name}</span>
                  {file.fileType === 'markdown' ? (
                    <span className="text-[9px] text-gray-300 dark:text-gray-600 ml-auto shrink-0" title={`${file.wordCount.toLocaleString()} words, ${file.readingTime} min read`}>{file.readingTime}m</span>
                  ) : (
                    <span className="text-[9px] text-orange-400 dark:text-orange-500 ml-auto shrink-0">{file.fileType}</span>
                  )}
                </button>
                  </div>
                </div>
              )
            })
          })()}
        </div>

        {/* Links from current file */}
        {currentFile && currentFile.linksTo.length > 0 && (
          <div className="p-2 border-t border-gray-200 dark:border-gray-800">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider px-2 mb-1">Links from this file ({currentFile.linksTo.length})</p>
            {currentFile.linksTo.map((target) => {
              const targetFile = collection.files.find((f) => f.path === target)
              if (!targetFile) return null
              return (
                <button
                  key={target}
                  onClick={() => navigateTo(target)}
                  className="w-full text-left flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-950/20 transition-colors"
                >
                  <ArrowRight className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{targetFile.name}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Backlinks */}
        {currentFile && currentFile.linkedFrom.length > 0 && (
          <div className="p-2 border-t border-gray-200 dark:border-gray-800">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider px-2 mb-1">Referenced by ({currentFile.linkedFrom.length})</p>
            {currentFile.linkedFrom.map((source) => {
              const sourceFile = collection.files.find((f) => f.path === source)
              if (!sourceFile) return null
              return (
                <button
                  key={source}
                  onClick={() => navigateTo(source)}
                  className="w-full text-left flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <ChevronLeft className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{sourceFile.name}</span>
                </button>
              )
            })}
          </div>
        )}

        {viewedFiles.size >= collection.files.length && (
          <div className="p-3 border-t border-gray-200 dark:border-gray-800 text-center">
            <p className="text-lg mb-1">🎉</p>
            <p className="text-[10px] text-gray-500 font-medium">All {collection.files.length} files viewed!</p>
            <p className="text-[9px] text-gray-400">
              {collection.totalWords.toLocaleString()} words · {collection.totalReadingTime}m
              {(() => {
                const concepts = new Set<string>()
                collection.files.forEach((f) => {
                  const bold = f.markdown.match(/\*\*([^*]+)\*\*/g) ?? []
                  bold.forEach((b) => concepts.add(b.replace(/\*\*/g, '').toLowerCase()))
                })
                return concepts.size > 0 ? ` · ~${concepts.size} concepts` : ''
              })()}
            </p>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Navigation bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setCurrentFileIndex(Math.max(0, currentFileIndex - 1))}
              disabled={currentFileIndex === 0}
              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              {currentFile?.path && currentFile.path.includes('/') && (
                <span className="text-[10px] text-gray-400 block truncate">
                  {currentFile.path.split('/').slice(0, -1).join(' / ')}
                </span>
              )}
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate block">
                {currentFile?.name ?? 'No file'}
              </span>
            </div>
            <button
              onClick={() => setCurrentFileIndex(Math.min(collection.files.length - 1, currentFileIndex + 1))}
              disabled={currentFileIndex === collection.files.length - 1}
              className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>{currentFileIndex + 1}/{collection.files.length}</span>
            <span className="text-[9px] text-gray-300" title="Words read so far">
              {collection.files.filter((_, i) => viewedFiles.has(i)).reduce((s, f) => s + f.wordCount, 0).toLocaleString()} words read
            </span>
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{currentFile?.readingTime}m</span>
            {collection.files.length > 1 && (
              <span className="text-[9px] text-gray-300 dark:text-gray-600" title="Estimated time to finish remaining files">
                ({collection.files.slice(currentFileIndex + 1).reduce((s, f) => s + f.readingTime, 0)}m left)
              </span>
            )}
            <select
              value={currentFileIndex}
              onChange={(e) => { setCurrentFileIndex(Number(e.target.value)); contentRef.current?.scrollTo({ top: 0 }) }}
              className="px-1.5 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-[10px] text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[120px]"
              title="Jump to file"
            >
              {collection.files.map((f, i) => (
                <option key={f.path} value={i}>{f.name}</option>
              ))}
            </select>
            <button
              onClick={openInReader}
              className="px-2 py-1 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 text-[10px] font-medium"
              title="Open this file in full reader with mind map, coach, etc."
            >
              <BookOpen className="h-3 w-3 inline mr-1" />
              This file
            </button>
            <button
              onClick={openAllInReader}
              className="px-2 py-1 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 hover:bg-purple-100 text-[10px] font-medium"
              title="Merge all files into one view — see Cards, Mind Map, Treemap, Graph across the entire collection"
            >
              <Layers className="h-3 w-3 inline mr-1" />
              All files
            </button>
          </div>
        </div>

        {/* File content */}
        <div
          ref={contentRef}
          className={`flex-1 overflow-y-auto ${themeClasses[theme] ?? themeClasses.light}`}
        >
          {/* Progress within collection */}
          <div className="sticky top-0 z-10 h-0.5 bg-gray-200 dark:bg-gray-800">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${((currentFileIndex + 1) / collection.files.length) * 100}%` }}
            />
          </div>

          {currentFile && currentFile.fileType === 'excalidraw' ? (
            <Suspense fallback={<div className="flex items-center justify-center h-64 text-gray-400">Loading diagram...</div>}>
              <ExcalidrawViewer content={currentFile.markdown} fileName={currentFile.name} />
            </Suspense>
          ) : currentFile && (
            <article
              className="max-w-3xl mx-auto px-8 py-8 pb-32 prose prose-gray dark:prose-invert prose-headings:font-semibold prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-code:before:hidden prose-code:after:hidden prose-img:rounded-lg"
              style={{ fontSize: `${fontSize}px`, lineHeight: 1.75 }}
            >
              <Markdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  // Heading components with IDs for anchor navigation
                  h1: CollectionHeading(1),
                  h2: CollectionHeading(2),
                  h3: CollectionHeading(3),
                  h4: CollectionHeading(4),
                  h5: CollectionHeading(5),
                  h6: CollectionHeading(6),
                  // Handle all link types: same-file anchors, cross-file, cross-file+anchor, external
                  a: ({ href, children, ...props }) => {
                    if (!href) return <a {...props}>{children}</a>

                    // 1. Same-file anchor links (#heading) — scroll within current content
                    if (href.startsWith('#')) {
                      return (
                        <a
                          {...props}
                          href={href}
                          className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const id = href.slice(1)
                            const el = document.getElementById(id)
                            if (el) {
                              // Scroll within the content container, not the window
                              const container = contentRef.current
                              if (container) {
                                const containerRect = container.getBoundingClientRect()
                                const elRect = el.getBoundingClientRect()
                                container.scrollTo({ top: container.scrollTop + elRect.top - containerRect.top - 16, behavior: 'smooth' })
                              } else {
                                el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                              }
                              el.style.transition = 'background 300ms'
                              el.style.background = 'rgba(59,130,246,0.15)'
                              setTimeout(() => { el.style.background = '' }, 1500)
                            }
                          }}
                        >
                          {children}
                        </a>
                      )
                    }

                    // 2. Internal links: .md files, directory links (dir/ → dir/README.md), or relative paths
                    const fragmentIdx = href.indexOf('#')
                    const filePart = fragmentIdx >= 0 ? href.slice(0, fragmentIdx) : href
                    const fragment = fragmentIdx >= 0 ? href.slice(fragmentIdx + 1) : null
                    const cleanFile = filePart.replace(/^\.\//, '').replace(/\/$/, '')
                    const isMdLink = /\.(?:md|markdown)$/i.test(cleanFile)
                    // Also match directory links (./chat_system/ or chat_system)
                    const isDirLink = !isMdLink && !cleanFile.startsWith('http') && !cleanFile.includes('.')

                    if ((isMdLink || isDirLink) && collection && currentFile) {
                      const allPaths = collection.files.map((f) => f.path)
                      // For directory links, try dir/README.md first
                      const candidates = isMdLink ? [cleanFile] : [`${cleanFile}/README.md`, `${cleanFile}/readme.md`, `${cleanFile}/index.md`]
                      let resolved: string | null = null
                      for (const candidate of candidates) {
                        resolved = resolveRelativePath(candidate, currentFile.path, allPaths)
                        if (resolved) break
                      }

                      if (resolved) {
                        return (
                          <a
                            {...props}
                            href="#"
                            onClick={(e) => {
                              e.preventDefault()
                              navigateTo(resolved)
                              if (fragment) {
                                setTimeout(() => {
                                  const el = document.getElementById(fragment)
                                  if (el) {
                                    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                    el.style.transition = 'background 300ms'
                                    el.style.background = 'rgba(59,130,246,0.15)'
                                    setTimeout(() => { el.style.background = '' }, 1500)
                                  }
                                }, 300)
                              }
                            }}
                            className="text-purple-600 dark:text-purple-400 hover:underline cursor-pointer"
                            title={`Navigate to: ${resolved}${fragment ? ` > #${fragment}` : ''}`}
                          >
                            {children} <ArrowRight className="inline h-3 w-3" />
                          </a>
                        )
                      }
                    }

                    // 3. External links — open in new tab
                    const isExternal = href.startsWith('http://') || href.startsWith('https://')
                    return <a href={href} {...props} {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>
                  },
                }}
              >
                {currentFile.markdown}
              </Markdown>
            </article>
          )}

          {/* Next file suggestion */}
          {currentFile && currentFileIndex < collection.files.length - 1 && (
            <div className="max-w-3xl mx-auto px-8 pb-16">
              <div className="border-t border-gray-200 dark:border-gray-800 pt-8">
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Up next</p>
                <button
                  onClick={() => { setCurrentFileIndex(currentFileIndex + 1); contentRef.current?.scrollTo({ top: 0 }) }}
                  className="w-full flex items-center gap-3 p-4 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-sm transition-all text-left group"
                >
                  <FileText className="h-6 w-6 text-gray-400 group-hover:text-blue-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-blue-600">
                      {collection.files[currentFileIndex + 1].name}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {collection.files[currentFileIndex + 1].wordCount.toLocaleString()} words &middot; {collection.files[currentFileIndex + 1].readingTime}m read
                      {(() => {
                        const nextDiff = estimateDifficulty(collection.files[currentFileIndex + 1].markdown)
                        const currDiff = currentFile ? estimateDifficulty(currentFile.markdown) : 'Beginner'
                        const levels = ['Beginner', 'Intermediate', 'Advanced', 'Expert']
                        const delta = levels.indexOf(nextDiff) - levels.indexOf(currDiff)
                        return delta > 0 ? ' \u00b7 harder \u2191' : delta < 0 ? ' \u00b7 easier \u2193' : ' \u00b7 same level'
                      })()}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-blue-500 ml-auto" />
                </button>
              </div>
            </div>
          )}

          {/* Collection complete */}
          {currentFile && currentFileIndex === collection.files.length - 1 && (
            <div className="max-w-3xl mx-auto px-8 pb-16">
              <div className="border-t border-gray-200 dark:border-gray-800 pt-8 text-center">
                <p className="text-2xl mb-2">🎉</p>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  You've read all {collection.files.length} files in this collection!
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {collection.totalWords.toLocaleString()} words across {collection.totalReadingTime} minutes
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
