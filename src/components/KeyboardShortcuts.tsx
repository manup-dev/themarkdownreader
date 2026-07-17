import { useEffect, useState, useRef, useCallback } from 'react'
import { useStore } from '../store/useStore'
import { trackEvent } from '../lib/telemetry'
import { isViewModeGated } from '../lib/feature-flags'

const SHORTCUTS = [
  { group: 'Navigation', items: [
    { key: 'j', desc: 'Next section' },
    { key: 'k', desc: 'Previous section' },
    { key: 'n', desc: 'Next unread section' },
    { key: 'G', desc: 'Jump to bottom' },
    { key: 'gg', desc: 'Jump to top' },
    { key: 'Space (hold)', desc: 'Preview next section' },
  ]},
  { group: 'Views', items: [
    { key: 'Ctrl+1', desc: 'Reader view' },
    { key: 'Ctrl+2', desc: 'Mind Map' },
    { key: 'Ctrl+3', desc: 'Cards' },
    { key: 'Ctrl+4', desc: 'Treemap' },
    { key: 'Ctrl+K', desc: 'Command palette' },
  ]},
  { group: 'Reading Modes', items: [
    { key: 'f', desc: 'Focus mode (hide UI)' },
    { key: 'r', desc: 'Focus paragraph' },
    { key: 'b', desc: 'Bionic reading' },
    { key: 'h', desc: 'Word frequency heatmap' },
    { key: 's', desc: 'Auto-scroll' },
    { key: 'd', desc: 'TL;DR mode (headings only)' },
  ]},
  { group: 'Actions', items: [
    { key: '/', desc: 'Search in document' },
    { key: 'Ctrl+B', desc: 'Bookmark section' },
    { key: 'Ctrl+Shift+C', desc: 'Copy as plain text' },
    { key: 'l', desc: 'Toggle light/dark' },
    { key: 't', desc: 'Cycle all themes' },
    { key: 'i', desc: 'Quick document info' },
    { key: 'm', desc: 'Toggle chat button' },
    { key: 'c', desc: 'Next code block' },
    { key: 'p', desc: 'Podcast view' },
    { key: 'v', desc: 'Diagram view' },
    { key: 'w', desc: 'Show word counts per paragraph' },
    { key: 'Esc', desc: 'Close / exit mode' },
    { key: '?', desc: 'This help' },
  ]},
]

// ─── B5: reader scroll container ─────────────────────────────────────────
// The reader's scrollable pane lives INSIDE #main-content (App.tsx).
// A bare document.querySelector('[class*="overflow-y-auto"]') grabbed the
// sidebar (OutlinePanel/FileExplorer render an overflow-y-auto pane earlier
// in the DOM). #main-content itself is not scrollable, so we select the
// first overflow-y-auto descendant.
function getReaderScrollContainer(): HTMLElement | null {
  return document.querySelector('#main-content [class*="overflow-y-auto"]')
}

// ─── B9: exact-identity undo log for text-node-replacing reading modes ───
// Bionic and heatmap each walk react-markdown's live text nodes and swap
// each one for a DocumentFragment (bold-span / highlight-span pieces) via
// `parent.replaceChild(frag, node)`. The ORIGINAL Text object is what
// React's fiber tree still references as that position's child. Restoring
// by creating a brand-new `document.createTextNode(...)` with equivalent
// content (the pre-fix approach) makes the DOM *look* right but leaves
// React's fiber pointing at the old, now-permanently-detached node — the
// next time React reconciles that position (e.g. a markdown change updates
// or removes a sibling, forcing this parent's children to be diffed instead
// of just written via `.textContent`) it calls
// `parentNode.removeChild(staleFiberNode)`, and since that node is no
// longer actually a child of parentNode, the browser throws
// `NotFoundError: The node to be removed is not a child of this node` —
// the white-screen crash B9 describes. Recording {parent, originalNode,
// nextSibling, insertedNodes} per mutation and splicing the SAME node
// object back at the SAME position keeps React's fiber↔DOM references
// intact, so subsequent reconciliation succeeds normally. Restoring in
// REVERSE application order guarantees each record's captured
// `nextSibling` — which may itself be another tracked node — is already
// back in the live tree by the time it's used as an insertion anchor.
//
// Records are tagged by `mode` because bionic and heatmap are independent
// toggles that CAN be active at once (nothing mutually excludes them); an
// off-toggle must only undo its own mode's mutations, not the other mode's
// still-live ones. clearReadingModes() (Escape / content-change guard) is a
// full teardown, so it restores every tracked record regardless of mode.
type ReadingMode = 'bionic' | 'heatmap'
interface TextMutationRecord {
  mode: ReadingMode
  parent: Node
  originalNode: Text
  nextSibling: Node | null
  insertedNodes: Node[]
}
const textMutations: TextMutationRecord[] = []

