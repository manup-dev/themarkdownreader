import { useCallback } from 'react'
import { useStore } from '../store/useStore'
import { useActiveSection, type Heading } from '../hooks/useActiveSection'

/**
 * Sidebar TOC for single-file reading. Renders store.toc as a vertical
 * list of heading buttons, highlighting the currently-scrolled section.
 * Clicking a heading scrolls the main pane to that anchor.
 *
 * Rendered inside <Sidebar> when no folder is loaded. Shares the same
 * slot as <FileExplorer> (which takes over when a folder IS loaded).
 *
 * Extracted from Reader.tsx on 2026-04-15 as part of the unified view
 * refactor. Reader's embedded Contents sidebar is deleted in Task 18
 * once this component is wired into the App shell via <Sidebar>.
 */
export function OutlinePanel() {
  const toc = useStore(s => s.toc)

  // Normalize toc entries to the Heading shape useActiveSection expects.
  // store.toc may have extra fields (anchor, slug, children) — we only
  // care about {id, text, level}.
  const headings: Heading[] = toc.map((h) => ({
    id: h.id,
    text: h.text,
    level: h.level,
  }))

  const activeId = useActiveSection(headings)

  const handleClick = useCallback((id: string) => {
    if (!id) return
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  if (headings.length === 0) {
    return (
      <div className="px-4 py-6 text-xs text-gray-400 dark:text-gray-500">
        No headings in this document.
      </div>
    )
  }

  return (
    <nav
      aria-label="Document outline"
      className="overflow-y-auto py-2 h-full"
    >
      <h3 className="px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Contents
      </h3>
      <ul className="space-y-0.5">
        {headings.map((h, idx) => (
          <li key={`${h.id}-${idx}`}>
            <button
              type="button"
              onClick={() => handleClick(h.id)}
              style={{ paddingLeft: `${0.5 + (h.level - 1) * 0.75}rem` }}
              className={
                'block w-full text-left text-sm py-1 pr-3 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ' +
                (activeId === h.id
                  ? 'text-blue-600 dark:text-blue-400 font-medium border-l-2 border-blue-500'
                  : 'text-gray-600 dark:text-gray-300 border-l-2 border-transparent')
              }
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
