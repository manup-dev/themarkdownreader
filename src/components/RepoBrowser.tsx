import { useEffect, useState, useCallback } from 'react'
import { Folder, FileText, ChevronRight, RefreshCw, AlertCircle, ExternalLink } from 'lucide-react'
import { loadRepoFolderFromHash, type RepoFolderResult } from '../lib/repo-browser'

interface RepoBrowserProps {
  /** Captured share URL — caller passes window.location.href at the moment
   *  the share was detected, since the history-syncing effect rewrites the
   *  hash before this component mounts. */
  href: string
  /**
   * Called when the user clicks a `.md` file. Receives the pre-built share
   * URL so the caller can navigate via window.location.href = url and let
   * the share-loader path take over.
   */
  onOpenFile: (shareUrl: string) => void
  /** Called when the user clicks a sub-directory. Same shape as onOpenFile. */
  onOpenFolder: (folderShareUrl: string) => void
}

/**
 * Folder browser for `#repo=owner/name&path=…` shares where the path is a
 * directory. Lists `.md` siblings + sub-directories. Files open via
 * onOpenFile; sub-directories open via onOpenFolder. Empty folders show a
 * helpful message rather than a blank pane.
 */
export function RepoBrowser({ href, onOpenFile, onOpenFolder }: RepoBrowserProps) {
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error' | 'empty'
    result?: RepoFolderResult
    error?: string
  }>({ status: 'loading' })

  // Reload key bumps to trigger a refetch from the same href. Inlining
  // the async logic in the effect avoids the react-compiler "no sync
  // setState from inside an effect" warning that fires when an effect
  // calls a useCallback that includes setState.
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const result = await loadRepoFolderFromHash({ href })
        if (cancelled) return
        if (!result) {
          setState({ status: 'error', error: 'Not a github-repo folder share' })
          return
        }
        if (!result.entries.length) {
          setState({ status: 'empty', result })
          return
        }
        setState({ status: 'ready', result })
      } catch (e) {
        if (cancelled) return
        setState({ status: 'error', error: (e as Error).message || 'Failed to load folder' })
      }
    })()
    return () => { cancelled = true }
  }, [href, reloadKey])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setReloadKey((k) => k + 1)
  }, [])

  const repoLabel = state.result?.repo
    ? `${state.result.repo.owner}/${state.result.repo.name}` + (state.result.repo.path ? `:${state.result.repo.path}` : '')
    : 'Loading repository…'
  const displayName = state.result?.config?.displayName ?? repoLabel

  return (
    <div className="flex-1 flex items-stretch min-h-0 bg-white dark:bg-gray-950 sepia:bg-sepia-50">
      <div className="w-full max-w-2xl mx-auto px-6 py-8 overflow-y-auto">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold truncate text-gray-900 dark:text-gray-100 sepia:text-sepia-900">
              {displayName}
            </h1>
            {state.result?.config?.displayName && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">{repoLabel}</p>
            )}
          </div>
          <button
            onClick={reload}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
            aria-label="Reload"
            title="Reload"
          >
            <RefreshCw className="h-3 w-3" /> Reload
          </button>
        </header>

        {state.status === 'loading' && (
          <p className="text-sm text-gray-500">Listing files in {repoLabel}…</p>
        )}

        {state.status === 'error' && (
          <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950 p-3 rounded">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>Could not load folder: {state.error}</span>
          </div>
        )}

        {state.status === 'empty' && state.result && (
          <p className="text-sm text-gray-500">
            No <code className="text-xs">.md</code> files or sub-directories in this folder.
          </p>
        )}

        {state.status === 'ready' && state.result && (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800 sepia:divide-sepia-200 border border-gray-200 dark:border-gray-800 sepia:border-sepia-200 rounded-md overflow-hidden">
            {state.result.entries.map((e) => {
              const isDir = e.type === 'dir'
              const target = isDir
                ? state.result!.folderShareUrls[e.path]
                : state.result!.shareUrls[e.path]
              return (
                <li key={e.path}>
                  <button
                    onClick={() => isDir ? onOpenFolder(target) : onOpenFile(target)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-900 sepia:hover:bg-sepia-100 transition-colors"
                  >
                    {isDir
                      ? <Folder className="h-4 w-4 text-blue-500 flex-shrink-0" />
                      : <FileText className="h-4 w-4 text-gray-500 flex-shrink-0" />}
                    <span className="flex-1 truncate text-sm text-gray-900 dark:text-gray-100 sepia:text-sepia-900">
                      {e.name}
                    </span>
                    {isDir && <ChevronRight className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />}
                    {!isDir && (
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(ev) => ev.stopPropagation()}
                        className="text-gray-400 hover:text-gray-600"
                        aria-label="Open raw file in new tab"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