function replaceTextNodeTracked(mode: ReadingMode, node: Text, frag: DocumentFragment): void {
  const parent = node.parentNode
  if (!parent) return
  const insertedNodes = Array.from(frag.childNodes)
  const nextSibling = node.nextSibling
  parent.replaceChild(frag, node)
  textMutations.push({ mode, parent, originalNode: node, nextSibling, insertedNodes })
}

function restoreTrackedTextNodes(mode?: ReadingMode): void {
  for (let i = textMutations.length - 1; i >= 0; i--) {
    if (mode && textMutations[i].mode !== mode) continue
    const { parent, originalNode, nextSibling, insertedNodes } = textMutations[i]
    for (const n of insertedNodes) {
      if (n.parentNode === parent) parent.removeChild(n)
    }
    if (nextSibling && nextSibling.parentNode === parent) {
      parent.insertBefore(originalNode, nextSibling)
    } else {
      parent.appendChild(originalNode)
    }
    textMutations.splice(i, 1)
  }
}

// ─── B9 second follow-up: full-unwind-and-reapply for a single off-toggle ─
// A mode-FILTERED restore (`restoreTrackedTextNodes('bionic')`, say) is only
// safe when that mode's own mutation records form an unbroken, independent
// history. They don't, once a second mode has run on top of the first: e.g.
// heatmap splits an original text node into [prefix, highlight-span,
// between, highlight-span, suffix] and records ALL of those pieces (plain
// text included) as ITS `insertedNodes`. Bionic then walks the SAME article
// and — quite correctly, per its own `[data-freq-highlight]` skip — leaves
// the highlight spans alone, but happily replaces the plain-text pieces
// (prefix/between/suffix), since those aren't inside a highlight span. That
// creates its OWN bionic records for nodes heatmap's record still lists in
// `insertedNodes`. When heatmap is later toggled off alone,
// `restoreTrackedTextNodes('heatmap')` finds those specific pieces already
// detached (bionic moved them again) — `n.parentNode === parent` is false,
// so their removal silently no-ops — but heatmap's ORIGINAL full-length
// text still gets unconditionally reinserted regardless, landing next to
// bionic's still-live replacement spans for the very same substring.
// Result: visible duplicated/garbled text, not just a missing decoration.
//
// `restoreTrackedTextNodes()` with NO mode filter does not have this bug —
// Escape/clearReadingModes already prove that out — because it unwinds
// EVERY record in true reverse-chronological order, so an interleaved
// later mutation from the other mode is always undone before any earlier
// mutation that depends on the node it touched. So: toggling one mode off
// while the other might still be active always does a FULL unwind back to
// pristine text (reusing that proven-correct primitive), then re-applies
// the other mode fresh if it was active. Re-applying is deterministic (a
// pure function of the pristine article's text), so it reproduces the
// other mode's exact prior visible output — no flicker in content, only a
// brief internal DOM rebuild.
function applyBionic(article: HTMLElement): void {
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    // Cross-mode isolation (B9 follow-up): skip text already inside a live
    // heatmap span so a FRESH bionic application (while heatmap is active)
    // never nests inside it — see the full-unwind-and-reapply note above
    // for why nesting is the thing we must never let happen in the first
    // place, rather than try to cleanly undo after the fact.
    if (node.parentElement?.closest('pre, code, h1, h2, h3, h4, h5, h6, [data-freq-highlight]')) continue
    const text = node.textContent ?? ''
    if (text.trim().length < 2) continue
    const frag = document.createDocumentFragment()
    const words = text.split(/(\s+)/)
    for (const word of words) {
      if (/^\s+$/.test(word) || word.length < 3) {
        frag.appendChild(document.createTextNode(word))
      } else {
        const boldLen = Math.ceil(word.length * 0.4)
        const span = document.createElement('span')
        span.setAttribute('data-bionic', '1')
        const b = document.createElement('b')
        b.textContent = word.slice(0, boldLen)
        span.appendChild(b)
        span.appendChild(document.createTextNode(word.slice(boldLen)))
        frag.appendChild(span)
      }
    }
    replaceTextNodeTracked('bionic', node, frag)
  }
}

