import { useEffect, useState } from 'react'

export interface Heading {
  id: string
  text: string
  level: number
}

/**
 * Tracks which heading is currently most visible in the viewport via
 * IntersectionObserver. Shared by:
 *   - <OutlinePanel> (single-file TOC sidebar)
 *   - <FileExplorer> (inline outline of the active file)
 *
 * Pass an array of headings with matching DOM element IDs. The hook
 * observes the elements and returns the id of the currently-visible one.
 *
 * Extracted from Reader.tsx on 2026-04-15 as part of the unified view
 * refactor. Reader.tsx will switch to this hook in Task 18 — until then
 * both paths coexist.
 *
 * **Critical:** the IntersectionObserver options below match Reader.tsx's
 * existing values exactly (rootMargin '-10% 0px -80% 0px', threshold 0).
 * If you're changing the observer behavior, update BOTH places.
 *
 * Note: Reader.tsx passes a scroll-container element as `root` (its
 * `contentRef`). This hook uses the viewport as root (since its
 * consumers — OutlinePanel, FileExplorer — don't yet own a scroll
 * container ref). Task 18 will reconcile this when Reader adopts the
 * hook; an optional `root` parameter may be added then.
 */
export function useActiveSection(headings: Heading[]): string | null {
  // Derived state: when the headings CONTENT changes, reset activeId to
  // the first heading (so the outline highlights *something* even before
  // the user scrolls). We compare by a stable content-key rather than
  // the array reference, because callers may recompute `headings` as a
  // fresh array on every render (e.g. `toc.map(...)`) — comparing by
  // reference would trip infinite re-renders.
  //
  // This is the React-recommended "state-in-render" pattern:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  // It replaces a useEffect+setState that the react-hooks/set-state-in-effect
  // lint rule rightly flags.
  const headingsKey = headings.map(h => h.id).join('|')
  const [activeId, setActiveId] = useState<string | null>(
    headings.length > 0 ? headings[0].id : null
  )
  const [prevKey, setPrevKey] = useState(headingsKey)
  if (prevKey !== headingsKey) {
    setPrevKey(headingsKey)
    setActiveId(headings.length > 0 ? headings[0].id : null)
  }

  useEffect(() => {
    if (headings.length === 0) return
    if (typeof IntersectionObserver === 'undefined') return // SSR guard

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible heading (lowest boundingClientRect.top).
        // Matches Reader.tsx's "bestEntry" loop semantics.
        let bestEntry: IntersectionObserverEntry | null = null
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (
              !bestEntry ||
              entry.boundingClientRect.top < bestEntry.boundingClientRect.top
            ) {
              bestEntry = entry
            }
          }
        }
        if (bestEntry) {
          setActiveId(bestEntry.target.id)
        }
      },
      // IMPORTANT: must match Reader.tsx's values exactly.
      { rootMargin: '-10% 0px -80% 0px', threshold: 0 }
    )

    for (const h of headings) {
      if (!h.id) continue
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [headings])

  return activeId
}
