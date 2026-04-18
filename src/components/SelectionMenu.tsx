import { useState, useEffect, useCallback, useRef } from 'react'
import { captureAnchor, type TextAnchor } from '../lib/anchor'
import { isViewModeGated } from '../lib/feature-flags'
import { Highlighter, Search, Bot, BookOpen, Copy, X, Loader2, Check, Quote, FileText, MessageSquare, Shapes } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store/useStore'
import { useAdapter } from '../provider/hooks'
import type { Highlight } from '../types/storage-adapter'
import { chat } from '../lib/ai'
import { trackEvent } from '../lib/telemetry'

const COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa']
const COLOR_NAMES: Record<string, string> = {
  '#fef08a': 'yellow',
  '#bbf7d0': 'green',
  '#bfdbfe': 'blue',
  '#fbcfe8': 'pink',
  '#fed7aa': 'orange',
}
const LAST_COLOR_KEY = 'md-reader-last-highlight-color'

/**
 * Returns the id of the nearest preceding heading (h1..h6) for the current
 * selection inside <article>, or null if none can be found. Used to
 * attribute comments / highlights to the correct section regardless of
 * what the scroll-tracker thinks is "active".
 */
function computeSelectionSectionId(): string | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const node: Node = range.startContainer
  const el: Element | null = node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement
  const article = el?.closest('article')
  if (!article || !el) return null

  // Strategy: collect ALL headings in the article in document order,
  // then find the last heading that comes BEFORE the selection's start.
  // This is robust against deeply nested wrapper <div>s, sections,
  // and any markdown renderer that wraps content in extra containers.
  const allHeadings = Array.from(article.querySelectorAll('h1, h2, h3, h4, h5, h6'))
  let lastBefore: Element | null = null
  for (const h of allHeadings) {
    // compareDocumentPosition bit 4 = DOCUMENT_POSITION_FOLLOWING — the
    // heading comes before the selection's start container in document order.
    const pos = h.compareDocumentPosition(range.startContainer)
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
      lastBefore = h
    } else {
      break // headings after the selection — stop
    }
  }
  return lastBefore?.id || null
}

/**
 * Trims leading/trailing whitespace and dangling punctuation from a text
 * fragment so saved highlights/comments don't end with stray commas or
 * sentence fragments like "shipping are two distinct problems, and".
 */
function cleanSelectionText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    // Only strip a trailing word when it follows a comma or semicolon —
    // this is the tell-tale sign of a sloppy selection that grabbed one
    // word too many. Legitimate text like "To be or not to be, that is"
    // where the user intentionally ended at "is" won't match because
    // there's no trailing comma before "is". The pattern is:
    //   "…problems, and" → "…problems"     (comma + conjunction = sloppy)
    //   "…that is"       → "…that is"      (no comma = intentional)
    .replace(/[,;]\s+(and|or|but|the|a|an|of|to|in|on|at|by|for|with|as)$/i, '')
    // Drop trailing punctuation that isn't sentence-ending
    .replace(/[,;:]+$/, '')
    .trim()
}

interface MenuPos {
  x: number
  y: number
  text: string
  /**
   * Section id captured at mouseup time (while the selection is still live).
   * Used later by handleSaveComment so the comment attaches to the nearest
   * heading *containing the selection*, not to `activeSection`, which can
   * be stale. Captured up-front because clicking into the comment textarea
   * collapses the selection and we can't recompute it from there.
   */
  sectionId: string | null
  anchor: TextAnchor | null
}