// Returns true if heatmap actually highlighted anything (there was at least
// one term meeting the frequency bar) — callers that gate on "did this
// keypress actually do something" (telemetry, early-return) need that;
// callers re-applying after an unrelated mode's off-toggle don't care.
function applyHeatmap(article: HTMLElement): boolean {
  const text = article.textContent ?? ''
  const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? []
  const freq = new Map<string, number>()
  const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'been', 'will', 'your', 'they', 'their', 'which', 'when', 'what', 'each', 'other', 'about', 'more', 'than', 'also', 'only', 'into', 'some', 'very', 'just', 'like', 'over', 'such', 'most'])
  for (const w of words) {
    if (!stopWords.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1)
  }
  // Get top 15 most frequent terms (appearing 3+ times)
  const topTerms = [...freq.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 15)
  if (topTerms.length === 0) return false
  const maxFreq = topTerms[0][1]
  // Walk text nodes and highlight frequent terms
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
  const nodesToProcess: Text[] = []
  while (walker.nextNode()) nodesToProcess.push(walker.currentNode as Text)
  for (const node of nodesToProcess) {
    // Cross-mode isolation (B9 follow-up) — mirror of bionic's guard above.
    if (node.parentElement?.closest('pre, code, [data-bionic]')) continue
    const content = node.textContent ?? ''
    const regex = new RegExp(`\\b(${topTerms.map(([t]) => t).join('|')})\\b`, 'gi')
    if (!regex.test(content)) continue
    const frag = document.createDocumentFragment()
    let lastIdx = 0
    regex.lastIndex = 0
    let m
    while ((m = regex.exec(content)) !== null) {
      if (m.index > lastIdx) frag.appendChild(document.createTextNode(content.slice(lastIdx, m.index)))
      const span = document.createElement('span')
      span.setAttribute('data-freq-highlight', '1')
      const termFreq = freq.get(m[0].toLowerCase()) ?? 1
      const intensity = Math.round((termFreq / maxFreq) * 100)
      const isSepia = document.documentElement.classList.contains('sepia')
      span.style.background = isSepia
        ? `rgba(180,83,9,${0.08 + (intensity / 100) * 0.25})`
        : `rgba(59,130,246,${0.08 + (intensity / 100) * 0.25})`
      span.style.borderRadius = '2px'
      span.style.padding = '0 1px'
      span.title = `"${m[0]}" appears ${termFreq}× in this document`
      span.textContent = m[0]
      frag.appendChild(span)
      lastIdx = regex.lastIndex
    }
    if (lastIdx < content.length) frag.appendChild(document.createTextNode(content.slice(lastIdx)))
    replaceTextNodeTracked('heatmap', node, frag)
  }
  return true
}

// ─── B9/B10: full teardown of DOM-mutating reading modes ────────────────
// Bionic, heatmap, word-count badges, and TL;DR all rewrite DOM that
// react-markdown owns. Centralized teardown so Escape, the off-toggles, and
// the content-change guard clear the SAME artifact set — previously Escape
// forgot the word-count badges and TL;DR leaked cursor/title/click handlers.
const tldrHandlers = new Map<HTMLElement, () => void>()

function clearReadingModes(): void {
  restoreTrackedTextNodes()
  document.querySelectorAll('[data-word-count-badge]').forEach((el) => el.remove())
  const article = document.querySelector('article')
  if (article?.classList.contains('tldr-mode')) {
    article.classList.remove('tldr-mode')
    article.querySelectorAll('[data-tldr-hidden]').forEach((el) => {
      ;(el as HTMLElement).style.display = ''
      el.removeAttribute('data-tldr-hidden')
    })
  }
  for (const [heading, handler] of tldrHandlers) {
    heading.removeEventListener('click', handler)
    heading.style.cursor = ''
    heading.title = ''
  }
  tldrHandlers.clear()
}

