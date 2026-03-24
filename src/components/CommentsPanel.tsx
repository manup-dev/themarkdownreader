import { useState, useEffect, useCallback } from 'react'
import { X, Check, Trash2, Download, ExternalLink, Eye, EyeOff } from 'lucide-react'
import { useStore } from '../store/useStore'
import { getComments, updateComment, removeComment, type Comment } from '../lib/docstore'

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function CommentsPanel({ onClose }: { onClose: () => void }) {
  const activeDocId = useStore((s) => s.activeDocId)
  const toc = useStore((s) => s.toc)
  const [comments, setComments] = useState<Comment[]>([])
  const [showResolved, setShowResolved] = useState(false)
  const [username, setUsername] = useState(() => localStorage.getItem('md-reader-username') || 'You')

  const refresh = useCallback(async () => {
    if (!activeDocId) return
    setComments(await getComments(activeDocId))
  }, [activeDocId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh() }, [refresh])

  // Re-poll every 3s for new comments (e.g., from selection menu)
  useEffect(() => {
    const interval = setInterval(refresh, 3000)
    return () => clearInterval(interval)
  }, [refresh])

  const handleUsernameChange = useCallback((name: string) => {
    setUsername(name)
    localStorage.setItem('md-reader-username', name)
  }, [])

  const handleResolve = useCallback(async (id: number, resolved: boolean) => {
    await updateComment(id, { resolved: !resolved })
    await refresh()
  }, [refresh])

  const handleDelete = useCallback(async (id: number) => {
    if (!window.confirm('Delete this comment?')) return
    await removeComment(id)
    await refresh()
  }, [refresh])

  const handleJumpTo = useCallback((sectionId: string) => {
    useStore.getState().setViewMode('read')
    setTimeout(() => {
      const el = document.getElementById(sectionId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        el.style.background = '#bfdbfe'
        setTimeout(() => { el.style.background = '' }, 2000)
      }
    }, 200)
  }, [])

  const handleExport = useCallback(() => {
    if (comments.length === 0) return
    const fileName = useStore.getState().fileName ?? 'Document'
    const lines = [`# Comments on ${fileName}\n`]
    for (const c of comments) {
      lines.push(`## ${c.author} — ${new Date(c.createdAt).toLocaleString()}${c.resolved ? ' [RESOLVED]' : ''}`)
      if (c.selectedText) lines.push(`> ${c.selectedText.slice(0, 200)}`)
      lines.push(`\n${c.comment}\n`)
      const section = toc.find((t) => t.id === c.sectionId)
      if (section) lines.push(`*Section: ${section.text}*\n`)
      lines.push('---\n')
    }
    lines.push('\n---')
    lines.push('*Exported with [md-reader](https://github.com/manup-dev/themarkdownreader)*')
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${fileName.replace(/\.md$/, '')}-comments.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [comments, toc])

  const filtered = showResolved ? comments : comments.filter((c) => !c.resolved)
  const resolvedCount = comments.filter((c) => c.resolved).length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400">
            Comments ({comments.length})
          </h3>
          <div className="flex items-center gap-1">
            {comments.length > 0 && (
              <button
                onClick={handleExport}
                className="p-1 text-gray-300 hover:text-blue-400 transition-colors rounded"
                title="Export comments as markdown"
              >
                <Download className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors rounded"
              title="Close comments"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Author name input */}
        <div className="mt-2 flex items-center gap-2">
          <label className="text-[10px] text-gray-400 shrink-0">Your name:</label>
          <input
            type="text"
            value={username}
            onChange={(e) => handleUsernameChange(e.target.value)}
            className="flex-1 text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-transparent text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-teal-500"
            placeholder="Your name"
          />
        </div>

        {/* Filter */}
        {resolvedCount > 0 && (
          <label className="flex items-center gap-1.5 mt-2 text-[11px] text-gray-500 dark:text-gray-400 cursor-pointer">
            {showResolved ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
              className="sr-only"
            />
            {showResolved ? 'Showing resolved' : `Show resolved (${resolvedCount})`}
          </label>
        )}
      </div>

      {/* Comments list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {filtered.length === 0 && (
          <div className="text-center py-8 space-y-2">
            <p className="text-sm text-gray-400">
              {comments.length === 0
                ? 'No comments yet.'
                : 'All comments are resolved.'}
            </p>
            <p className="text-xs text-gray-400">
              Select text and click the comment icon to start.
            </p>
          </div>
        )}

        {filtered.map((c) => {
          const section = toc.find((t) => t.id === c.sectionId)
          return (
            <div
              key={c.id}
              className={`rounded-lg border border-gray-100 dark:border-gray-800 p-2.5 space-y-1.5 ${
                c.resolved ? 'opacity-60' : ''
              }`}
            >
              {/* Author + time */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {c.author}
                </span>
                <span className="text-[10px] text-gray-400">
                  {timeAgo(c.createdAt)}
                </span>
              </div>

              {/* Quoted text */}
              {c.selectedText && (
                <div className="border-l-2 border-blue-400 pl-2">
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 italic line-clamp-2">
                    {c.selectedText.slice(0, 80)}{c.selectedText.length > 80 ? '...' : ''}
                  </p>
                </div>
              )}

              {/* Comment text */}
              <p className={`text-xs text-gray-800 dark:text-gray-200 leading-relaxed ${c.resolved ? 'line-through' : ''}`}>
                {c.comment}
              </p>

              {/* Section badge */}
              {section && (
                <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  {section.text}
                </span>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => handleResolve(c.id!, c.resolved)}
                  className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                    c.resolved
                      ? 'text-amber-600 hover:text-amber-700 bg-amber-50 dark:bg-amber-950/30'
                      : 'text-green-600 hover:text-green-700 bg-green-50 dark:bg-green-950/30'
                  }`}
                  title={c.resolved ? 'Unresolve' : 'Resolve'}
                >
                  <Check className="h-3 w-3" />
                  {c.resolved ? 'Unresolve' : 'Resolve'}
                </button>

                {section && (
                  <button
                    onClick={() => handleJumpTo(c.sectionId)}
                    className="flex items-center gap-0.5 text-[10px] text-blue-500 hover:text-blue-700 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/30 transition-colors"
                    title="Jump to section"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Jump to
                  </button>
                )}

                <button
                  onClick={() => handleDelete(c.id!)}
                  className="flex items-center gap-0.5 text-[10px] text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors ml-auto"
                  title="Delete comment"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
