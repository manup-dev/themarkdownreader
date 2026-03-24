import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { ArrowUp } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { useStore } from '../store/useStore'
import { extractToc, estimateReadingTime, wordCount, estimateDifficulty, slugify } from '../lib/markdown'

// Delight #24: Click heading to copy anchor link
function HeadingRenderer(level: number) {
  return function Heading({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
    const text = typeof children === 'string' ? children : String(children ?? '')
    const id = slugify(text)

    const handleClick = () => {
      const url = `${window.location.origin}${window.location.pathname}#${id}`
      navigator.clipboard.writeText(url)
      // Brief flash to confirm
      const el = document.getElementById(id)
      if (el) {
        el.style.transition = 'background 300ms'
        el.style.background = 'rgba(59,130,246,0.15)'
        setTimeout(() => { el.style.background = '' }, 800)
      }
      showToast('Link copied!')
    }

    const sharedProps = { id, ...props, className: 'scroll-mt-16 cursor-pointer group relative', onClick: handleClick, title: 'Click to copy link' }
    const anchor = <span className="absolute -left-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 text-blue-400 text-sm" aria-hidden="true">#</span>
    switch (level) {
      case 1: return <h1 {...sharedProps}>{anchor}{children}</h1>
      case 2: return <h2 {...sharedProps}>{anchor}{children}</h2>
      case 3: return <h3 {...sharedProps}>{anchor}{children}</h3>
      case 4: return <h4 {...sharedProps}>{anchor}{children}</h4>
      case 5: return <h5 {...sharedProps}>{anchor}{children}</h5>
      default: return <h6 {...sharedProps}>{anchor}{children}</h6>
    }
  }
}

// Delight #22: Code block with copy button
function CodeBlockRenderer({ children, className, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const isBlock = className?.includes('language-') || (typeof children === 'string' && children.includes('\n'))

  if (!isBlock) {
    return <code className={className} {...props}>{children}</code>
  }

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    const codeEl = document.querySelector('code.hljs:hover, pre:hover code') as HTMLElement | null
    const codeText = codeEl?.textContent ?? String(children ?? '')
    navigator.clipboard.writeText(codeText.trim())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const language = className?.match(/language-(\w+)/)?.[1] ?? null

  return (
    <div className="relative group">
      {language && (
        <span className="absolute top-2 left-2 px-1.5 py-0.5 text-[10px] rounded bg-gray-700/80 text-gray-400 font-mono">
          {language}
        </span>
      )}
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 px-2 py-1 text-[10px] rounded bg-gray-700/80 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-600 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none"
      >
        {copied ? (language ? `Copied! (${language})` : 'Copied!') : 'Copy'}
      </button>
      <code className={className} {...props}>{children}</code>
    </div>
  )
}

// Delight #21: Image lightbox on click
function ImageRenderer({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        {...props}
        className="cursor-zoom-in rounded-lg hover:shadow-lg transition-shadow"
        onClick={() => setExpanded(true)}
      />
      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8 cursor-zoom-out"
          onClick={() => setExpanded(false)}
        >
          <img src={src} alt={alt} className="max-w-full max-h-full rounded-lg shadow-2xl" />
        </div>
      )}
    </>
  )
}

function showToast(message: string) {
  const toast = document.createElement('div')
  toast.className = 'toast-notify'
  toast.textContent = message
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), 2000)
}

const markdownComponents = {
  h1: HeadingRenderer(1),
  h2: HeadingRenderer(2),
  h3: HeadingRenderer(3),
  h4: HeadingRenderer(4),
  h5: HeadingRenderer(5),
  h6: HeadingRenderer(6),
  a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    const isExternal = href?.startsWith('http://') || href?.startsWith('https://')
    return <a href={href} {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...props}>{children}</a>
  },
  pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => <pre {...props} className="relative group">{children}</pre>,
  code: CodeBlockRenderer as never,
  img: ImageRenderer as never,
}

