import { useEffect, useRef, useMemo, useState, useCallback } from 'react'
import { useStore } from '../store/useStore'
import { chunkMarkdown, wordCount } from '../lib/markdown'
import { checkOllamaHealth, summarizeSection } from '../lib/ai'

export function TableOfContents() {
  const toc = useStore((s) => s.toc)
  const markdown = useStore((s) => s.markdown)
  const activeSection = useStore((s) => s.activeSection)
  const activeDocId = useStore((s) => s.activeDocId)
  const activeRef = useRef<HTMLAnchorElement>(null)

  // Feature 16: Live countdown for active section
  const [countdownLeft, setCountdownLeft] = useState<string | null>(null)
  const wpm = parseInt(localStorage.getItem('md-reader-wpm') ?? '230')
  const bookmarkKey = `md-reader-bookmarks-${activeDocId ?? 'unsaved'}`
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(bookmarkKey)
    return saved ? new Set(JSON.parse(saved)) : new Set()
  })
  // Reset bookmarks when document changes — adjusting state during render (React recommended pattern)
  const [prevBookmarkKey, setPrevBookmarkKey] = useState(bookmarkKey)
  if (prevBookmarkKey !== bookmarkKey) {
    setPrevBookmarkKey(bookmarkKey)
    const saved = localStorage.getItem(bookmarkKey)
    setBookmarks(saved ? new Set(JSON.parse(saved)) : new Set())
  }
  const toggleBookmark = (id: string) => {
    const isAdding = !bookmarks.has(id)
    setBookmarks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(bookmarkKey, JSON.stringify([...next]))
      return next
    })
    // Delight #14: Generate AI note for new bookmarks
    if (isAdding) {
      const entry = toc.find((t) => t.id === id)
      if (entry) {
        const lines = markdown.split('\n')
        const headingPattern = new RegExp(`^#{1,6}\\s+${entry.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)
        const startIdx = lines.findIndex((l) => headingPattern.test(l))
        if (startIdx >= 0) {
          let endIdx = lines.length
          for (let j = startIdx + 1; j < lines.length; j++) {
            if (/^#{1,6}\s/.test(lines[j])) { endIdx = j; break }
          }
          const sectionText = lines.slice(startIdx, endIdx).join('\n')
          generateBookmarkNote(id, sectionText)
        }
      }
    }
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

  // Feature 16: Live countdown — update every 5s based on scroll progress within section
  useEffect(() => {
    const update = () => {
      if (!activeSection) { setCountdownLeft(null); return }
      const heading = document.getElementById(activeSection)
      if (!heading) return
      const activeIdx = toc.findIndex((t) => t.id === activeSection)
      const nextHeading = activeIdx < toc.length - 1 ? document.getElementById(toc[activeIdx + 1].id) : null
      const sectionTop = heading.offsetTop
      const sectionBottom = nextHeading ? nextHeading.offsetTop : (heading.closest('article')?.scrollHeight ?? sectionTop + 500)
      const sectionHeight = sectionBottom - sectionTop
      const reader = heading.closest('[class*="overflow-y-auto"]') as HTMLElement | null
      if (!reader) return
      const scrollPos = reader.scrollTop + 100
      const progressInSection = Math.max(0, Math.min(1, (scrollPos - sectionTop) / Math.max(1, sectionHeight)))
      const totalWords = sectionWords.get(activeSection) ?? 0
      const remainingWords = Math.max(0, totalWords * (1 - progressInSection))
      const minsLeft = remainingWords / wpm
      if (minsLeft < 0.1) { setCountdownLeft(null); return }
      setCountdownLeft(minsLeft < 1 ? `~${Math.ceil(minsLeft * 60)}s left` : `~${minsLeft.toFixed(1)}m left`)
    }
    update()
    const interval = setInterval(update, 5000)
    return () => clearInterval(interval)
  }, [activeSection, toc, sectionWords, wpm])

  // Delight #13: Section difficulty micro-badges
  const sectionDifficulty = useMemo(() => {
    const map = new Map<string, 'easy' | 'moderate' | 'dense'>()
    const lines = markdown.split('\n')
    for (let ti = 0; ti < toc.length; ti++) {
      const entry = toc[ti]
      // Find section text between this heading and the next
      const headingPattern = new RegExp(`^#{1,6}\\s+${entry.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)
      const startIdx = lines.findIndex((l) => headingPattern.test(l))
      if (startIdx < 0) { map.set(entry.id, 'easy'); continue }
      let endIdx = lines.length
      for (let j = startIdx + 1; j < lines.length; j++) {
        if (/^#{1,6}\s/.test(lines[j])) { endIdx = j; break }
      }
      const sectionText = lines.slice(startIdx + 1, endIdx).join('\n')
      // Score factors
      const codeBlocks = (sectionText.match(/```/g) ?? []).length / 2
      const capsWords = (sectionText.match(/\b[A-Z_]{3,}\b/g) ?? []).length
      const linkCount = (sectionText.match(/\[.*?\]\(.*?\)/g) ?? []).length
      const words = sectionText.split(/\s+/).filter(Boolean)
      const avgWordLen = words.length > 0 ? words.reduce((s, w) => s + w.length, 0) / words.length : 0
      const score = codeBlocks * 3 + capsWords * 1.5 + linkCount * 0.5 + (avgWordLen > 6 ? 2 : 0)
      map.set(entry.id, score >= 8 ? 'dense' : score >= 3 ? 'moderate' : 'easy')
    }
    return map
  }, [markdown, toc])

  // Delight #14: AI-generated bookmark notes
  const notesKey = `md-reader-bookmark-notes-${activeDocId ?? 'unsaved'}`
  const [bookmarkNotes, setBookmarkNotes] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(notesKey) ?? '{}') } catch { return {} }
  })
  const [prevNotesKey, setPrevNotesKey] = useState(notesKey)
  if (prevNotesKey !== notesKey) {
    setPrevNotesKey(notesKey)
    try { setBookmarkNotes(JSON.parse(localStorage.getItem(notesKey) ?? '{}')) } catch { setBookmarkNotes({}) }
  }

  const generateBookmarkNote = useCallback(async (sectionId: string, sectionText: string) => {
    try {
      const healthy = await checkOllamaHealth()
      if (!healthy) return
      const note = await summarizeSection(sectionText.slice(0, 1500))
      const trimmed = note.slice(0, 200)
      setBookmarkNotes((prev) => {
        const next = { ...prev, [sectionId]: trimmed }
        localStorage.setItem(notesKey, JSON.stringify(next))
        return next
      })
    } catch { /* AI not available, skip note */ }
  }, [notesKey])

  if (toc.length === 0) return null

  return (
    <nav className="space-y-0.5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3 px-2">
        Contents
      </h3>
      {/* Document coverage */}
      {(() => {
        if (!activeDocId) return null
        const read = JSON.parse(localStorage.getItem(`md-reader-sections-read-${activeDocId}`) ?? '[]') as string[]
        const coverage = toc.length > 0 ? Math.round((read.length / toc.length) * 100) : 0
        if (coverage === 0) return null
        return (
          <div className="mb-2 px-2">
            <div className="flex items-center justify-between text-[9px] text-gray-400 mb-0.5">
              <span>{coverage}% sections visited</span>
              <span>{read.length}/{toc.length}</span>
            </div>
            <div className="h-1 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${coverage}%` }} />
            </div>
          </div>
        )
      })()}
      {/* Sections with most time spent */}
      {(() => {
        if (!activeDocId) return null
        const times = JSON.parse(localStorage.getItem(`md-reader-section-time-${activeDocId}`) ?? '{}') as Record<string, number>
        const sorted = Object.entries(times).sort((a, b) => b[1] - a[1]).slice(0, 2)
        if (sorted.length === 0) return null
        return (
          <div className="mb-2 px-2">
            <p className="text-[9px] text-gray-400 mb-1">Most time spent</p>
            {sorted.map(([id, secs]) => {
              const entry = toc.find((t) => t.id === id)
              if (!entry) return null
              return (
                <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }) }}
                  className="block text-[10px] text-amber-500 hover:text-amber-600 truncate py-0.5"
                >
                  {'\u23F1'} {entry.text} ({Math.round(secs / 60)}m)
                </a>
              )
            })}
          </div>
        )
      })()}
      {toc.map((entry, entryIdx) => {
        const words = sectionWords.get(entry.id) ?? 0
        const mins = Math.max(1, Math.ceil(words / 230))
        const isActive = activeSection === entry.id
        const isRead = activeIdx > entryIdx

        // Smart collapse: hide deep sections unless they're near the active section
        const activeEntry = toc.find((t) => t.id === activeSection)
        const isTopLevel = entry.level <= 2
        const isNearActive = activeIdx >= 0 && Math.abs(entryIdx - activeIdx) <= 3
        const isChildOfActive = activeEntry && entry.level > activeEntry.level && entryIdx > activeIdx && (entryIdx === activeIdx + 1 || toc.slice(activeIdx + 1, entryIdx).every((t) => t.level > activeEntry.level))
        const isVisible = isTopLevel || isNearActive || isChildOfActive || isActive || isRead
        if (!isVisible && toc.length > 15) return null

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
            title={(() => {
              const times = activeDocId ? JSON.parse(localStorage.getItem(`md-reader-section-time-${activeDocId}`) ?? '{}') : {}
              const spent = times[entry.id] ? `${Math.round(times[entry.id] / 60)}m spent` : ''
              return words > 0 ? `${entry.text} — ${mins}m read (${words} words)${spent ? ` · ${spent}` : ''}` : entry.text
            })()}
          >
            <span className="truncate flex items-center gap-1.5">
              {isRead && !isActive && <span className="w-1 h-1 rounded-full bg-green-400 shrink-0" />}
              {/* Delight #13: Difficulty micro-badge — small dot with tooltip */}
              {(() => {
                const diff = sectionDifficulty.get(entry.id)
                if (!diff) return null
                const color = diff === 'easy' ? 'bg-green-400' : diff === 'moderate' ? 'bg-amber-400' : 'bg-red-400'
                const label = diff === 'easy' ? 'Easy section' : diff === 'moderate' ? 'Moderate section' : 'Dense section'
                return <span className={`w-1.5 h-1.5 rounded-full ${color} shrink-0`} title={label} />
              })()}
              {bookmarks.has(entry.id) && (
                <span
                  className="text-amber-400 shrink-0 text-[10px] cursor-help"
                  title={bookmarkNotes[entry.id] ?? 'Bookmarked'}
                >★</span>
              )}
              {entry.text}
            </span>
            {/* Bookmark button — only visible on hover */}
            {entry.level <= 2 && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleBookmark(entry.id) }}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-amber-400 shrink-0 ml-1"
                title={bookmarks.has(entry.id) ? 'Remove bookmark' : 'Bookmark this section'}
              >
                <span className="text-[10px]">{bookmarks.has(entry.id) ? '★' : '☆'}</span>
              </button>
            )}
            {/* Reading time — only visible on hover */}
            {entry.level <= 2 && words > 0 && (
              <span className="flex items-center gap-1 shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {isActive && countdownLeft ? (
                  <span className="text-[10px] text-blue-500 dark:text-blue-400 tabular-nums animate-pulse-subtle">
                    {countdownLeft}
                  </span>
                ) : (
                  <span className="text-[10px] text-gray-300 dark:text-gray-600 tabular-nums">
                    {mins}m
                  </span>
                )}
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
      {/* Figures: code blocks + tables */}
      {(() => {
        const figures: Array<{type: string; label: string; id: string}> = []
        const codeBlocks = markdown.match(/```(\w+)?[^\n]*\n/g) ?? []
        codeBlocks.forEach((cb, i) => {
          const lang = cb.match(/```(\w+)/)?.[1] ?? 'code'
          figures.push({ type: 'code', label: `Code: ${lang}`, id: `code-${i}` })
        })
        const tables = markdown.match(/^\|.+\|$/gm) ?? []
        if (tables.length > 0) {
          const tableCount = markdown.split(/^\|[-:| ]+\|$/m).length - 1
          for (let i = 0; i < Math.min(tableCount, 5); i++) {
            figures.push({ type: 'table', label: `Table ${i + 1}`, id: `table-${i}` })
          }
        }
        if (figures.length === 0) return null
        return (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-800 px-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Figures</p>
            <div className="space-y-0.5">
              {figures.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    const els = document.querySelectorAll(f.type === 'code' ? 'pre' : 'table')
                    const idx = parseInt(f.id.split('-')[1])
                    els[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }}
                  className="w-full text-left text-[10px] text-gray-500 hover:text-blue-500 px-1 py-0.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors truncate"
                >
                  {f.type === 'code' ? '\u2328\uFE0F' : '\uD83D\uDCCA'} {f.label}
                </button>
              ))}
            </div>
          </div>
        )
      })()}
    </nav>
  )
}
