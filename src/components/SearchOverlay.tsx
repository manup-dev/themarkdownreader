import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import { useStore } from '../store/useStore'

/**
 * In-document search overlay (Ctrl+K or /)
 * Finds and highlights text matches, navigates between them.
 */
export function SearchOverlay() {
  const markdown = useStore((s) => s.markdown)
  const viewMode = useStore((s) => s.viewMode)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<HTMLElement[]>([])
  const [currentMatch, setCurrentMatch] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Open on Ctrl+K or /
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(true)
      } else if (e.key === '/' && viewMode === 'read') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [viewMode])

  // Focus input when opened
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Search logic
  const doSearch = useCallback((q: string) => {
    // Clear previous highlights
    document.querySelectorAll('[data-search-highlight]').forEach((el) => {
      el.removeAttribute('data-search-highlight')
      ;(el as HTMLElement).style.background = ''
    })

    if (!q || q.length < 2) {
      setMatches([])
      setCurrentMatch(0)
      return
    }

    const article = document.querySelector('article')
    if (!article) return

    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
    const found: HTMLElement[] = []
    const lowerQ = q.toLowerCase()

    while (walker.nextNode()) {
      const node = walker.currentNode
      if (node.textContent?.toLowerCase().includes(lowerQ)) {
        const el = node.parentElement
        if (el && !el.closest('pre')) { // Don't highlight inside code blocks
          el.setAttribute('data-search-highlight', 'true')
          el.style.background = 'rgba(251, 191, 36, 0.3)'
          found.push(el)
        }
      }
    }

    setMatches(found)
    setCurrentMatch(0)
    if (found.length > 0) {
      found[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
      found[0].style.background = 'rgba(251, 191, 36, 0.6)'
    }
  }, [])

  const navigateMatch = useCallback((direction: 'prev' | 'next') => {
    if (matches.length === 0) return

    // Safety: check element is still in DOM before styling
    const cur = matches[currentMatch]
    if (cur?.isConnected) cur.style.setProperty('background', 'rgba(251, 191, 36, 0.3)')

    const next = direction === 'next'
      ? (currentMatch + 1) % matches.length
      : (currentMatch - 1 + matches.length) % matches.length

    setCurrentMatch(next)
    const nextEl = matches[next]
    if (nextEl?.isConnected) {
      nextEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      nextEl.style.setProperty('background', 'rgba(251, 191, 36, 0.6)')
    }
  }, [matches, currentMatch])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    document.querySelectorAll('[data-search-highlight]').forEach((el) => {
      el.removeAttribute('data-search-highlight')
      ;(el as HTMLElement).style.background = ''
    })
    setMatches([])
  }, [])

  if (!open || !markdown) return null

  const commands = [
    { label: 'Reader view', shortcut: 'Ctrl+1', action: () => { useStore.getState().setViewMode('read'); close() } },
    { label: 'Mind Map', shortcut: 'Ctrl+2', action: () => { useStore.getState().setViewMode('mindmap'); close() } },
    { label: 'Cards', shortcut: 'Ctrl+3', action: () => { useStore.getState().setViewMode('summary-cards'); close() } },
    { label: 'Treemap', shortcut: 'Ctrl+4', action: () => { useStore.getState().setViewMode('treemap'); close() } },
    { label: 'Knowledge Graph', shortcut: '', action: () => { useStore.getState().setViewMode('knowledge-graph'); close() } },
    { label: 'Coach', shortcut: '', action: () => { useStore.getState().setViewMode('coach'); close() } },
    { label: 'Toggle theme', shortcut: 't', action: () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 't' })); close() } },
    { label: 'Focus mode', shortcut: 'Ctrl+Shift+F', action: () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true })); close() } },
    { label: 'Print / Export PDF', shortcut: 'p', action: () => { close(); setTimeout(() => window.print(), 100) } },
  ]

  const showCommands = query.length === 0 && viewMode === 'read'
  const filteredCommands = query.length > 0 && query.startsWith('>')
    ? commands.filter((c) => c.label.toLowerCase().includes(query.slice(1).trim().toLowerCase()))
    : []

  return (
    <div className="fixed top-14 right-4 z-40 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl w-80 animate-scale-in">
      <div className="p-2 flex items-center gap-2">
        <Search className="h-4 w-4 text-gray-400 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (!e.target.value.startsWith('>')) doSearch(e.target.value) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (filteredCommands.length > 0) filteredCommands[0].action()
              else navigateMatch(e.shiftKey ? 'prev' : 'next')
            }
            if (e.key === 'Escape') close()
          }}
          placeholder={viewMode === 'read' ? 'Search or type > for commands...' : 'Search in document...'}
          className="flex-1 text-sm bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
        />
        {matches.length > 0 && (
          <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
            {currentMatch + 1}/{matches.length}
          </span>
        )}
        {matches.length === 0 && query.length >= 2 && !query.startsWith('>') && (
          <span className="text-[10px] text-gray-400 shrink-0">No matches</span>
        )}
        <button onClick={() => navigateMatch('prev')} className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors">
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => navigateMatch('next')} className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors">
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button onClick={close} className="p-0.5 text-gray-300 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-300 transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* Command palette when query is empty or starts with > */}
      {(showCommands || filteredCommands.length > 0) && (
        <div className="border-t border-gray-200 dark:border-gray-800 py-1 max-h-48 overflow-y-auto">
          {(filteredCommands.length > 0 ? filteredCommands : commands).map((cmd) => (
            <button
              key={cmd.label}
              onClick={cmd.action}
              className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <span>{cmd.label}</span>
              {cmd.shortcut && <kbd className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1 rounded">{cmd.shortcut}</kbd>}
            </button>
          ))}
          {showCommands && <p className="px-3 py-1 text-[10px] text-gray-300 dark:text-gray-600">Type &gt; for commands, or search text</p>}
        </div>
      )}
    </div>
  )
}