const themeConfig = {
  light: {
    container: 'bg-white text-gray-900',
    prose: 'prose prose-gray prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-a:text-blue-600 prose-code:text-gray-800 prose-code:bg-gray-100 prose-pre:bg-gray-50 prose-pre:text-gray-800 prose-blockquote:text-gray-600 prose-blockquote:border-gray-300 prose-li:text-gray-700 prose-td:text-gray-700 prose-th:text-gray-900',
    stats: 'text-gray-400',
    progressBg: 'bg-gray-200',
  },
  dark: {
    container: 'bg-gray-950 text-gray-100',
    prose: 'prose prose-invert prose-headings:text-gray-100 prose-p:text-gray-300 prose-strong:text-gray-100 prose-a:text-blue-400 prose-code:text-gray-200 prose-code:bg-gray-800 prose-pre:bg-gray-900 prose-pre:text-gray-200 prose-blockquote:text-gray-400 prose-blockquote:border-gray-700 prose-li:text-gray-300 prose-td:text-gray-300 prose-th:text-gray-100',
    stats: 'text-gray-500',
    progressBg: 'bg-gray-800',
  },
  sepia: {
    container: 'bg-sepia-50 text-sepia-900',
    prose: 'prose prose-headings:text-sepia-900 prose-p:text-sepia-800 prose-strong:text-sepia-900 prose-a:text-amber-700 prose-code:text-sepia-800 prose-code:bg-sepia-100 prose-pre:bg-sepia-100 prose-pre:text-sepia-800 prose-blockquote:text-sepia-800 prose-blockquote:border-sepia-200 prose-li:text-sepia-800 prose-td:text-sepia-800 prose-th:text-sepia-900',
    stats: 'text-sepia-800/70',
    progressBg: 'bg-sepia-200',
  },
  'high-contrast': {
    container: 'bg-black text-white',
    prose: 'prose prose-headings:text-yellow-300 prose-p:text-white prose-strong:text-yellow-300 prose-a:text-cyan-400 prose-code:text-green-400 prose-code:bg-gray-900 prose-pre:bg-gray-900 prose-pre:text-green-400 prose-blockquote:text-yellow-200 prose-blockquote:border-yellow-500 prose-li:text-white prose-td:text-white prose-th:text-yellow-300',
    stats: 'text-gray-400',
    progressBg: 'bg-gray-800',
  },
} as const

