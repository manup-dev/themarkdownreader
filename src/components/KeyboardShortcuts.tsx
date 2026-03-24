import { useEffect, useState, useRef } from 'react'
import { useStore } from '../store/useStore'

const SHORTCUTS = [
  { key: 'j', desc: 'Next section' },
  { key: 'k', desc: 'Previous section' },
  { key: '/', desc: 'Search in document' },
  { key: 'Ctrl+K', desc: 'Search in document' },
  { key: 'Ctrl+1', desc: 'Reader view' },
  { key: 'Ctrl+2', desc: 'Mind Map view' },
  { key: 'Ctrl+3', desc: 'Cards view' },
  { key: 'Ctrl+4', desc: 'Treemap view' },
  { key: 'f', desc: 'Toggle focus mode' },
  { key: 't', desc: 'Cycle theme (light/dark/sepia/hc)' },
  { key: 'G', desc: 'Jump to bottom' },
  { key: 'gg', desc: 'Jump to top' },
  { key: 'Esc', desc: 'Close panel / exit focus' },
  { key: 'p', desc: 'Print / Export PDF' },
  { key: 'Ctrl+B', desc: 'Bookmark current section' },
  { key: 'm', desc: 'Toggle chat button' },
  { key: '?', desc: 'Show this help' },
]

export function KeyboardShortcuts() {
  const toc = useStore((s) => s.toc)
  const activeSection = useStore((s) => s.activeSection)
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const [showHelp, setShowHelp] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const lastKeyRef = useRef({ key: '', time: 0 })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      switch (e.key) {
        case 'j': {
          if (viewMode !== 'read') return
          const idx = toc.findIndex((t) => t.id === activeSection)
          const next = toc[idx + 1]
          if (next) document.getElementById(next.id)?.scrollIntoView({ behavior: 'smooth' })
          break
        }
        case 'k': {
          if (viewMode !== 'read') return
          const idx = toc.findIndex((t) => t.id === activeSection)
          const prev = toc[Math.max(0, idx - 1)]
          if (prev) document.getElementById(prev.id)?.scrollIntoView({ behavior: 'smooth' })
          break
        }
        case '?': {
          e.preventDefault()
          setShowHelp((s) => !s)
          break
        }
        case 'f': {
          if (e.ctrlKey || e.metaKey) return
          setFocusMode((s) => !s)
          break
        }
        case 't': {
          if (e.ctrlKey || e.metaKey) return
          const themes: Array<'light' | 'dark' | 'sepia' | 'high-contrast'> = ['light', 'dark', 'sepia', 'high-contrast']
          const next = themes[(themes.indexOf(theme) + 1) % themes.length]
          setTheme(next)
          break
        }
        case 'p': {
          if (e.ctrlKey || e.metaKey) return
          e.preventDefault()
          window.print()
          break
        }
        case 'b': {
          if (!e.ctrlKey && !e.metaKey) return
          e.preventDefault()
          if (!activeSection) return
          const key = `md-reader-bookmarks-${useStore.getState().activeDocId ?? 'unsaved'}`
          const saved = localStorage.getItem(key)
          const set = saved ? new Set(JSON.parse(saved)) : new Set()
          if (set.has(activeSection)) set.delete(activeSection)
          else set.add(activeSection)
          localStorage.setItem(key, JSON.stringify([...set]))
          // Visual feedback
          const el = document.getElementById(activeSection)
          if (el) {
            el.style.transition = 'background 300ms'
            el.style.background = set.has(activeSection) ? 'rgba(251,191,36,0.15)' : ''
            setTimeout(() => { el.style.background = '' }, 800)
          }
          break
        }
        case 'm': {
          if (e.ctrlKey || e.metaKey) return
          const fabs = document.querySelectorAll('.fixed.bottom-6.right-6') as NodeListOf<HTMLElement>
          fabs.forEach((f) => { f.style.display = f.style.display === 'none' ? '' : 'none' })
          break
        }
        case 'Escape': {
          setShowHelp(false)
          setFocusMode(false)
          break
        }
        case 'F11': {
          e.preventDefault()
          setFocusMode((s) => !s)
          break
        }
        case '1': {
          if (!e.ctrlKey && !e.metaKey) return
          e.preventDefault()
          setViewMode('read')
          break
        }
        case '2': {
          if (!e.ctrlKey && !e.metaKey) return
          e.preventDefault()
          setViewMode('mindmap')
          break
        }
        case '3': {
          if (!e.ctrlKey && !e.metaKey) return
          e.preventDefault()
          setViewMode('summary-cards')
          break
        }
        case '4': {
          if (!e.ctrlKey && !e.metaKey) return
          e.preventDefault()
          setViewMode('treemap')
          break
        }
        case 'G': {
          // Shift+G → jump to bottom
          if (e.shiftKey) {
            e.preventDefault()
            const reader = document.querySelector('[class*="overflow-y-auto"]') as HTMLElement
            if (reader) reader.scrollTo({ top: reader.scrollHeight, behavior: 'smooth' })
          }
          break
        }
        case 'g': {
          // Double-tap g → jump to top
          const now = Date.now()
          if (lastKeyRef.current.key === 'g' && now - lastKeyRef.current.time < 500) {
            e.preventDefault()
            const reader = document.querySelector('[class*="overflow-y-auto"]') as HTMLElement
            if (reader) reader.scrollTo({ top: 0, behavior: 'smooth' })
            lastKeyRef.current = { key: '', time: 0 }
          } else {
            lastKeyRef.current = { key: 'g', time: now }
          }
          break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toc, activeSection, viewMode, setViewMode, theme, setTheme])

  // Delight #12: Focus mode — hide toolbar, sidebar, FABs
  useEffect(() => {
    const toolbar = document.querySelector('[class*="sticky"][class*="top-0"][class*="z-10"]')
    const fabs = document.querySelectorAll('.fixed.bottom-6')
    const sidebar = document.querySelector('aside')

    if (focusMode) {
      document.body.classList.add('focus-mode')
      toolbar?.classList.add('hidden')
      sidebar?.classList.add('hidden')
      fabs.forEach((f) => (f as HTMLElement).style.display = 'none')
    } else {
      document.body.classList.remove('focus-mode')
      toolbar?.classList.remove('hidden')
      sidebar?.classList.remove('hidden')
      fabs.forEach((f) => (f as HTMLElement).style.display = '')
    }
  }, [focusMode])

  return (
    <>
      {/* Focus mode hint */}
      {focusMode && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 text-xs text-gray-400 bg-black/50 px-3 py-1 rounded-full animate-pulse">
          Press Esc or F to exit focus mode
        </div>
      )}

      {/* Delight #3: Keyboard shortcut overlay */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl p-6 w-80"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-4">Keyboard Shortcuts</h3>
            <div className="space-y-2">
              {SHORTCUTS.map((s) => (
                <div key={s.key} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">{s.desc}</span>
                  <kbd className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-mono border border-gray-200 dark:border-gray-700">
                    {s.key}
                  </kbd>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-4 text-center">Press ? or Esc to close</p>
          </div>
        </div>
      )}
    </>
  )
}
