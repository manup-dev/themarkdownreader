import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Check, Trash2, Download, ExternalLink, Eye, EyeOff, Wand2, MoreHorizontal, Pencil } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useAdapter } from '../provider/hooks'
import type { Comment } from '../types/storage-adapter'
import { trackEvent } from '../lib/telemetry'
import { markProgrammaticScroll } from '../lib/scroll-guard'
import { PromptBuilder } from './PromptBuilder'

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
  const [showPromptBuilder, setShowPromptBuilder] = useState(false)
  const [username, setUsername] = useState(() => localStorage.getItem('md-reader-username') || 'You')
  const [editingName, setEditingName] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const jumpTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const adapter = useAdapter()

  const refresh = useCallback(async () => {
    if (!activeDocId) return
    setComments(await adapter.getComments(activeDocId))
  }, [activeDocId, adapter])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh() }, [refresh])

  // Refresh on CustomEvent instead of polling — the SelectionMenu and
  // Reader dispatch 'md-reader-comment-changed' on every add/edit/delete.
  useEffect(() => {
    const onChanged = () => refresh()
    window.addEventListener('md-reader-comment-changed', onChanged)
    return () => window.removeEventListener('md-reader-comment-changed', onChanged)
  }, [refresh])

  const handleUsernameChange = useCallback((name: string) => {
    setUsername(name)
    localStorage.setItem('md-reader-username', name)
  }, [])

  // Close the per-card overflow menu when clicking anywhere outside it
  useEffect(() => {
    if (openMenuId == null) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-comment-overflow]')) setOpenMenuId(null)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [openMenuId])

  const handleResolve = useCallback(async (id: number, resolved: boolean) => {
    await adapter.updateComment(id, { resolved: !resolved })
    await refresh()
  }, [refresh, adapter])

  const handleDelete = useCallback(async (id: number) => {
    if (!window.confirm('Delete this comment?')) return
    await adapter.removeComment(id)
    await refresh()
  }, [refresh, adapter])

  const handleJumpTo = useCallback((comment: Comment) => {
    useStore.getState().setViewMode('read')
    markProgrammaticScroll(2500)
    // Cancel any in-flight retries from a previous jump
    for (const t of jumpTimersRef.current) clearTimeout(t)
    jumpTimersRef.current = []

    const tryJump = (attempt: number) => {
      const span = comment.id != null
        ? (document.querySelector(`[data-comment-highlight="${comment.id}"]`) as HTMLElement | null)
        : null
      if (span) {
        span.scrollIntoView({ behavior: 'smooth', block: 'center' })
        const prev = span.style.outline
        span.style.outline = '2px solid #2dd4bf'
        span.style.outlineOffset = '2px'
        const t = setTimeout(() => { span.style.outline = prev }, 1600)
        jumpTimersRef.current.push(t)
        return true
      }
      if (attempt < 8) {
        const t = setTimeout(() => tryJump(attempt + 1), 120)
        jumpTimersRef.current.push(t)
        return false
      }
      const el = comment.sectionId ? document.getElementById(comment.sectionId) : null
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        el.style.background = document.documentElement.classList.contains('sepia') ? '#e8d5be' : '#bfdbfe'
        const t = setTimeout(() => { el.style.background = '' }, 2000)
        jumpTimersRef.current.push(t)
      }
      return false
    }
    const initial = setTimeout(() => tryJump(0), 50)
    jumpTimersRef.current.push(initial)
  }, [])

  // Clean up jump timers on unmount so stale timeouts don't fire after panel closes
  useEffect(() => {
    return () => { for (const t of jumpTimersRef.current) clearTimeout(t) }
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

  if (showPromptBuilder) {
    return <PromptBuilder comments={comments} onClose={() => setShowPromptBuilder(false)} />
  }

  // Compute a 1-2 character avatar initials from the username
  const initials = (username || 'You').trim().split(/\s+/).map((s) => s[0]?.toUpperCase()).filter(Boolean).slice(0, 2).join('') || 'Y'

  return (
    <div ref={panelRef} className="flex flex-col h-full">
      {/* Header — compact; Your-name is now an avatar chip that expands on click */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
            Comments
            <span className="text-[11px] font-normal text-gray-400">({comments.length})</span>
          </h3>
          <div className="flex items-center gap-1">
            {/* Your-name avatar chip: click to edit inline */}
            {editingName ? (
              <input
                type="text"
                value={username}
                autoFocus
                onChange={(e) => handleUsernameChange(e.target.value)}
                onBlur={() => setEditingName(false)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingName(false) }}
                className="w-24 text-xs px-2 py-0.5 rounded border border-teal-300 dark:border-teal-700 bg-transparent text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-teal-500"
                placeholder="Your name"
                aria-label="Your display name"
                data-testid="username-input"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/30 hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors"
                title={`Signed in as "${username}" — click to change`}
                aria-label={`Edit display name (${username})`}
                data-testid="username-chip"
              >
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-teal-500 text-white text-[9px] font-bold">
                  {initials}
                </span>
                <Pencil className="h-2.5 w-2.5 text-teal-600 dark:text-teal-400 opacity-60" />
              </button>
            )}
            {comments.length > 0 && (
              <>
                <button
                  onClick={() => { setShowPromptBuilder(true); trackEvent('prompt_builder_opened') }}
                  className="p-1 text-gray-400 hover:text-teal-500 transition-colors rounded"
                  title="Generate AI prompt from comments"
                  aria-label="Generate AI prompt from comments"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleExport}
                  className="p-1 text-gray-400 hover:text-blue-500 transition-colors rounded"
                  title="Export comments as markdown"
                  aria-label="Export comments"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors rounded"
              title="Close comments"
              aria-label="Close comments panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
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

              {/* Quoted text — click to jump to the exact highlighted passage */}
              {c.selectedText && (
                <button
                  type="button"
                  onClick={() => handleJumpTo(c)}
                  className="block w-full text-left border-l-2 border-blue-400 pl-2 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 rounded-r transition-colors cursor-pointer"
                  title="Jump to this passage"
                  data-testid="comment-quote-jump"
                >
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 italic line-clamp-2">
                    {c.selectedText.slice(0, 80)}{c.selectedText.length > 80 ? '...' : ''}
                  </p>
                </button>
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

              {/* Actions — icon-only, Delete moved behind the overflow menu */}
              <div className="flex items-center gap-0.5 pt-1">
                <button
                  onClick={() => handleJumpTo(c)}
                  className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded transition-colors"
                  title={c.selectedText ? 'Jump to highlighted text' : 'Jump to section'}
                  aria-label={c.selectedText ? 'Jump to highlighted text' : 'Jump to section'}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>

                <button
                  onClick={() => handleResolve(c.id!, c.resolved)}
                  className={`p-1 rounded transition-colors ${
                    c.resolved
                      ? 'text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                      : 'text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30'
                  }`}
                  title={c.resolved ? 'Unresolve comment' : 'Resolve comment'}
                  aria-label={c.resolved ? 'Unresolve comment' : 'Resolve comment'}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>

                {/* Overflow menu — houses destructive/rare actions like Delete */}
                <div className="relative ml-auto" data-comment-overflow>
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === c.id ? null : c.id!) }}
                    className={`p-1 rounded transition-colors ${openMenuId === c.id ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                    title="More actions"
                    aria-label="More actions"
                    aria-haspopup="menu"
                    aria-expanded={openMenuId === c.id}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                  {openMenuId === c.id && (
                    <div
                      role="menu"
                      className="absolute right-0 top-full mt-1 z-20 w-36 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-xl py-1"
                      data-comment-overflow
                    >
                      <button
                        role="menuitem"
                        onClick={() => { setOpenMenuId(null); handleDelete(c.id!) }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete comment
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