export function Reader() {
  const markdown = useStore((s) => s.markdown)
  const theme = useStore((s) => s.theme)
  const fontSize = useStore((s) => s.fontSize)
  const activeDocId = useStore((s) => s.activeDocId)
  const activeSection = useStore((s) => s.activeSection)
  const dyslexicFont = useStore((s) => s.dyslexicFont)
  const setToc = useStore((s) => s.setToc)
  const setReadingProgress = useStore((s) => s.setReadingProgress)
  const setActiveSection = useStore((s) => s.setActiveSection)
  const toc = useStore((s) => s.toc)
  const readingProgress = useStore((s) => s.readingProgress)
  const contentRef = useRef<HTMLDivElement>(null)
  const [resumeToast, setResumeToast] = useState<string | null>(null)
  const [firstTimeTip, setFirstTimeTip] = useState(() => !localStorage.getItem('md-reader-tip-shown'))
  useEffect(() => {
    if (firstTimeTip) {
      localStorage.setItem('md-reader-tip-shown', '1')
      setTimeout(() => setFirstTimeTip(false), 6000)
    }
  }, [firstTimeTip])

  useEffect(() => {
    const entries = extractToc(markdown)
    setToc(entries)
  }, [markdown, setToc])

  // Dynamic page title with progress
  useEffect(() => {
    const name = useStore.getState().fileName ?? 'Document'
    document.title = readingProgress > 1
      ? `${name} (${Math.round(readingProgress)}%) — md-reader`
      : `${name} — md-reader`
    return () => { document.title = 'md-reader — AI Markdown Reader' }
  }, [readingProgress])

  // Delight #9: Restore scroll position from localStorage
  useEffect(() => {
    if (!activeDocId || !contentRef.current) return
    const saved = localStorage.getItem(`md-reader-scroll-${activeDocId}`)
    if (saved) {
      const pct = parseFloat(saved)
      if (pct > 5) {
        requestAnimationFrame(() => {
          const el = contentRef.current
          if (!el) return
          const target = (el.scrollHeight - el.clientHeight) * (pct / 100)
          el.scrollTo({ top: target })
          setResumeToast(`Resuming from ${Math.round(pct)}%`)
          setTimeout(() => setResumeToast(null), 2000)
        })
      }
    }
  }, [activeDocId])

  // Restore scroll position when returning from another view
  useEffect(() => {
    const saved = useStore.getState().readScrollTop
    if (saved > 0 && contentRef.current) {
      contentRef.current.scrollTop = saved
    }
  }, [])

  const words = useMemo(() => wordCount(markdown), [markdown])
  const readTime = useMemo(() => estimateReadingTime(markdown), [markdown])
  const difficulty = useMemo((): string => estimateDifficulty(markdown), [markdown])
  const codeBlockCount = useMemo(() => Math.floor((markdown.match(/```/g) ?? []).length / 2), [markdown])
  const hasMath = useMemo(() => /\$\$|\\\(|\\\[/.test(markdown), [markdown])

  const lastSaveRef = useRef(0)

  const handleScroll = useCallback(() => {
    const el = contentRef.current
    if (!el) return

    // Save scroll position for view switch restore
    useStore.getState().setReadScrollTop(el.scrollTop)

    const scrollTop = el.scrollTop
    const scrollHeight = el.scrollHeight - el.clientHeight
    const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0
    setReadingProgress(Math.min(100, progress))

    // Live WPM calculation
    const now = Date.now()
    const elapsed = (now - lastScrollRef.current.time) / 1000
    if (elapsed > 2 && elapsed < 30) {
      const progressDelta = progress - (lastScrollRef.current.top / Math.max(1, scrollHeight)) * 100
      if (progressDelta > 0) {
        const wordsRead = (progressDelta / 100) * words
        const wpm = Math.round((wordsRead / elapsed) * 60)
        if (wpm > 50 && wpm < 800) { setLiveWpm(wpm); setTimeout(() => setLiveWpm(null), 3000) }
      }
    }
    lastScrollRef.current = { time: now, top: scrollTop }

    // Save scroll position for resume (throttled)
    if (activeDocId && Date.now() - lastSaveRef.current > 500) {
      localStorage.setItem(`md-reader-scroll-${activeDocId}`, String(progress))
      lastSaveRef.current = Date.now()
    }

    let active: string | null = null
    for (let i = toc.length - 1; i >= 0; i--) {
      const heading = document.getElementById(toc[i].id)
      if (heading && heading.offsetTop <= scrollTop + 100) {
        active = toc[i].id
        break
      }
    }
    setActiveSection(active)
  }, [toc, setReadingProgress, setActiveSection, words, activeDocId])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  const [sessionMinutes, setSessionMinutes] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const interval = setInterval(() => {
      setSessionMinutes(Math.floor((Date.now() - start) / 60000))
    }, 60000)
    return () => clearInterval(interval)
  }, [markdown])

  // Reading speed calibration — track actual WPM
  const [liveWpm, setLiveWpm] = useState<number | null>(null)
  const lastScrollRef = useRef({ time: Date.now(), top: 0 })

  useEffect(() => {
    if (readingProgress < 20 || readingProgress > 95) return
    const elapsed = sessionMinutes
    if (elapsed >= 2) {
      const wordsRead = Math.round(words * (readingProgress / 100))
      const actualWpm = Math.round(wordsRead / elapsed)
      if (actualWpm > 50 && actualWpm < 600) {
        localStorage.setItem('md-reader-wpm', String(actualWpm))
      }
    }
  }, [sessionMinutes, readingProgress, words])

  const tc = themeConfig[theme]
  const [milestone, setMilestone] = useState<string | null>(null)

  const shownMilestones = useRef(new Set<string>())

  // Delight #4: Progress milestones
  useEffect(() => {
    const pct = Math.round(readingProgress)
    if ((pct === 25 || pct === 50 || pct === 75) && !shownMilestones.current.has(`${pct}`)) {
      shownMilestones.current.add(`${pct}`)
      setMilestone(`${pct}%`)
      setTimeout(() => setMilestone(null), 1500)
    } else if (pct >= 99 && !shownMilestones.current.has('done')) {
      shownMilestones.current.add('done')
      setMilestone('Done!')
      setTimeout(() => setMilestone(null), 2500)
      // Confetti burst
      const container = document.createElement('div')
      container.className = 'confetti-burst'
      document.body.appendChild(container)
      setTimeout(() => container.remove(), 3000)
    }
  }, [readingProgress])

  // Time-based reading milestones
  useEffect(() => {
    if (sessionMinutes === 5 && !shownMilestones.current.has('5min')) {
      shownMilestones.current.add('5min')
      setMilestone('5 min focused!')
      setTimeout(() => setMilestone(null), 1500)
    } else if (sessionMinutes === 15 && !shownMilestones.current.has('15min')) {
      shownMilestones.current.add('15min')
      setMilestone('15 min deep read!')
      setTimeout(() => setMilestone(null), 1500)
    }
  }, [sessionMinutes])

  const scrollToTop = () => contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)

  // Click handler for images — open in lightbox
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'IMG' && target.closest('article')) {
        setZoomedImage((target as HTMLImageElement).src)
      }
    }
    el.addEventListener('click', handleClick)
    return () => el.removeEventListener('click', handleClick)
  }, [])

  // Double-click word to search
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const handleDblClick = () => {
      const sel = window.getSelection()?.toString().trim()
      if (sel && sel.length > 1 && sel.length < 50 && !sel.includes('\n')) {
        // Dispatch Ctrl+K to open search, then fill it
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
        // Fill search after overlay opens
        setTimeout(() => {
          const input = document.querySelector('[placeholder="Search in document..."]') as HTMLInputElement
          if (input) { input.value = sel; input.dispatchEvent(new Event('input', { bubbles: true })) }
        }, 100)
      }
    }
    el.addEventListener('dblclick', handleDblClick)
    return () => el.removeEventListener('dblclick', handleDblClick)
  }, [])

  return (
    <div
      ref={contentRef}
      className={`flex-1 overflow-y-auto ${tc.container} relative`}
      style={{ scrollBehavior: 'smooth' }}
    >
      {/* Reading progress bar */}
      <div className={`sticky top-0 z-20 h-1 ${tc.progressBg} flex`}>
        {toc.filter((t) => t.level <= 2).length > 1 ? (
          toc.filter((t) => t.level <= 2).map((entry, i, arr) => {
            const segWidth = 100 / arr.length
            const segStart = i * segWidth
            const filled = Math.max(0, Math.min(100, ((readingProgress - segStart) / segWidth) * 100))
            const isActive = activeSection === entry.id
            return (
              <div
                key={entry.id}
                className={`h-full relative ${i > 0 ? 'border-l border-white/20 dark:border-black/20' : ''}`}
                style={{ width: `${segWidth}%` }}
                title={entry.text}
              >
                <div
                  className={`h-full transition-all duration-150 ${isActive ? 'bg-blue-600' : milestone === 'Done!' ? 'bg-green-500' : 'bg-blue-400'}`}
                  style={{ width: `${filled}%` }}
                />
              </div>
            )
          })
        ) : (
          <div
            className={`h-full transition-all duration-150 ${milestone === 'Done!' ? 'bg-green-500' : 'bg-blue-500'}`}
            style={{ width: `${readingProgress}%` }}
          />
        )}
      </div>

      {/* Live WPM indicator */}
      {liveWpm && (
        <div className="fixed top-3 right-16 z-30 px-2 py-0.5 rounded-full bg-gray-800/80 text-white text-[10px] font-mono animate-fade-in">
          {liveWpm} WPM
        </div>
      )}

      {/* Resume toast */}
      {resumeToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 rounded-full bg-gray-800 text-white text-xs shadow-lg">
          {resumeToast}
        </div>
      )}

      {/* First-time tip */}
      {firstTimeTip && (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs shadow-lg animate-slide-down cursor-pointer max-w-sm text-center"
          onClick={() => setFirstTimeTip(false)}
        >
          Press <kbd className="px-1 py-0.5 bg-blue-500 rounded text-[10px]">?</kbd> for shortcuts &middot; Try the tabs above to explore &middot; Click the chat icon to ask AI
        </div>
      )}

      {/* Milestone flash */}
      {milestone && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 rounded-full bg-blue-600 text-white text-sm font-bold shadow-lg animate-bounce">
          {milestone}
        </div>
      )}

      {/* Delight #28: Breadcrumb trail */}
      {activeSection && (() => {
        const activeIdx = toc.findIndex((t) => t.id === activeSection)
        if (activeIdx < 0) return null
        const crumbs: string[] = []
        const activeLevel = toc[activeIdx].level
        for (let i = activeIdx; i >= 0; i--) {
          if (toc[i].level < activeLevel || i === activeIdx) {
            if (toc[i].level < (crumbs.length > 0 ? toc[toc.findIndex((t) => t.text === crumbs[0])]?.level ?? 99 : 99) || crumbs.length === 0) {
              crumbs.unshift(toc[i].text)
            }
          }
          if (toc[i].level === 1) break
        }
        if (crumbs.length <= 1) return null
        return (
          <div className={`max-w-3xl mx-auto px-8 pt-6 pb-0 text-[11px] ${tc.stats}`}>
            {crumbs.map((c, i) => (
              <span key={i}>
                {i > 0 && <span className="mx-1 opacity-40">/</span>}
                <span className={i === crumbs.length - 1 ? 'font-medium opacity-70' : 'opacity-40'}>{c}</span>
              </span>
            ))}
          </div>
        )
      })()}

      {/* Document stats */}
      <div
        className={`max-w-3xl mx-auto px-8 ${activeSection ? 'pt-2' : 'pt-8'} pb-2 flex items-center gap-4 text-xs ${tc.stats} cursor-pointer hover:opacity-70 transition-opacity`}
        onClick={() => {
          const stats = `${words.toLocaleString()} words | ${readTime} min read | ${difficulty}`
          navigator.clipboard.writeText(stats)
          showToast('Stats copied!')
        }}
        title="Click to copy stats"
      >
        <span>{words.toLocaleString()} words</span>
        {/* Delight #29: Reading time countdown */}
        <span>
          {readingProgress > 5
            ? (() => {
                const minsLeft = Math.max(1, Math.ceil(readTime * (1 - readingProgress / 100)))
                const finishTime = new Date(Date.now() + minsLeft * 60000)
                return `~${minsLeft} min left (${finishTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`
              })()
            : `${readTime} min read`}
        </span>
        {sessionMinutes > 0 && (
          <span className="text-[10px] text-gray-400">{sessionMinutes}m reading</span>
        )}
        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
          { Beginner: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400',
            Intermediate: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400',
            Advanced: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400',
            Expert: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400',
          }[difficulty]
        }`}>
          {difficulty}
        </span>
        {codeBlockCount > 0 && (
          <span className="text-[10px] text-gray-400">{Math.floor(codeBlockCount)} code blocks</span>
        )}
        {hasMath && (
          <span className="text-[10px] text-gray-400">has math</span>
        )}
      </div>

      {/* Markdown content */}
      <article
        aria-label="Document content"
        className={`max-w-3xl mx-auto px-8 pb-32 ${tc.prose} prose-headings:font-semibold prose-code:before:hidden prose-code:after:hidden prose-img:rounded-lg ${dyslexicFont ? 'font-dyslexic' : ''}`}
        style={{ fontSize: `${fontSize}px`, lineHeight: dyslexicFont ? 2.0 : 1.75, letterSpacing: dyslexicFont ? '0.05em' : undefined, wordSpacing: dyslexicFont ? '0.15em' : undefined }}
      >
        <Markdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeHighlight, rehypeKatex]}
          components={markdownComponents}
        >
          {markdown}
        </Markdown>
      </article>

      {/* Delight #25: Minibar outline on right edge */}
      {toc.length > 2 && (
        <div className="fixed top-16 right-1 bottom-16 w-1 z-10 opacity-30 hover:opacity-60 transition-opacity">
          {toc.filter((t) => t.level <= 2).map((entry, i, arr) => {
            const pct = (i / arr.length) * 100
            const isActive = activeSection === entry.id
            return (
              <button
                key={entry.id}
                onClick={() => document.getElementById(entry.id)?.scrollIntoView({ behavior: 'smooth' })}
                className={`absolute left-0 w-full rounded-full transition-all ${isActive ? 'bg-blue-500 h-2' : 'bg-gray-400 dark:bg-gray-600 h-1'}`}
                style={{ top: `${pct}%` }}
                title={entry.text}
              />
            )
          })}
          {/* Current position indicator */}
          <div
            className="absolute left-0 w-full h-3 bg-blue-500/50 rounded-full"
            style={{ top: `${readingProgress}%` }}
          />
        </div>
      )}

      {/* Delight #2: Back to top button */}
      {readingProgress > 15 && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-20 right-20 p-2.5 bg-gray-800/70 dark:bg-gray-200/70 text-white dark:text-gray-900 rounded-full shadow-lg hover:bg-gray-800 dark:hover:bg-gray-200 transition-all opacity-60 hover:opacity-100 z-10"
          title="Back to top"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}

      {/* Image lightbox */}
      {zoomedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out p-8"
          onClick={() => setZoomedImage(null)}
        >
          <img
            src={zoomedImage}
            alt="Zoomed"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}
    </div>
  )
}