export function KeyboardShortcuts() {
  const toc = useStore((s) => s.toc)
  const markdown = useStore((s) => s.markdown)
  const activeSection = useStore((s) => s.activeSection)
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
  const enabledFeatures = useStore((s) => s.enabledFeatures)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const [showHelp, setShowHelp] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const lastKeyRef = useRef({ key: '', time: 0 })
  const autoScrollRef = useRef<number | null>(null)
  const codeBlockIdxRef = useRef(0)

  // Feature 19: Quick glance — hold spacebar to preview next section
  const [glancePreview, setGlancePreview] = useState<{ heading: string; text: string } | null>(null)
  const [glanceDismissing, setGlanceDismissing] = useState(false)
  const spaceHoldTimerRef = useRef<number | null>(null)
  const spaceDownRef = useRef(false)

  const getNextSectionPreview = useCallback(() => {
    const idx = toc.findIndex((t) => t.id === activeSection)
    if (idx < 0 || idx >= toc.length - 1) return null
    const nextEntry = toc[idx + 1]
    // Extract first 100 words of next section from markdown
    const headingPattern = new RegExp(`^#{1,6}\\s+${nextEntry.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm')
    const match = markdown.match(headingPattern)
    if (!match) return null
    const startIdx = markdown.indexOf(match[0]) + match[0].length
    const afterHeading = markdown.slice(startIdx).replace(/^\n+/, '')
    // Find end of section (next heading or end)
    const nextHeadingMatch = afterHeading.match(/^#{1,6}\s/m)
    const sectionText = nextHeadingMatch ? afterHeading.slice(0, nextHeadingMatch.index) : afterHeading
    const words = sectionText.replace(/[#*`[\]()>|_~-]/g, '').trim().split(/\s+/).slice(0, 100).join(' ')
    return { heading: nextEntry.text, text: words }
  }, [toc, activeSection, markdown])

  useEffect(() => {
    const handleSpaceDown = (e: KeyboardEvent) => {
      if (e.key !== ' ') return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (viewMode !== 'read') return
      // Held key → repeat events keep firing; keep the page from scrolling
      // under the preview but don't restart the hold timer.
      if (e.repeat) {
        if (spaceDownRef.current) e.preventDefault()
        return
      }
      const preview = getNextSectionPreview()
      if (!preview) return
      // preventDefault must be synchronous — inside the 300ms timeout the
      // event's default action (scroll) has long since happened (B6).
      e.preventDefault()
      spaceDownRef.current = true
      spaceHoldTimerRef.current = window.setTimeout(() => {
        setGlanceDismissing(false)
        setGlancePreview(preview)
      }, 300)
    }

    const handleSpaceUp = (e: KeyboardEvent) => {
      if (e.key !== ' ') return
      spaceDownRef.current = false
      if (spaceHoldTimerRef.current) {
        clearTimeout(spaceHoldTimerRef.current)
        spaceHoldTimerRef.current = null
      }
      if (glancePreview) {
        setGlanceDismissing(true)
        setTimeout(() => {
          setGlancePreview(null)
          setGlanceDismissing(false)
        }, 150)
      }
    }

    window.addEventListener('keydown', handleSpaceDown)
    window.addEventListener('keyup', handleSpaceUp)
    return () => {
      window.removeEventListener('keydown', handleSpaceDown)
      window.removeEventListener('keyup', handleSpaceUp)
      if (spaceHoldTimerRef.current) clearTimeout(spaceHoldTimerRef.current)
    }
  }, [viewMode, getNextSectionPreview, glancePreview])

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
          if (e.ctrlKey || e.metaKey || e.altKey) return
          const gated = isViewModeGated('podcast')
          if (gated && !enabledFeatures.has(gated)) return
          e.preventDefault()
          setViewMode('podcast')
          break
        }
        case 'v': {
          if (e.ctrlKey || e.metaKey || e.altKey) return
          const gated = isViewModeGated('diagram')
          if (gated && !enabledFeatures.has(gated)) return
          e.preventDefault()
          setViewMode('diagram')
          break
        }
        case 'b': {
          if (e.ctrlKey || e.metaKey) {
            // Ctrl+B bookmark behavior
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
              const isSepia = document.documentElement.classList.contains('sepia')
              el.style.background = set.has(activeSection) ? (isSepia ? 'rgba(180,83,9,0.15)' : 'rgba(251,191,36,0.15)') : ''
              setTimeout(() => { el.style.background = '' }, 800)
            }
            break
          }
          // Plain 'b' — bionic reading mode
          if (viewMode !== 'read') return
          trackEvent('bionic_toggle')
          const article = document.querySelector('article')
          if (!article) return
          // Toggle off. If heatmap is ALSO active, a mode-scoped restore
          // (restoreTrackedTextNodes('bionic')) can leave visibly
          // duplicated/garbled text — heatmap's own mutation record can
          // still reference text-node pieces bionic has since further
          // split, and a filtered restore doesn't know how to unwind that
          // interleaved history safely (see the full-unwind-and-reapply
          // comment above applyBionic). Full-unwind everything back to
          // pristine — the same primitive Escape/clearReadingModes already
          // proves correct — then re-apply heatmap fresh if it was active.
          if (article.querySelector('[data-bionic]')) {
            const heatmapWasActive = !!article.querySelector('[data-freq-highlight]')
            restoreTrackedTextNodes()
            if (heatmapWasActive) applyHeatmap(article)
            break
          }
          applyBionic(article)
          break
        }
        case 'm': {
          if (e.ctrlKey || e.metaKey) return
          const fabs = document.querySelectorAll('[data-chat-fab]') as NodeListOf<HTMLElement>
          fabs.forEach((f) => { f.style.display = f.style.display === 'none' ? '' : 'none' })
          break
        }
        case 'r': {
          if (e.ctrlKey || e.metaKey) return
          if (viewMode !== 'read') return
          trackEvent('focus_mode_toggle')
          const body = document.body
          const isFP = body.classList.contains('focus-paragraph')
          if (isFP) {
            body.classList.remove('focus-paragraph')
            document.querySelectorAll('.fp-active, .fp-adjacent').forEach((el) => { el.classList.remove('fp-active', 'fp-adjacent') })
          } else {
            body.classList.add('focus-paragraph')
            // Find the paragraph nearest viewport center and highlight it
            const article = document.querySelector('article')
            if (article) {
              const children = Array.from(article.children) as HTMLElement[]
              const center = window.innerHeight / 2
              let closest = children[0]
              let closestDist = Infinity
              for (const child of children) {
                const rect = child.getBoundingClientRect()
                const dist = Math.abs(rect.top + rect.height / 2 - center)
                if (dist < closestDist) { closestDist = dist; closest = child }
              }
              closest?.classList.add('fp-active')
              closest?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              const idx = children.indexOf(closest)
              if (idx > 0) children[idx - 1]?.classList.add('fp-adjacent')
              if (idx < children.length - 1) children[idx + 1]?.classList.add('fp-adjacent')
            }
          }
          break
        }
        case 'h': {
          if (e.ctrlKey || e.metaKey) return
          if (viewMode !== 'read') return
          trackEvent('heatmap_toggle')
          const article = document.querySelector('article')
          if (!article) return
          // Toggle: if heatmap is on, remove it. If bionic is ALSO active,
          // full-unwind + reapply bionic fresh — same reasoning as the 'b'
          // off-toggle above (see the comment above applyBionic): a
          // mode-scoped restore can leave visibly duplicated/garbled text
          // when the two modes' mutation histories are interleaved.
          if (article.querySelector('[data-freq-highlight]')) {
            const bionicWasActive = !!article.querySelector('[data-bionic]')
            restoreTrackedTextNodes()
            if (bionicWasActive) applyBionic(article)
            break
          }
          if (!applyHeatmap(article)) return
          break
        }
        case 'i': {
          if (e.ctrlKey || e.metaKey) return
          const state = useStore.getState()
          if (!state.markdown) return
          const wc = state.markdown.split(/\s+/).filter(Boolean).length
          const sections = state.toc.length
          const codeBlocks = Math.floor((state.markdown.match(/```/g) ?? []).length / 2)
          const links = (state.markdown.match(/\[([^\]]+)\]\([^)]+\)/g) ?? []).length
          const info = `${wc.toLocaleString()} words \u00b7 ${sections} sections \u00b7 ${codeBlocks} code blocks \u00b7 ${links} links \u00b7 ${Math.round(state.readingProgress)}% read`
          // Show as temporary toast
          const toast = document.createElement('div')
          toast.className = 'fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-gray-800 text-white text-xs shadow-lg'
          toast.style.animation = 'fadeIn 150ms ease-out'
          toast.textContent = info
          document.body.appendChild(toast)
          setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 300ms'; setTimeout(() => toast.remove(), 300) }, 3000)
          break
        }
        case 'C': {
          if (!e.ctrlKey || !e.shiftKey) return
          e.preventDefault()
          const article = document.querySelector('article')
          if (!article) return
          const text = article.textContent ?? ''
          navigator.clipboard.writeText(text.trim())
          // Toast
          const t = document.createElement('div')
          t.className = 'toast-notify'
          t.textContent = 'Document copied as plain text!'
          document.body.appendChild(t)
          setTimeout(() => t.remove(), 2000)
          break
        }
        case 'l': {
          if (e.ctrlKey || e.metaKey) return
          setTheme(theme === 'dark' ? 'light' : 'dark')
          break
        }
        case 'n': {
          if (e.ctrlKey || e.metaKey) return
          if (viewMode !== 'read') return
          const curIdx = toc.findIndex((t) => t.id === activeSection)
          if (curIdx < 0 || curIdx >= toc.length - 1) return
          const nextUnread = toc[curIdx + 1]
          if (nextUnread) document.getElementById(nextUnread.id)?.scrollIntoView({ behavior: 'smooth' })
          break
        }
        case 's': {
          if (e.ctrlKey || e.metaKey) return
          if (viewMode !== 'read') return
          trackEvent('auto_scroll_toggle')
          const reader = getReaderScrollContainer()
          if (!reader) return
          if (autoScrollRef.current) {
            clearInterval(autoScrollRef.current)
            autoScrollRef.current = null
          } else {
            autoScrollRef.current = window.setInterval(() => {
              reader.scrollBy({ top: 1 })
            }, 50)
          }
          break
        }
        case 'c': {
          if (e.ctrlKey || e.metaKey) return
          if (viewMode !== 'read') return
          const codeBlocks = document.querySelectorAll('article pre')
          if (codeBlocks.length === 0) return
          const idx = codeBlockIdxRef.current % codeBlocks.length
          codeBlocks[idx].scrollIntoView({ behavior: 'smooth', block: 'center' })
          const outlineColor = document.documentElement.classList.contains('sepia') ? '#92400e' : '#3b82f6'
          ;(codeBlocks[idx] as HTMLElement).style.outline = `2px solid ${outlineColor}`
          ;(codeBlocks[idx] as HTMLElement).style.outlineOffset = '4px'
          setTimeout(() => { (codeBlocks[idx] as HTMLElement).style.outline = '' }, 2000)
          codeBlockIdxRef.current = idx + 1
          break
        }
        case 'w': {
          if (e.ctrlKey || e.metaKey) return
          if (viewMode !== 'read') return
          const article = document.querySelector('article')
          if (!article) return
          if (article.querySelector('[data-word-count-badge]')) {
            article.querySelectorAll('[data-word-count-badge]').forEach((el) => el.remove())
            break
          }
          const children = Array.from(article.children) as HTMLElement[]
          for (const child of children) {
            if (/^H[1-6]$/.test(child.tagName) || child.tagName === 'HR') continue
            const text = child.textContent ?? ''
            const wc = text.split(/\s+/).filter(Boolean).length
            if (wc < 3) continue
            const badge = document.createElement('span')
            badge.setAttribute('data-word-count-badge', '1')
            badge.className = 'absolute -right-12 top-0 text-[8px] text-gray-300 dark:text-gray-600 font-mono'
            badge.textContent = `${wc}w`
            child.style.position = 'relative'
            child.appendChild(badge)
          }
          break
        }
        case 'd': {
          if (e.ctrlKey || e.metaKey) return
          if (viewMode !== 'read') return
          const article = document.querySelector('article')
          if (!article) return
          const isTldr = article.classList.contains('tldr-mode')
          if (isTldr) {
            article.classList.remove('tldr-mode')
            article.querySelectorAll('[data-tldr-hidden]').forEach((el) => {
              ;(el as HTMLElement).style.display = ''
              el.removeAttribute('data-tldr-hidden')
            })
            // B10: symmetric teardown — remove the expand handlers and the
            // cursor/tooltip affordances they installed on headings.
            for (const [heading, handler] of tldrHandlers) {
              heading.removeEventListener('click', handler)
              heading.style.cursor = ''
              heading.title = ''
            }
            tldrHandlers.clear()
          } else {
            article.classList.add('tldr-mode')
            const children = Array.from(article.children) as HTMLElement[]
            for (const child of children) {
              const isHeading = /^H[1-6]$/.test(child.tagName)
              if (!isHeading) {
                child.setAttribute('data-tldr-hidden', '1')
                child.style.display = 'none'
              } else {
                child.style.cursor = 'pointer'
                child.title = 'Click to expand this section'
                const handler = () => {
                  // Show content until next heading
                  let next = child.nextElementSibling as HTMLElement | null
                  while (next && !/^H[1-6]$/.test(next.tagName)) {
                    next.style.display = ''
                    next.removeAttribute('data-tldr-hidden')
                    next = next.nextElementSibling as HTMLElement | null
                  }
                  child.style.cursor = ''
                  child.title = ''
                  child.removeEventListener('click', handler)
                  tldrHandlers.delete(child)
                }
                tldrHandlers.set(child, handler)
                child.addEventListener('click', handler)
              }
            }
          }
          break
        }
        case 'Escape': {
          if (autoScrollRef.current) { clearInterval(autoScrollRef.current); autoScrollRef.current = null }
          setShowHelp(false)
          setFocusMode(false)
          document.body.classList.remove('focus-paragraph')
          document.querySelectorAll('.fp-active, .fp-adjacent').forEach((el) => { el.classList.remove('fp-active', 'fp-adjacent') })
          // B9/B10: full teardown of every DOM reading mode — bionic, heatmap,
          // word-count badges (previously forgotten), and TL;DR including the
          // heading cursor/title/click handlers (previously leaked).
          clearReadingModes()
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
          if (!e.shiftKey) return
          e.preventDefault()
          const reader = getReaderScrollContainer()
          if (reader) reader.scrollTo({ top: reader.scrollHeight, behavior: 'smooth' })
          break
        }
        case 'g': {
          // Double-tap g → jump to top
          const now = Date.now()
          if (lastKeyRef.current.key === 'g' && now - lastKeyRef.current.time < 500) {
            e.preventDefault()
            const reader = getReaderScrollContainer()
            if (reader) reader.scrollTo({ top: 0, behavior: 'smooth' })
            lastKeyRef.current = { key: '', time: 0 }
          } else {
            lastKeyRef.current = { key: 'g', time: now }
          }
          break
        }
        default:
          return
      }
      // B11: only count keys a shortcut actually handled. Unhandled paths
      // `return` above (skipping this); handled cases `break` into it.
      trackEvent('keyboard_shortcut')
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toc, activeSection, viewMode, setViewMode, theme, setTheme, enabledFeatures])

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

  // Focus paragraph mode: update highlighted paragraph on scroll
  useEffect(() => {
    const reader = getReaderScrollContainer()
    if (!reader) return
    const update = () => {
      if (!document.body.classList.contains('focus-paragraph')) return
      const article = document.querySelector('article')
      if (!article) return
      const children = Array.from(article.children) as HTMLElement[]
      const center = window.innerHeight / 2
      children.forEach((c) => c.classList.remove('fp-active', 'fp-adjacent'))
      let closest = children[0]
      let closestDist = Infinity
      for (const child of children) {
        const rect = child.getBoundingClientRect()
        const dist = Math.abs(rect.top + rect.height / 2 - center)
        if (dist < closestDist) { closestDist = dist; closest = child }
      }
      closest?.classList.add('fp-active')
      const idx = children.indexOf(closest)
      if (idx > 0) children[idx - 1]?.classList.add('fp-adjacent')
      if (idx < children.length - 1) children[idx + 1]?.classList.add('fp-adjacent')
    }
    reader.addEventListener('scroll', update, { passive: true })
    return () => reader.removeEventListener('scroll', update)
  }, [viewMode])

  // Cleanup auto-scroll on unmount
  useEffect(() => {
    return () => {
      if (autoScrollRef.current) {
        clearInterval(autoScrollRef.current)
        autoScrollRef.current = null
      }
    }
  }, [])

  // B9 crash guard: bionic/heatmap/badges replace text nodes that
  // react-markdown owns; if the document changes while artifacts are live,
  // React's commit throws NotFoundError removing nodes we swapped out.
  // useStore.subscribe fires synchronously inside set() — BEFORE React
  // re-renders — so the original nodes are restored in time. (A useEffect
  // on markdown would run after the crashing commit.)
  useEffect(() => {
    const unsub = useStore.subscribe((state, prev) => {
      if (state.markdown !== prev.markdown) clearReadingModes()
    })
    return unsub
  }, [])

  // Cancel auto-scroll on manual scroll (wheel or touch)
  useEffect(() => {
    const cancelAutoScroll = () => {
      if (autoScrollRef.current) {
        clearInterval(autoScrollRef.current)
        autoScrollRef.current = null
      }
    }
    window.addEventListener('wheel', cancelAutoScroll, { passive: true })
    window.addEventListener('touchmove', cancelAutoScroll, { passive: true })
    return () => {
      window.removeEventListener('wheel', cancelAutoScroll)
      window.removeEventListener('touchmove', cancelAutoScroll)
    }
  }, [])

  return (
    <>
      {/* Focus mode hint */}
      {focusMode && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 text-xs text-gray-400 bg-black/50 px-3 py-1 rounded-full animate-pulse">
          Press Esc or F to exit focus mode
        </div>
      )}

      {/* Focus paragraph hint */}
      {typeof document !== 'undefined' && document.body?.classList.contains('focus-paragraph') && viewMode === 'read' && (
        <div className="fixed top-4 right-4 z-50 text-[10px] text-purple-400 bg-purple-950/50 px-2 py-1 rounded-full">
          Focus paragraph — press R or Esc to exit
        </div>
      )}

      {/* Delight #3: Keyboard shortcut overlay */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 sepia:bg-sepia-50 border border-gray-200 dark:border-gray-800 sepia:border-sepia-200 rounded-2xl shadow-2xl p-6 w-96"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-4">Keyboard Shortcuts</h3>
            <div className="space-y-1">
              {SHORTCUTS.map((group) => (
                <div key={group.group} className="mb-3">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">{group.group}</p>
                  <div className="space-y-1">
                    {group.items.filter((s) => {
                      if (s.key === 'p') { const g = isViewModeGated('podcast'); if (g && !enabledFeatures.has(g)) return false }
                      if (s.key === 'v') { const g = isViewModeGated('diagram'); if (g && !enabledFeatures.has(g)) return false }
                      return true
                    }).map((s) => (
                      <div key={s.key} className="flex items-center justify-between">
                        <span className="text-xs text-gray-600 dark:text-gray-400">{s.desc}</span>
                        <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-mono border border-gray-200 dark:border-gray-700">
                          {s.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-4 text-center">Press ? or Esc to close</p>
          </div>
        </div>
      )}
      {/* Feature 19: Quick glance preview card */}
      {glancePreview && (
        <div
          className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-50 max-w-lg w-full mx-4 ${
            glanceDismissing ? 'glance-preview-out' : 'glance-preview-in'
          }`}
        >
          <div className="bg-white/80 dark:bg-gray-900/80 sepia:bg-sepia-50/80 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 sepia:border-sepia-200/50 rounded-2xl shadow-2xl p-5">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">Next section</p>
            <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-2">{glancePreview.heading}</h4>
            {glancePreview.text && (
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-4">
                {glancePreview.text}...
              </p>
            )}
            <p className="text-[9px] text-gray-300 dark:text-gray-600 mt-2">Release spacebar to dismiss</p>
          </div>
        </div>
      )}
    </>
  )
}
