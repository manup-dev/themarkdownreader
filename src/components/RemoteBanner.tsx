import { useCallback, useState, lazy, Suspense } from 'react'
import { ExternalLink, GitFork, AlertTriangle, X, GitPullRequest } from 'lucide-react'
import { useStore } from '../store/useStore'

const ProposeChangesDialog = lazy(() => import('./ProposeChangesDialog').then((m) => ({ default: m.ProposeChangesDialog })))

/**
 * Banner shown at the top of the reader when the current doc was loaded
 * from a share URL. Surfaces provenance, highlight/comment counts, and a
 * Fork control. Auto-hides when the remoteShare store slice is null.
 *
 * "Fork" in this project means: the user is now editing locally, and
 * their edits will not flow back upstream — we just clear the banner so
 * the doc behaves like any other local document.
 */
export function RemoteBanner() {
  const remoteShare = useStore((s) => s.remoteShare)
  const setRemoteShare = useStore((s) => s.setRemoteShare)
  const [proposeOpen, setProposeOpen] = useState(false)

  const handleFork = useCallback(() => {
    if (!remoteShare) return
    setRemoteShare({ ...remoteShare, forked: true })
    // Clear the banner after a short beat so the user sees the state change.
    setTimeout(() => setRemoteShare(null), 600)
  }, [remoteShare, setRemoteShare])

  const handleDismiss = useCallback(() => setRemoteShare(null), [setRemoteShare])

  if (!remoteShare) return null

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs border-b border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950 sepia:bg-sepia-100 text-blue-900 dark:text-blue-100"
    >
      <span className="font-medium">
        Reading {remoteShare.createdBy ? <>a shared version by <span>{remoteShare.createdBy}</span></> : 'a shared version'}
      </span>
      <span className="text-blue-700 dark:text-blue-300">
        · {remoteShare.highlightCount} highlight{remoteShare.highlightCount === 1 ? '' : 's'}
        {', '}{remoteShare.commentCount} comment{remoteShare.commentCount === 1 ? '' : 's'}
      </span>
      {remoteShare.driftWarning && (
        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          document changed since share was created
        </span>
      )}
      <a
        href={remoteShare.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 underline hover:no-underline"
      >
        <ExternalLink className="h-3 w-3" /> source
      </a>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => setProposeOpen(true)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-blue-300 dark:border-blue-800 bg-white dark:bg-blue-900 hover:bg-blue-100 dark:hover:bg-blue-800"
          title="Diff your changes against the share and copy a PR body"
        >
          <GitPullRequest className="h-3 w-3" /> Propose
        </button>
        {!remoteShare.forked && (
          <button
            onClick={handleFork}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-blue-300 dark:border-blue-800 bg-white dark:bg-blue-900 hover:bg-blue-100 dark:hover:bg-blue-800"
            title="Fork: your edits stay local"
          >
            <GitFork className="h-3 w-3" /> Fork
          </button>
        )}
        <button
          onClick={handleDismiss}
          className="p-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900"
          aria-label="Dismiss banner"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <Suspense fallback={null}>
        {proposeOpen && (
          <ProposeChangesDialog
            open={proposeOpen}
            onClose={() => setProposeOpen(false)}
          />
        )}
      </Suspense>
    </div>
  )
}
