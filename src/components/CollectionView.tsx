import { useCallback, useMemo } from 'react'
import { FileText, Layers, ChevronRight, CheckCircle2, Hash, FolderOpen } from 'lucide-react'
import { useStore } from '../store/useStore'
import { sortFolderFiles } from '../lib/folder-sort'

/**
 * Main-pane tab content for folder mode. Rendered when
 * viewMode === 'collection' AND a folder is loaded. Shows collection
 * stats and a per-file list; the user can click any file to jump into
 * reading it, or click "View all as one" to merge every file into a
 * single synthetic document for cross-file analysis in Mind Map /
 * Treemap / etc.
 *
 * Replaces the dashboard half of CollectionReader.tsx (per the
 * enumeration doc). The file list sidebar half lives in
 * <FileExplorer> (Task 6).
 */
export function CollectionView() {
  const folderFiles = useStore(s => s.folderFiles)
  const folderFileContents = useStore(s => s.folderFileContents)
  const folderHandle = useStore(s => s.folderHandle)
  const folderSortMode = useStore(s => s.folderSortMode)
  const setActiveFile = useStore(s => s.setActiveFile)
  const setViewMode = useStore(s => s.setViewMode)
  const setMarkdown = useStore(s => s.setMarkdown)

  const orderedFiles = useMemo(
    () => (folderFiles ? sortFolderFiles(folderFiles, folderSortMode) : null),
    [folderFiles, folderSortMode],
  )

  // Per-file stats + unique heading count ("concepts") across the collection.
  const stats = useMemo(() => {
    if (!orderedFiles || !folderFileContents) {
      return {
        totalWords: 0,
        perFile: [] as Array<{ path: string; name: string; words: number; headings: number }>,
        concepts: 0,
      }
    }
    const headingSet = new Set<string>()
    const perFile = orderedFiles.map(f => {
      const content = folderFileContents.get(f.path) ?? ''
      // Word count: strip fences/inline code/punctuation
      const plain = content
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`]*`/g, '')
        .replace(/[#*_>[\]()]/g, ' ')
      const words = plain.split(/\s+/).filter(Boolean).length
      // Count h1/h2 headings per file, collect normalized text for collection-wide concept set
      const headingMatches = content.match(/^#{1,2}\s+.+$/gm) ?? []
      for (const h of headingMatches) {
        const normalized = h.replace(/^#{1,2}\s+/, '').trim().toLowerCase()
        if (normalized) headingSet.add(normalized)
      }
      return { path: f.path, name: f.name, words, headings: headingMatches.length }
    })
    const totalWords = perFile.reduce((sum, f) => sum + f.words, 0)
    return { totalWords, perFile, concepts: headingSet.size }
  }, [orderedFiles, folderFileContents])

  // Collection completion: based on md-reader-viewed-files:<folderName>
  const viewedMap = useMemo(() => {
    const key = `md-reader-viewed-files:${folderHandle?.name ?? '__cache__'}`
    try { return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, boolean> }
    catch { return {} }
  }, [folderHandle, folderFiles])
  const viewedCount = folderFiles?.filter(f => viewedMap[f.path]).length ?? 0
  const totalCount = folderFiles?.length ?? 0
  const allViewed = totalCount > 0 && viewedCount === totalCount

  const handleOpenFile = useCallback((path: string) => {
    setActiveFile(path)
    setViewMode('read')
  }, [setActiveFile, setViewMode])

  const handleViewAllAsOne = useCallback(() => {
    if (!orderedFiles || !folderFileContents) return
    // Merge every file into one synthetic document. Prefix each file
    // with an H1 header carrying its name so the merged view has
    // structure for Mind Map / Treemap / Graph views.
    const merged = orderedFiles
      .map(f => {
        const content = folderFileContents.get(f.path) ?? ''
        return `# ${f.name}\n\n${content}`
      })
      .join('\n\n---\n\n')
    setMarkdown(merged, `${orderedFiles.length} files merged`)
    setViewMode('read')
  }, [orderedFiles, folderFileContents, setMarkdown, setViewMode])

  if (!folderFiles) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <FolderOpen className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">No folder open</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs">
          Open a folder from the toolbar (Mode → Open Folder) to see a collection overview here.
        </p>
      </div>
    )
  }

  if (folderFiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <FileText className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
          No markdown files in this folder
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs">
          md-reader reads <code className="text-[11px]">.md</code>, <code className="text-[11px]">.markdown</code>, and <code className="text-[11px]">.excalidraw</code> files. Add some and click refresh.
        </p>
      </div>
    )
  }

  // Rough reading time: 200 words per minute
  const readingMinutes = Math.max(1, Math.round(stats.totalWords / 200))

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-8 py-6 max-w-4xl w-full mx-auto">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
          Collection Overview
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {folderFiles.length} markdown file{folderFiles.length === 1 ? '' : 's'}
          {' · '}
          {stats.totalWords.toLocaleString()} words
          {' · '}
          ~{readingMinutes} min total read
          {stats.concepts > 0 && (
            <>
              {' · '}
              <span title="Unique H1/H2 headings across the collection" className="inline-flex items-center gap-0.5">
                <Hash className="inline h-3 w-3" />
                {stats.concepts} concept{stats.concepts === 1 ? '' : 's'}
              </span>
            </>
          )}
        </p>

        {allViewed ? (
          <div className="mt-4 flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900/50 text-green-800 dark:text-green-300">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <div className="text-sm">
              <span className="font-medium">Collection complete</span>
              <span className="ml-1 text-xs opacity-80">— you've opened every file ({viewedCount}/{totalCount})</span>
            </div>
          </div>
        ) : viewedCount > 0 ? (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400 mb-1">
              <span>Progress</span>
              <span className="tabular-nums">{viewedCount}/{totalCount} opened</span>
            </div>
            <div className="h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${(viewedCount / totalCount) * 100}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={handleViewAllAsOne}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Layers className="h-4 w-4" />
            View all as one
          </button>
        </div>

        <div className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            Files
          </h2>
          <ul className="divide-y divide-gray-200 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            {stats.perFile.map(f => {
              const isViewed = !!viewedMap[f.path]
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    onClick={() => handleOpenFile(f.path)}
                    className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isViewed
                        ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" aria-label="Opened" />
                        : <FileText className="h-4 w-4 text-gray-400 shrink-0" />}
                      <span className={'text-sm truncate ' + (isViewed ? 'text-gray-500 dark:text-gray-400' : 'text-gray-700 dark:text-gray-200')}>
                        {f.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-gray-400">{f.words.toLocaleString()} words</span>
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
