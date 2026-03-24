import { useEffect, useRef, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { chunkMarkdown, wordCount } from '../lib/markdown'

export function TableOfContents() {
  const toc = useStore((s) => s.toc)
  const markdown = useStore((s) => s.markdown)
  const activeSection = useStore((s) => s.activeSection)
  const activeDocId = useStore((s) => s.activeDocId)
  const activeRef = useRef<HTMLAnchorElement>(null)
  const bookmarkKey = `md-reader-bookmarks-${activeDocId ?? 'unsaved'}`
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(bookmarkKey)
    return saved ? new Set(JSON.parse(saved)) : new Set()
  })
  // Reset bookmarks when document changes
  useEffect(() => {
    const saved = localStorage.getItem(bookmarkKey)
    setBookmarks(saved ? new Set(JSON.parse(saved)) : new Set())
  }, [bookmarkKey])
  const toggleBookmark = (id: string) => {
    setBookmarks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(bookmarkKey, JSON.stringify([...next]))
      return next
    })
  }

  const activeIdx = toc.findIndex((t) => t.id === activeSection)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeSection])

  // Memoize expensive chunk + word count computation
  const sectionWords = useMemo(() => {
    const chunks = chunkMarkdown(markdown)
    const map = new Map<string, number>()
    for (const entry of toc) {
      const matching = chunks.filter((c) => c.sectionPath.includes(entry.text))
      const words = matching.reduce((sum, c) => sum + wordCount(c.text), 0)
      map.set(entry.id, words)
    }
    return map
  }, [markdown, toc])

  if (toc.length === 0) return null

  return (
    <nav className="space-y-0.5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3 px-2">
        Contents
      </h3>
      {toc.map((entry, entryIdx) => {
        const words = sectionWords.get(entry.id) ?? 0
        const mins = Math.max(1, Math.ceil(words / 230))
        const isActive = activeSection === entry.id
        const isRead = activeIdx > entryIdx

        return (
          <a
            key={entry.id}
            ref={isActive ? activeRef : null}
            href={`#${entry.id}`}
            onClick={(e) => {
              e.preventDefault()
              document.getElementById(entry.id)?.scrollIntoView({ behavior: 'smooth' })
            }}
            className={`flex items-center justify-between text-sm py-1 px-2 rounded transition-colors group ${
              isActive
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 font-medium'
                : isRead
                  ? 'text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
            style={{ paddingLeft: `${(entry.level - 1) * 12 + 8}px` }}
            title={words > 0 ? `${entry.text} — ${mins}m read (${words} words)` : entry.text}
          >
            <span className="truncate flex items-center gap-1.5">
              {isRead && !isActive && <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />}
              {bookmarks.has(entry.id) && <span className="text-amber-400 shrink-0 text-[10px]">★</span>}
              {entry.text}
            </span>
            {entry.level <= 2 && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleBookmark(entry.id) }}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-amber-400 shrink-0 ml-1"
                title={bookmarks.has(entry.id) ? 'Remove bookmark' : 'Bookmark this section'}
              >
                <span className="text-[10px]">{bookmarks.has(entry.id) ? '★' : '☆'}</span>
              </button>
            )}
            {entry.level <= 2 && words > 0 && (
              <span className="flex items-center gap-1 shrink-0 ml-2">
                {words < 50 && <span className="w-1.5 h-1.5 rounded-full bg-green-400" title="Quick read" />}
                {words >= 50 && words < 150 && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Medium section" />}
                <span className="text-[10px] text-gray-300 dark:text-gray-600 tabular-nums">
                  {mins}m
                </span>
              </span>
            )}
          </a>
        )
      })}
      {/* Reading streak */}
      {(() => {
        const streak = parseInt(localStorage.getItem('md-reader-streak') ?? '0')
        return streak > 0 ? (
          <div className="mt-3 px-2 text-[10px] text-amber-500 flex items-center gap-1">
            <span>{streak}-day streak</span>
          </div>
        ) : null
      })()}
      {/* Document metadata */}
      <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800 px-2 space-y-1">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider">Document</p>
        <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-400">
          <span>{toc.length} sections</span>
          <span>{(() => { const w = markdown.split(/\s+/).filter(Boolean).length; return `${w.toLocaleString()} words` })()}</span>
          <span>{Math.max(1, Math.ceil(markdown.split(/\s+/).filter(Boolean).length / 230))}m read</span>
          <span>{(markdown.match(/```/g) ?? []).length / 2 | 0} code blocks</span>
        </div>
      </div>
    </nav>
  )
}
