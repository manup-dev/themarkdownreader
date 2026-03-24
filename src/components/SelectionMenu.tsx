import { useState, useEffect, useCallback, useRef } from 'react'
import { Highlighter, Search, Bot, BookOpen, Copy, X, Loader2, Check, Quote, FileText, MessageSquare } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store/useStore'
import { addHighlight, getHighlights, removeHighlight, updateHighlightNote, addComment, type Highlight } from '../lib/docstore'
import { chat } from '../lib/ai'

const COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa']
const COLOR_NAMES: Record<string, string> = {
  '#fef08a': 'yellow',
  '#bbf7d0': 'green',
  '#bfdbfe': 'blue',
  '#fbcfe8': 'pink',
  '#fed7aa': 'orange',
}

interface MenuPos {
  x: number
  y: number
  text: string
}

export function SelectionMenu() {
  const activeDocId = useStore((s) => s.activeDocId)
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
  const menuRef = useRef<HTMLDivElement>(null)

  const refreshHighlights = useCallback(async () => {
    if (!activeDocId) return
    setHighlights(await getHighlights(activeDocId))
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
        }
        return
      }

      const text = sel.toString().trim()
      if (text.length < 2) return

      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()

      setMenu({
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
        text,
      })
      setAiResponse(null)
    }

    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [])

  const handleHighlight = useCallback(async (color: string) => {
    if (!menu || !activeDocId) return
    await addHighlight({
      docId: activeDocId,
      text: menu.text,
      startOffset: 0,
      endOffset: 0,
      color,
      note: '',
      createdAt: Date.now(),
    })
    // Visual flash to confirm highlight was saved
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      const span = document.createElement('span')
      span.style.background = color
      span.style.transition = 'background 800ms ease-out'
      span.style.borderRadius = '2px'
      try {
        range.surroundContents(span)
        setTimeout(() => { span.style.background = 'transparent' }, 100)
        setTimeout(() => { span.replaceWith(...span.childNodes) }, 1000)
      } catch { /* selection spans multiple elements — skip visual flash */ }
    }
    window.getSelection()?.removeAllRanges()
    setMenu(null)
    await refreshHighlights()
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
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let found = false
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (node.textContent?.includes(menu.text) && !found) {
        const el = node.parentElement
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          // Flash highlight
          el.style.background = '#fef08a'
          setTimeout(() => { el.style.background = '' }, 2000)
          found = true
        }
      }
    }
    setMenu(null)
  }, [menu])

  const handleSaveComment = useCallback(async () => {
    if (!menu || !activeDocId || !commentText.trim()) return
    const sectionId = useStore.getState().activeSection ?? ''
    const author = localStorage.getItem('md-reader-username') || 'You'
    await addComment({
      docId: activeDocId,
      selectedText: menu.text,
      comment: commentText.trim(),
      author,
      sectionId,
      createdAt: Date.now(),
      resolved: false,
    })
    setCommentText('')
    setShowCommentInput(false)
    window.getSelection()?.removeAllRanges()
    setMenu(null)
    // Toast notification
    const toast = document.createElement('div')
    toast.className = 'toast-notify fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-green-600 text-white text-sm rounded-lg shadow-lg'
    toast.textContent = 'Comment saved'
    document.body.appendChild(toast)
    setTimeout(() => toast.remove(), 2000)
  }, [menu, activeDocId, commentText])

  const handleRemoveHighlight = useCallback(async (id: number) => {
    await removeHighlight(id)
    await refreshHighlights()
  }, [refreshHighlights])

  const handleUpdateNote = useCallback(async (id: number, note: string) => {
    await updateHighlightNote(id, note)
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
          className="fixed z-50 transform -translate-x-1/2 -translate-y-full animate-pop-in"
          style={{ left: menu.x, top: menu.y }}
        >
          {/* AI response popup */}
          {(aiResponse || aiLoading) && (
            <div className="mb-2 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-3 max-h-60 overflow-y-auto">
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

          {/* Action buttons */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-1.5 flex items-center gap-0.5">
            {/* Highlight colors */}
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => handleHighlight(c)}
                className="w-6 h-6 rounded-full border-2 border-transparent hover:border-gray-400 transition-all hover:scale-110"
                style={{ background: c }}
                title={`Highlight ${COLOR_NAMES[c] ?? c}`}
                aria-label={`Highlight ${COLOR_NAMES[c] ?? c}`}
              />
            ))}

            <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />

            <button
              onClick={() => { setShowCommentInput(!showCommentInput); setCommentText('') }}
              className="p-1.5 text-gray-500 hover:text-teal-500 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Add comment"
            >
              <MessageSquare className="h-4 w-4" />
            </button>

            <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />

            <button
              onClick={() => handleAskAI('Explain this concisely in 2-3 sentences. Use simple language.')}
              className="p-1.5 text-gray-500 hover:text-blue-500 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Explain with AI"
            >
              <Bot className="h-4 w-4" />
            </button>

            <button
              onClick={() => handleAskAI('Explain this to a 10-year-old in 2-3 simple sentences. Use everyday words. No jargon.')}
              className="p-1.5 text-gray-500 hover:text-emerald-500 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Simplify (ELI5)"
            >
              <span className="text-xs font-bold">5</span>
            </button>

            <button
              onClick={() => handleAskAI('Describe this as if explaining a diagram. Use simple ASCII art or arrows if helpful. Max 100 words.')}
              className="p-1.5 text-gray-500 hover:text-orange-500 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Visualize as diagram"
            >
              <span className="text-xs">▣</span>
            </button>

            <button
              onClick={() => handleAskAI('Define this term or concept. Give a clear, concise definition and one example.')}
              className="p-1.5 text-gray-500 hover:text-purple-500 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Define"
            >
              <BookOpen className="h-4 w-4" />
            </button>

            <button
              onClick={handleSearch}
              className="p-1.5 text-gray-500 hover:text-amber-500 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Find in document"
            >
              <Search className="h-4 w-4" />
            </button>

            <button
              onClick={() => {
                if (!menu) return
                const chatFab = document.querySelector('.fixed.bottom-6.right-6') as HTMLButtonElement
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
              className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              title="Ask about this in Chat"
            >
              <div className="flex items-center gap-0.5">
                <Bot className="h-3.5 w-3.5" />
                <span className="text-[8px]">Chat</span>
              </div>
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
              className="p-1.5 text-gray-500 hover:text-indigo-500 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Save to glossary"
            >
              <BookOpen className="h-4 w-4" />
            </button>

            <div className="relative">
              <button
                onClick={handleCopy}
                onContextMenu={(e) => { e.preventDefault(); setShowCopyMenu(!showCopyMenu) }}
                className={`p-1.5 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 ${copied ? 'text-green-500' : 'text-gray-500 hover:text-green-500'}`}
                title="Copy (right-click for options)"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
              {showCopyMenu && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-xl p-1 min-w-36 z-50">
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
            </div>

            <button
              onClick={() => { setMenu(null); setAiResponse(null) }}
              className="p-1.5 text-gray-300 hover:text-gray-500 transition-colors rounded-lg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Inline comment input */}
          {showCommentInput && (
            <div className="mt-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-2 w-72">
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
        <div className="fixed bottom-16 right-16 z-20 w-80 max-h-96 overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-3 space-y-2 animate-pop-in">
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
        <div className="fixed bottom-16 left-6 z-20 w-80 max-h-96 overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-3 space-y-2">
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