export function SelectionMenu() {
  const activeDocId = useStore((s) => s.activeDocId)
  const enabledFeatures = useStore((s) => s.enabledFeatures)
  const adapter = useAdapter()
  const [menu, setMenu] = useState<MenuPos | null>(null)
  const [aiResponse, setAiResponse] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [showHighlights, setShowHighlights] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showCopyMenu, setShowCopyMenu] = useState(false)
  const [showGlossary, setShowGlossary] = useState(false)
  const [showCommentInput, setShowCommentInput] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const refreshHighlights = useCallback(async () => {
    if (!activeDocId) return
    setHighlights(await adapter.getHighlights(activeDocId))
  }, [activeDocId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refreshHighlights() }, [refreshHighlights])

  // Show menu on text selection via mouseup
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      // Ignore clicks inside the menu itself
      if (menuRef.current?.contains(e.target as Node)) return

      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) {
        // Only close if clicking outside menu
        if (!menuRef.current?.contains(e.target as Node)) {
          setMenu(null)
          setAiResponse(null)
          setShowColorPicker(false)
          setShowMore(false)
          setShowCommentInput(false)
        }
        return
      }

      const rawText = sel.toString()
      const text = cleanSelectionText(rawText)
      if (text.length < 2) return

      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      const sectionId = computeSelectionSectionId()
      const { markdown } = useStore.getState()
      const anchor = markdown
        ? captureAnchor(markdown, sel.toString(), sectionId ?? undefined)
        : null

      setMenu({
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
        text,
        sectionId,
        anchor,
      })
      setAiResponse(null)
    }

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null)
        setAiResponse(null)
        setShowColorPicker(false)
        setShowMore(false)
        setShowCommentInput(false)
        setShowCopyMenu(false)
      }
    }
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('keydown', handleKey)
    }
  }, [])

  const handleHighlight = useCallback(async (color: string) => {
    if (!menu) return
    let docId = activeDocId
    // Auto-save document if not yet in library — skip heavy post-processing to stay responsive
    if (!docId) {
      const { markdown, fileName, setActiveDocId } = useStore.getState()
      if (!markdown || !fileName) return
      const result = await adapter.addDocument(fileName, markdown, { skipPostProcessing: true })
      docId = result.docId
      setActiveDocId(docId)
    }
    await adapter.addHighlight({
      docId,
      text: menu.text,
      startOffset: menu.anchor?.markdownStart ?? 0,
      endOffset: menu.anchor?.markdownEnd ?? 0,
      color,
      note: '',
      createdAt: Date.now(),
      anchor: menu.anchor ?? undefined,
    })
    // Remember this color so the next one-click highlight reuses it
    try { localStorage.setItem(LAST_COLOR_KEY, color) } catch { /* storage disabled */ }
    window.getSelection()?.removeAllRanges()
    setMenu(null)
    await refreshHighlights()
    // Notify Reader to re-apply inline highlight spans immediately
    window.dispatchEvent(new CustomEvent('md-reader-highlight-changed'))
    trackEvent('highlight_added')
  }, [menu, activeDocId, refreshHighlights])

  const handleAskAI = useCallback(async (prompt: string) => {
    if (!menu) return
    setAiLoading(true)
    try {
      const response = await chat([
        { role: 'system', content: prompt },
        { role: 'user', content: menu.text },
      ])
      setAiResponse(response)
    } catch (e) {
      setAiResponse(`Error: ${e instanceof Error ? e.message : 'Failed'}`)
    }
    setAiLoading(false)
  }, [menu])

  const fileName = useStore((s) => s.fileName)

  const doCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setShowCopyMenu(false)
    setTimeout(() => { setCopied(false); setMenu(null) }, 1200)
  }, [])

  const handleCopy = useCallback(() => {
    if (!menu) return
    doCopy(menu.text)
  }, [menu, doCopy])

  const handleCopyAsQuote = useCallback(() => {
    if (!menu) return
    doCopy(`> ${menu.text.split('\n').join('\n> ')}`)
  }, [menu, doCopy])

  const handleCopyWithSource = useCallback(() => {
    if (!menu) return
    doCopy(`${menu.text}\n\n— ${fileName ?? 'document'}`)
  }, [menu, fileName, doCopy])

  const handleSearch = useCallback(() => {
    if (!menu) return
    // Scroll to first match highlight
    const article = document.querySelector('article') ?? document.body
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
    let found = false
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (node.textContent?.includes(menu.text) && !found) {
        const el = node.parentElement
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          // Flash highlight
          el.style.background = document.documentElement.classList.contains('sepia') ? '#e8d5be' : '#fef08a'
          setTimeout(() => { el.style.background = '' }, 2000)
          found = true
        }
      }
    }
    setMenu(null)
  }, [menu])

  const handleSaveComment = useCallback(async () => {
    if (!menu || !commentText.trim()) return
    let docId = activeDocId
    // Auto-save document if not yet in library — skip heavy post-processing to stay responsive
    if (!docId) {
      const { markdown, fileName, setActiveDocId } = useStore.getState()
      if (!markdown || !fileName) return
      const result = await adapter.addDocument(fileName, markdown, { skipPostProcessing: true })
      docId = result.docId
      setActiveDocId(docId)
    }
    // Prefer the section captured at mouseup time (when the selection was
    // still live); fall back to activeSection only if that wasn't computable.
    const sectionId = menu.sectionId ?? useStore.getState().activeSection ?? ''
    const author = localStorage.getItem('md-reader-username') || 'You'
    await adapter.addComment({
      docId,
      selectedText: menu.text,
      comment: commentText.trim(),
      author,
      sectionId,
      createdAt: Date.now(),
      resolved: false,
      anchor: menu.anchor ?? undefined,
    })
    setCommentText('')
    setShowCommentInput(false)
    window.getSelection()?.removeAllRanges()
    setMenu(null)
    trackEvent('comment_added')
    // Notify Reader to refresh inline comment highlights immediately
    window.dispatchEvent(new CustomEvent('md-reader-comment-changed'))
    // Toast notification
    const toast = document.createElement('div')
    toast.className = 'toast-notify fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-green-600 text-white text-sm rounded-lg shadow-lg'
    toast.setAttribute('role', 'alert')
    toast.textContent = 'Comment saved'
    document.body.appendChild(toast)
    setTimeout(() => toast.remove(), 2000)
  }, [menu, activeDocId, commentText])

  const handleRemoveHighlight = useCallback(async (id: number) => {
    await adapter.removeHighlight(id)
    await refreshHighlights()
    window.dispatchEvent(new CustomEvent('md-reader-highlight-changed'))
  }, [refreshHighlights])

  const handleUpdateNote = useCallback(async (id: number, note: string) => {
    await adapter.updateHighlightNote(id, note)
    await refreshHighlights()
  }, [refreshHighlights])

  const exportHighlights = useCallback(() => {
    if (highlights.length === 0) return
    const docName = useStore.getState().fileName ?? 'Document'
    const lines = [`# Highlights from ${docName}\n`]
    for (const h of highlights) {
      lines.push(`> ${h.text}`)
      if (h.note) lines.push(`\n*Note: ${h.note}*`)
      lines.push('')
    }
    lines.push('---')
    lines.push('*Exported with [md-reader](https://github.com/manup-dev/themarkdownreader)*')
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${docName.replace(/\.md$/, '')}-highlights.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [highlights])

  return (
    <>
      {/* Context menu on text selection */}
      {menu && (
        <div
          ref={menuRef}
          className="selection-menu fixed z-50 transform -translate-x-1/2 -translate-y-full animate-pop-in"
          style={{ left: menu.x, top: menu.y }}
        >
          {/* AI response popup */}
          {(aiResponse || aiLoading) && (
            <div className="mb-2 w-80 bg-white dark:bg-gray-900 sepia:bg-sepia-50 border border-gray-200 dark:border-gray-800 sepia:border-sepia-200 rounded-xl shadow-xl p-3 max-h-60 overflow-y-auto">
              {aiLoading ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking...
                </div>
              ) : (
                <div className="prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-headings:my-1 prose-headings:text-sm max-w-none text-sm">
                  <Markdown remarkPlugins={[remarkGfm]}>{aiResponse!}</Markdown>
                </div>
              )}
            </div>
          )}

          {/* Auto-show glossary match if selected text matches a saved term */}
          {(() => {
            const docId = activeDocId ?? 'unsaved'
            const glossary = JSON.parse(localStorage.getItem(`md-reader-glossary-${docId}`) ?? '{}')
            const selected = menu?.text.toLowerCase().trim() ?? ''
            const match = Object.entries(glossary).find(([term]) => term.toLowerCase() === selected || selected.includes(term.toLowerCase()))
            if (!match) return null
            return (
              <div className="px-3 py-1.5 text-[10px] text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg mb-1 max-w-64">
                <span className="font-semibold">{match[0]}:</span> {String(match[1]).slice(0, 100)}
              </div>
            )
          })()}

          {/* Action bar — Google Docs-style compact pill with 4 primary actions */}
          <div className="bg-white dark:bg-gray-900 sepia:bg-sepia-50 border border-gray-200 dark:border-gray-800 sepia:border-sepia-200 rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center p-1 gap-0.5">
              {/* Highlight — one click applies last-used color;
                  right-click or chevron opens the color picker */}
              <button
                onClick={() => {
                  const last = (typeof localStorage !== 'undefined' && localStorage.getItem(LAST_COLOR_KEY)) || COLORS[0]
                  const color = COLORS.includes(last) ? last : COLORS[0]
                  handleHighlight(color)
                }}
                onContextMenu={(e) => { e.preventDefault(); setShowColorPicker(v => !v); setShowMore(false); setShowCommentInput(false); setShowCopyMenu(false) }}
                className={`flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${showColorPicker ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                title="Highlight (right-click for colors)"
                aria-label="Highlight"
              >
                <Highlighter className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Highlight</span>
                <span
                  role="button"
                  aria-label="Choose highlight color"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowColorPicker(v => !v); setShowMore(false); setShowCommentInput(false); setShowCopyMenu(false)
                  }}
                  className="ml-0.5 -mr-0.5 px-0.5 text-[10px] leading-none opacity-60 hover:opacity-100"
                >▾</span>
              </button>

              {/* Comment — opens inline composer */}
              <button
                onClick={() => { setShowCommentInput(v => !v); setCommentText(''); setShowColorPicker(false); setShowMore(false); setShowCopyMenu(false) }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${showCommentInput ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                title="Add comment"
                aria-expanded={showCommentInput}
              >
                <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Comment</span>
              </button>

              {/* Chat — sends selection into the AI chat */}
              <button
                onClick={() => {
                  if (!menu) return
                  const chatFab = document.querySelector('[data-chat-fab]') as HTMLButtonElement
                  if (chatFab) chatFab.click()
                  setTimeout(() => {
                    const input = document.querySelector('[placeholder*="Ask a question"]') as HTMLInputElement
                    if (input) {
                      input.value = `Explain this passage: "${menu.text.slice(0, 200)}"`
                      input.dispatchEvent(new Event('input', { bubbles: true }))
                      input.focus()
                    }
                  }, 200)
                  setMenu(null)
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                title="Ask AI chat about this"
              >
                <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
                <span>Chat</span>
              </button>

              {/* Copy — rightmost utility (left-click copies, right-click submenu) */}
              <button
                onClick={handleCopy}
                onContextMenu={(e) => { e.preventDefault(); setShowCopyMenu(v => !v); setShowColorPicker(false); setShowMore(false); setShowCommentInput(false) }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${copied ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                title="Copy (right-click for options)"
              >
                {copied ? <Check className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>

              <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-0.5" />

              {/* More — secondary AI + tools collapsed by default */}
              <button
                onClick={() => { setShowMore(v => !v); setShowColorPicker(false); setShowCommentInput(false); setShowCopyMenu(false) }}
                className={`p-1.5 rounded-lg transition-colors ${showMore ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                title="More actions"
                aria-label="More actions"
                aria-expanded={showMore}
              >
                <span className="text-sm leading-none font-bold">⋯</span>
              </button>
            </div>

            {/* Highlight color picker — appears when the chevron is clicked */}
            {showColorPicker && (() => {
              const lastColor = (typeof localStorage !== 'undefined' && localStorage.getItem(LAST_COLOR_KEY)) || COLORS[0]
              return (
                <div className="flex items-center gap-2 pl-3 pr-2 py-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/30">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => { handleHighlight(c); setShowColorPicker(false) }}
                      className={`w-6 h-6 rounded-full border-2 transition-all hover:scale-110 shrink-0 ${c === lastColor ? 'border-gray-700 dark:border-gray-200 ring-2 ring-offset-1 ring-gray-400 dark:ring-gray-500' : 'border-gray-300 dark:border-gray-600 hover:border-gray-600 dark:hover:border-gray-300'}`}
                      style={{ background: c }}
                      title={`${COLOR_NAMES[c] ?? c}${c === lastColor ? ' (default)' : ''}`}
                      aria-label={`Highlight ${COLOR_NAMES[c] ?? c}`}
                    />
                  ))}
                </div>
              )
            })()}

            {/* Copy submenu */}
            {showCopyMenu && (
              <div className="border-t border-gray-100 dark:border-gray-800 p-1 space-y-0.5">
                <button onClick={handleCopy} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                  <Copy className="h-3 w-3" /> Copy text
                </button>
                <button onClick={handleCopyAsQuote} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                  <Quote className="h-3 w-3" /> Copy as quote
                </button>
                <button onClick={handleCopyWithSource} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                  <FileText className="h-3 w-3" /> Copy with source
                </button>
                <button
                  onClick={() => {
                    const fileName = useStore.getState().fileName ?? 'Document'
                    const section = useStore.getState().activeSection ?? ''
                    const toc = useStore.getState().toc
                    const sectionName = toc.find((t) => t.id === section)?.text ?? ''
                    const cite = `"${menu?.text}" — ${fileName}${sectionName ? `, ${sectionName}` : ''}`
                    navigator.clipboard.writeText(cite)
                    setCopied(true); setShowCopyMenu(false); setTimeout(() => setCopied(false), 1500)
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                >
                  <Quote className="h-3 w-3" /> Cite this
                </button>
              </div>
            )}

            {/* More dropdown — secondary AI + tools */}
            {showMore && (
              <div className="border-t border-gray-100 dark:border-gray-800 p-1 space-y-0.5 min-w-[220px]">
                <button
                  onClick={() => { handleAskAI('Explain this concisely in 2-3 sentences. Use simple language.'); trackEvent('ai_explain'); setShowMore(false) }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                >
                  <Bot className="h-3 w-3" /> Explain with AI
                </button>
                <button
                  onClick={() => { handleAskAI('Explain this to a 10-year-old in 2-3 simple sentences. Use everyday words. No jargon.'); trackEvent('ai_explain'); setShowMore(false) }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                >
                  <span className="inline-block w-3 text-center font-bold">5</span> Simplify (ELI5)
                </button>
                <button
                  onClick={() => { handleAskAI('Define this term or concept. Give a clear, concise definition and one example.'); setShowMore(false) }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                >
                  <BookOpen className="h-3 w-3" /> Define
                </button>
                {(() => { const g = isViewModeGated('diagram'); return !g || enabledFeatures.has(g) })() && (
                  <button
                    onClick={() => { useStore.getState().setViewMode('diagram'); setMenu(null) }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                  >
                    <Shapes className="h-3 w-3" /> Diagram this
                  </button>
                )}
                <button
                  onClick={() => { handleSearch(); setShowMore(false) }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                >
                  <Search className="h-3 w-3" /> Find in document
                </button>
                <button
                  onClick={() => {
                    if (!menu) return
                    const term = menu.text.split(/\s+/).slice(0, 3).join(' ')
                    const docId = useStore.getState().activeDocId ?? 'unsaved'
                    const key = `md-reader-glossary-${docId}`
                    const glossary = JSON.parse(localStorage.getItem(key) ?? '{}')
                    glossary[term] = menu.text
                    localStorage.setItem(key, JSON.stringify(glossary))
                    setMenu(null)
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                >
                  <BookOpen className="h-3 w-3" /> Save to glossary
                </button>
              </div>
            )}
          </div>

          {/* Inline comment input */}
          {showCommentInput && (
            <div className="mt-1.5 bg-white dark:bg-gray-900 sepia:bg-sepia-50 border border-gray-200 dark:border-gray-800 sepia:border-sepia-200 rounded-xl shadow-xl p-2 w-72">
              <textarea
                rows={2}
                autoFocus
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSaveComment()
                  }
                }}
                placeholder="Add a comment..."
                className="w-full text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-gray-400">Enter to save, Shift+Enter for newline</span>
                <button
                  onClick={handleSaveComment}
                  disabled={!commentText.trim()}
                  className="text-xs px-2 py-0.5 bg-teal-600 text-white rounded hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Highlights sidebar toggle */}
      {highlights.length > 0 && (
        <button
          onClick={() => setShowHighlights(!showHighlights)}
          className="fixed bottom-6 left-6 z-20 p-2.5 bg-amber-500 text-white rounded-full shadow-lg hover:bg-amber-600 transition-colors"
          title={`${highlights.length} highlights`}
        >
          <Highlighter className="h-4 w-4" />
          <span className="absolute -top-1 -right-1 bg-white text-amber-600 text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
            {highlights.length}
          </span>
        </button>
      )}

      {/* Glossary toggle */}
      {(() => {
        const docId = activeDocId ?? 'unsaved'
        const count = Object.keys(JSON.parse(localStorage.getItem(`md-reader-glossary-${docId}`) ?? '{}')).length
        return count > 0 ? (
          <button
            onClick={() => setShowGlossary(!showGlossary)}
            className="fixed bottom-[4.5rem] left-6 z-20 p-2.5 bg-indigo-500 text-white rounded-full shadow-lg hover:bg-indigo-600 transition-colors"
            title={`Glossary (${count} terms)`}
          >
            <BookOpen className="h-4 w-4" />
            <span className="absolute -top-1 -right-1 bg-white text-indigo-600 text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
              {count}
            </span>
          </button>
        ) : null
      })()}

      {/* Glossary panel */}
      {showGlossary && (
        <div className="fixed bottom-16 right-16 z-20 w-80 max-h-96 overflow-y-auto bg-white dark:bg-gray-900 sepia:bg-sepia-50 border border-gray-200 dark:border-gray-800 sepia:border-sepia-200 rounded-xl shadow-xl p-3 space-y-2 animate-pop-in">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-semibold uppercase text-gray-400 tracking-wider">Glossary</h4>
            <button onClick={() => setShowGlossary(false)} className="text-gray-400 hover:text-gray-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {(() => {
            const docId = activeDocId ?? 'unsaved'
            const glossary = JSON.parse(localStorage.getItem(`md-reader-glossary-${docId}`) ?? '{}')
            const entries = Object.entries(glossary)
            if (entries.length === 0) return <p className="text-xs text-gray-400 italic">No terms defined yet. Select text and click the book icon to add.</p>
            return entries.map(([term, def]) => (
              <div key={term} className="border-b border-gray-100 dark:border-gray-800 pb-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{term}</span>
                  <button
                    onClick={() => {
                      const g = JSON.parse(localStorage.getItem(`md-reader-glossary-${docId}`) ?? '{}')
                      delete g[term]
                      localStorage.setItem(`md-reader-glossary-${docId}`, JSON.stringify(g))
                      setShowGlossary(false)
                      setTimeout(() => setShowGlossary(true), 10)
                    }}
                    className="text-[10px] text-red-400 hover:text-red-600"
                  >remove</button>
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{String(def)}</p>
              </div>
            ))
          })()}
        </div>
      )}

      {/* Highlights panel */}
      {showHighlights && (
        <div className="fixed bottom-16 left-6 z-20 w-80 max-h-96 overflow-y-auto bg-white dark:bg-gray-900 sepia:bg-sepia-50 border border-gray-200 dark:border-gray-800 sepia:border-sepia-200 rounded-xl shadow-xl p-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-semibold uppercase text-gray-400 tracking-wider">
              Highlights & Notes
            </h4>
            <div className="flex items-center gap-1">
              <button
                onClick={exportHighlights}
                className="text-[10px] text-blue-500 hover:text-blue-700"
                title="Export highlights as markdown"
              >
                Export
              </button>
              <button onClick={() => setShowHighlights(false)} className="text-gray-300 hover:text-gray-500">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {highlights.map((h) => (
            <div key={h.id} className="rounded-lg p-2.5" style={{ background: h.color + '30' }}>
              <p className="text-xs text-gray-800 dark:text-gray-200 leading-relaxed">
                &ldquo;{h.text.slice(0, 120)}{h.text.length > 120 ? '...' : ''}&rdquo;
              </p>
              <div className="flex items-center gap-1 mt-1.5">
                {h.note ? (
                  <p className="text-[10px] text-gray-500 italic flex-1">{h.note}</p>
                ) : (
                  <input
                    type="text"
                    placeholder="Add note..."
                    className="flex-1 text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-transparent text-gray-600 dark:text-gray-400"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleUpdateNote(h.id!, (e.target as HTMLInputElement).value)
                      }
                    }}
                  />
                )}
                <button
                  onClick={() => handleRemoveHighlight(h.id!)}
                  className="p-0.5 text-gray-300 hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
