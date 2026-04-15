import { useCallback, useMemo } from 'react'
import { FileText, Layers, ChevronRight } from 'lucide-react'
import { useStore } from '../store/useStore'

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
  const setActiveFile = useStore(s => s.setActiveFile)
  const setViewMode = useStore(s => s.setViewMode)
  const setMarkdown = useStore(s => s.setMarkdown)

  // Per-file stats computed once per folder change.
  const stats = useMemo(() => {
    if (!folderFiles || !folderFileContents) {
      return { totalWords: 0, perFile: [] as Array<{ path: string; name: string; words: number }> }
    }
    const perFile = folderFiles.map(f => {
      const content = folderFileContents.get(f.path) ?? ''
      // Simple word count: strip markdown fences/inline code/punctuation, split on whitespace
      const plain = content
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`]*`/g, '')
        .replace(/[#*_>[\]()]/g, ' ')
      const words = plain.split(/\s+/).filter(Boolean).length
      return { path: f.path, name: f.name, words }
    })
    const totalWords = perFile.reduce((sum, f) => sum + f.words, 0)
    return { totalWords, perFile }
  }, [folderFiles, folderFileContents])

  const handleOpenFile = useCallback((path: string) => {
    setActiveFile(path)
    setViewMode('read')
  }, [setActiveFile, setViewMode])

  const handleViewAllAsOne = useCallback(() => {
    if (!folderFiles || !folderFileContents) return
    // Merge every file into one synthetic document. Prefix each file
    // with an H1 header carrying its name so the merged view has
    // structure for Mind Map / Treemap / Graph views.
    const merged = folderFiles
      .map(f => {
        const content = folderFileContents.get(f.path) ?? ''
        return `# ${f.name}\n\n${content}`
      })
      .join('\n\n---\n\n')
    setMarkdown(merged, `${folderFiles.length} files merged`)
    setViewMode('read')
  }, [folderFiles, folderFileContents, setMarkdown, setViewMode])

  if (!folderFiles || folderFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
        <p>No folder loaded.</p>
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
        </p>

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
            {stats.perFile.map(f => (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => handleOpenFile(f.path)}
                  className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                    <span className="text-sm text-gray-700 dark:text-gray-200 truncate">{f.name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-gray-400">{f.words.toLocaleString()} words</span>
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
