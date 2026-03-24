import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { ArrowUp } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { useStore } from '../store/useStore'
import { extractToc, wordCount, estimateDifficulty, slugify } from '../lib/markdown'
import { getComments, updateComment, removeComment, type Comment } from '../lib/docstore'
import { trackEvent } from '../lib/telemetry'

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

// Delight #21: Image lazy loading + zoom cursor (lightbox handled by useEffect click handler)
function ImageRenderer({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      {...props}
      className="cursor-zoom-in rounded-lg hover:shadow-lg transition-shadow"
    />
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
    // Same-file anchor links — smooth scroll to heading
    if (href?.startsWith('#')) {
      return (
        <a
          href={href}
          {...props}
          onClick={(e) => {
            e.preventDefault()
            const id = href.slice(1)
            const el = document.getElementById(id)
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              el.style.transition = 'background 300ms'
              el.style.background = 'rgba(59,130,246,0.15)'
              setTimeout(() => { el.style.background = '' }, 1500)
            }
          }}
        >
          {children}
        </a>
      )
    }
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
  const fileName = useStore((s) => s.fileName)
  const contentRef = useRef<HTMLDivElement>(null)

  // Feature 17: URL fragment sharing state
  const [linkCopied, setLinkCopied] = useState(false)

  // Feature 18: Ambient background hue
  const [ambientHue, setAmbientHue] = useState(0)

  // Feature 20: Diff viewer state
  const prevMarkdownRef = useRef<string | null>(null)
  const [diffChanges, setDiffChanges] = useState<Set<number>>(new Set())
  const [showDiffHighlight, setShowDiffHighlight] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const [resumeToast, setResumeToast] = useState<{ text: string; scrollTop: number } | null>(null)
  const [statsExpanded, setStatsExpanded] = useState(false)
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

  // Feature 17: Parse URL hash on load and scroll to section
  useEffect(() => {
    const hash = window.location.hash
    const match = hash.match(/#read\/section=(.+)/)
    if (match) {
      const sectionId = decodeURIComponent(match[1])
      requestAnimationFrame(() => {
        const el = document.getElementById(sectionId)
        if (el) el.scrollIntoView({ behavior: 'smooth' })
      })
    }
  }, [markdown])

  // Feature 17: Update URL hash as user reads
  useEffect(() => {
    if (activeSection) {
      const newHash = `#read/section=${encodeURIComponent(activeSection)}`
      if (window.location.hash !== newHash) {
        window.history.replaceState(null, '', newHash)
      }
    }
  }, [activeSection])

  // Feature 18: Ambient hue shift based on top-level section index
  useEffect(() => {
    if (!activeSection || theme === 'dark' || theme === 'high-contrast') {
      setAmbientHue(0)
      return
    }
    const topLevelSections = toc.filter((t) => t.level <= 2)
    // Find which top-level section the active section belongs to
    const activeIdx = toc.findIndex((t) => t.id === activeSection)
    let topIdx = 0
    for (let i = activeIdx; i >= 0; i--) {
      if (toc[i].level <= 2) {
        topIdx = topLevelSections.findIndex((t) => t.id === toc[i].id)
        break
      }
    }
    setAmbientHue(topIdx * 30)
  }, [activeSection, toc, theme])

  // Feature 20: Detect changes when markdown updates for same fileName
  useEffect(() => {
    if (!fileName) return
    const storageKey = `md-reader-prev-content-${fileName}`
    const prevContent = sessionStorage.getItem(storageKey)

    if (prevContent && prevContent !== markdown) {
      const changedIndices = new Set<number>()

      // Find changed/added paragraph blocks by comparing paragraphs
      const prevParagraphs = prevContent.split(/\n\n+/)
      const newParagraphs = markdown.split(/\n\n+/)

      for (let i = 0; i < newParagraphs.length; i++) {
        if (i >= prevParagraphs.length || newParagraphs[i] !== prevParagraphs[i]) {
          changedIndices.add(i)
        }
      }

      if (changedIndices.size > 0) {
        setDiffChanges(changedIndices)
        setHasChanges(true)
        prevMarkdownRef.current = prevContent
      }
    }

    // Store current content for next comparison
    sessionStorage.setItem(storageKey, markdown)
  }, [markdown, fileName])

  const words = useMemo(() => wordCount(markdown), [markdown])
  const [calibratedWpm, setCalibratedWpm] = useState(() => parseInt(localStorage.getItem('md-reader-wpm') ?? '230') || 230)
  const readTime = useMemo(() => Math.max(1, Math.ceil(markdown.split(/\s+/).filter(Boolean).length / calibratedWpm)), [markdown, calibratedWpm])
  const difficulty = useMemo((): string => estimateDifficulty(markdown), [markdown])
  const codeBlockCount = useMemo(() => Math.floor((markdown.match(/```/g) ?? []).length / 2), [markdown])
  const hasMath = useMemo(() => /\$\$|\\\(|\\\[/.test(markdown), [markdown])
  const contentType = useMemo(() => {
    const hasSteps = /^\d+\.\s/m.test(markdown) && (markdown.match(/^\d+\.\s/gm) ?? []).length >= 3
    const hasApi = /\b(API|endpoint|request|response|GET|POST|PUT|DELETE|status code)\b/i.test(markdown)
    const hasCode = (markdown.match(/```/g) ?? []).length >= 4
    const hasTables = (markdown.match(/^\|/gm) ?? []).length >= 4
    if (hasApi && hasCode) return 'API Docs'
    if (hasSteps && hasCode) return 'Tutorial'
    if (hasTables && !hasSteps) return 'Reference'
    if (hasCode) return 'Technical'
    return 'Narrative'
  }, [markdown])
  const keyTerm = useMemo(() => {
    const text = markdown.toLowerCase()
    const wordList = text.match(/\b[a-z]{4,}\b/g) ?? []
    const freq = new Map<string, number>()
    const stop = new Set(['this','that','with','from','have','been','will','your','they','their','which','when','what','each','other','about','more','than','also','only','into','some','very','just','like','over','such','most','these','there','could','would','should','using','where','after','before','because','through','between','under','above','within','without','during','following','along','across','behind','beyond','every','another','those','being','while','since','until','however','although','either','neither','whether','among','around','against','though','still','already','rather','often','never','always','sometimes','usually','perhaps','quite','really','actually','certainly','definitely','probably','possibly','maybe'])
    for (const w of wordList) { if (!stop.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1) }
    const top = [...freq.entries()].filter(([,c]) => c >= 3).sort((a,b) => b[1]-a[1])[0]
    return top ?? null
  }, [markdown])
  const quotableSentence = useMemo(() => {
    const sentences = markdown.split(/[.!?]\s+/).filter((s) => s.length > 30 && s.length < 200)
    const scored = sentences.map((s) => ({
      text: s.replace(/[#*`\[\]()]/g, '').trim(),
      score: (s.match(/\*\*[^*]+\*\*/g) ?? []).length + (s.match(/\*[^*]+\*/g) ?? []).length
    })).filter((s) => s.score > 0 && s.text.length > 20)
    return scored.sort((a, b) => b.score - a.score)[0] ?? null
  }, [markdown])

  // Dynamic page title with progress
  useEffect(() => {
    const name = useStore.getState().fileName ?? 'Document'
    if (readingProgress > 5) {
      const minsLeft = Math.max(1, Math.ceil(readTime * (1 - readingProgress / 100)))
      document.title = `(${minsLeft}m left) ${name} — md-reader`
    } else {
      document.title = `${name} — md-reader`
    }
    return () => { document.title = 'md-reader — AI Markdown Reader' }
  }, [readingProgress, readTime])

  // Dynamic favicon showing reading progress
  const progressBucket = Math.round(readingProgress / 5) * 5
  useEffect(() => {
    if (readingProgress < 1) return
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Background
    ctx.fillStyle = '#2563eb'
    ctx.beginPath()
    ctx.arc(16, 16, 15, 0, Math.PI * 2)
    ctx.fill()
    // Progress arc
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(16, 16, 12, -Math.PI / 2, -Math.PI / 2 + (readingProgress / 100) * Math.PI * 2)
    ctx.stroke()
    // Percentage text
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${Math.round(readingProgress)}`, 16, 17)
    // Set as favicon
    const link = document.querySelector('link[rel="icon"]') as HTMLLinkElement
    if (link) link.href = canvas.toDataURL()
    return () => {
      if (link) link.href = '/favicon.svg'
    }
  }, [progressBucket]) // Update every 5%

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
          // Find the active section at this scroll position
          const currentToc = useStore.getState().toc
          let sectionName = ''
          for (let i = currentToc.length - 1; i >= 0; i--) {
            const heading = document.getElementById(currentToc[i].id)
            if (heading && heading.offsetTop <= target + 100) {
              sectionName = currentToc[i].text
              break
            }
          }
          const label = sectionName
            ? `Resuming at "${sectionName}" (${Math.round(pct)}%)`
            : `Resuming from ${Math.round(pct)}%`
          setResumeToast({ text: label, scrollTop: target })
          setTimeout(() => setResumeToast(null), 4000)
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
    if (progress >= 100 && useStore.getState().readingProgress < 100) trackEvent('reading_completed')

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
      // Track daily words read
      const today = new Date().toDateString()
      const todayKey = `md-reader-words-today-${today}`
      const wordsRead = Math.round(words * (progress / 100))
      const prev = parseInt(localStorage.getItem(todayKey) ?? '0')
      if (wordsRead > prev) localStorage.setItem(todayKey, String(wordsRead))
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

    // Track sections read for analytics
    if (active && activeDocId) {
      const key = `md-reader-sections-read-${activeDocId}`
      const read = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
      if (!read.includes(active)) {
        read.push(active)
        localStorage.setItem(key, JSON.stringify(read))
      }
    }
  }, [toc, setReadingProgress, setActiveSection, words, activeDocId])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  // Track time per section for analytics
  const sectionTimerRef = useRef<{ section: string | null; start: number }>({ section: null, start: Date.now() })
  useEffect(() => {
    const prev = sectionTimerRef.current
    if (prev.section && activeDocId) {
      const elapsed = Math.round((Date.now() - prev.start) / 1000)
      if (elapsed > 2 && elapsed < 600) { // Only track 2s-10min per section
        const key = `md-reader-section-time-${activeDocId}`
        const times = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, number>
        times[prev.section] = (times[prev.section] ?? 0) + elapsed
        localStorage.setItem(key, JSON.stringify(times))
      }
    }
    sectionTimerRef.current = { section: activeSection, start: Date.now() }
  }, [activeSection, activeDocId])

  const [sessionMinutes, setSessionMinutes] = useState(0)
  useEffect(() => {
    localStorage.setItem('md-reader-session-start', String(Date.now()))
    const start = Date.now()
    const interval = setInterval(() => {
      setSessionMinutes(Math.floor((Date.now() - start) / 60000))
    }, 60000)
    return () => {
      clearInterval(interval)
      const elapsed = Math.floor((Date.now() - start) / 60000)
      if (elapsed > 0) {
        const total = parseInt(localStorage.getItem('md-reader-total-reading-mins') ?? '0')
        localStorage.setItem('md-reader-total-reading-mins', String(total + elapsed))
      }
    }
  }, [markdown])

  // Reading speed calibration — track actual WPM
  const [liveWpm, setLiveWpm] = useState<number | null>(null)
  const lastScrollRef = useRef({ time: Date.now(), top: 0 })
  const [calibrationToast, setCalibrationToast] = useState<number | null>(null)

  useEffect(() => {
    if (readingProgress < 20 || readingProgress > 95) return
    const elapsed = sessionMinutes
    if (elapsed >= 2) {
      const wordsRead = Math.round(words * (readingProgress / 100))
      const actualWpm = Math.round(wordsRead / elapsed)
      if (actualWpm > 50 && actualWpm < 600) {
        localStorage.setItem('md-reader-wpm', String(actualWpm))
      }
      // Delight #12: One-time calibration prompt after 2 min of reading
      if (!localStorage.getItem('md-reader-wpm-calibrated') && actualWpm >= 100 && actualWpm <= 500) {
        setCalibrationToast(actualWpm)
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
      // Show reading report card after confetti settles
      setTimeout(() => setShowReport(true), 2000)
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
  const [showScrollHint, setShowScrollHint] = useState(true)
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const hide = () => setShowScrollHint(false)
    el.addEventListener('scroll', hide, { once: true, passive: true })
    return () => el.removeEventListener('scroll', hide)
  }, [markdown])
  const [showReport, setShowReport] = useState(false)
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

  // ─── Inline comment highlights ──────────────────────────────────────────
  const [inlineComments, setInlineComments] = useState<Comment[]>([])
  const [commentPopover, setCommentPopover] = useState<{ comment: Comment; x: number; y: number } | null>(null)
  const [editingCommentText, setEditingCommentText] = useState<string | null>(null)
  const appliedCommentIdsRef = useRef<Set<number>>(new Set())

  // Fetch comments when doc changes or when a comment is added/modified
  useEffect(() => {
    if (!activeDocId) { setInlineComments([]); appliedCommentIdsRef.current.clear(); return }
    const refresh = () => getComments(activeDocId).then(setInlineComments)
    refresh()
    // Listen for immediate refresh after comment save/edit/delete
    const onCommentChanged = () => refresh()
    window.addEventListener('md-reader-comment-changed', onCommentChanged)
    // Also poll every 3s as fallback
    const interval = setInterval(refresh, 3000)
    return () => {
      clearInterval(interval)
      window.removeEventListener('md-reader-comment-changed', onCommentChanged)
    }
  }, [activeDocId])

  // Apply inline highlights — only for newly added comments
  useEffect(() => {
    const article = contentRef.current?.querySelector('article')
    if (!article) return

    const unresolvedComments = inlineComments.filter((c) => !c.resolved)
    const currentIds = new Set(unresolvedComments.map((c) => c.id!))

    // Remove highlights for comments that no longer exist or are resolved
    document.querySelectorAll('[data-comment-highlight]').forEach((el) => {
      const id = Number(el.getAttribute('data-comment-highlight'))
      if (!currentIds.has(id)) {
        const parent = el.parentNode
        if (parent) {
          while (el.firstChild) parent.insertBefore(el.firstChild, el)
          parent.removeChild(el)
          parent.normalize()
        }
        appliedCommentIdsRef.current.delete(id)
      }
    })

    // Only apply highlights for comments we haven't already applied
    for (const comment of unresolvedComments) {
      if (appliedCommentIdsRef.current.has(comment.id!)) continue

      const searchText = comment.selectedText.trim()
      if (!searchText || searchText.length < 3) continue

      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
      let node: Text | null
      let found = false
      while ((node = walker.nextNode() as Text | null)) {
        const idx = node.textContent?.indexOf(searchText) ?? -1
        if (idx === -1) continue
        if (node.parentElement?.closest('[data-comment-highlight]')) continue

        const range = document.createRange()
        range.setStart(node, idx)
        range.setEnd(node, idx + searchText.length)

        const span = document.createElement('span')
        span.setAttribute('data-comment-highlight', String(comment.id))
        span.style.cssText = 'background: rgba(45, 212, 191, 0.15); border-bottom: 2px solid rgb(45, 212, 191); cursor: pointer; position: relative; padding: 1px 0;'

        const badge = document.createElement('span')
        badge.setAttribute('data-comment-badge', 'true')
        badge.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; background: rgb(45, 212, 191); color: white; border-radius: 50%; font-size: 10px; margin-left: 2px; cursor: pointer; vertical-align: super; line-height: 1;'
        badge.textContent = '\uD83D\uDCAC'
        badge.title = `${comment.author}: ${comment.comment.slice(0, 60)}`

        const handleClick = (e: Event) => {
          e.stopPropagation()
          const rect = span.getBoundingClientRect()
          const containerRect = contentRef.current?.getBoundingClientRect()
          setCommentPopover({
            comment,
            x: rect.left - (containerRect?.left ?? 0),
            y: rect.bottom - (containerRect?.top ?? 0) + (contentRef.current?.scrollTop ?? 0),
          })
        }
        span.addEventListener('click', handleClick)
        badge.addEventListener('click', handleClick)

        range.surroundContents(span)
        span.appendChild(badge)
        found = true
        break
      }
      if (found) appliedCommentIdsRef.current.add(comment.id!)
    }
  }, [inlineComments])

  // Dismiss comment popover on click outside
  useEffect(() => {
    if (!commentPopover) return
    const dismiss = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-comment-highlight]') && !target.closest('.z-50')) {
        setCommentPopover(null)
      }
    }
    window.addEventListener('click', dismiss)
    return () => window.removeEventListener('click', dismiss)
  }, [commentPopover])

  // Delight #15: Footnote popover on hover
  const footnoteMap = useMemo(() => {
    const map = new Map<string, string>()
    const regex = /^\[\^(\w+)\]:\s*(.+)$/gm
    let match
    while ((match = regex.exec(markdown)) !== null) {
      map.set(match[1], match[2].trim())
    }
    return map
  }, [markdown])

  const [footnotePopover, setFootnotePopover] = useState<{ content: string; x: number; y: number } | null>(null)

  useEffect(() => {
    const el = contentRef.current
    if (!el || footnoteMap.size === 0) return
    const handleOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Match rendered footnote ref links like [^1] which become <sup><a href="#...">
      if (target.tagName === 'A' && target.closest('sup')) {
        const href = target.getAttribute('href') ?? ''
        const fnId = href.replace(/^#.*fn-?/, '').replace(/^#.*footnote-?/, '').replace(/^#/, '')
        const content = footnoteMap.get(fnId)
        if (content) {
          const rect = target.getBoundingClientRect()
          setFootnotePopover({ content, x: rect.left + rect.width / 2, y: rect.top })
        }
      }
      // Also match raw text like [^1] that hasn't been rendered as links
      if (target.tagName === 'SUP' || (target.textContent?.match(/^\[\^\w+\]$/) && target.closest('article'))) {
        const fnId = target.textContent?.match(/\[\^(\w+)\]/)?.[1]
        if (fnId) {
          const content = footnoteMap.get(fnId)
          if (content) {
            const rect = target.getBoundingClientRect()
            setFootnotePopover({ content, x: rect.left + rect.width / 2, y: rect.top })
          }
        }
      }
    }
    const handleOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'A' && target.closest('sup') || target.tagName === 'SUP') {
        setFootnotePopover(null)
      }
    }
    el.addEventListener('mouseover', handleOver)
    el.addEventListener('mouseout', handleOut)
    return () => { el.removeEventListener('mouseover', handleOver); el.removeEventListener('mouseout', handleOut) }
  }, [footnoteMap])

  // Double-click word to search
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const handleDblClick = () => {
      const sel = window.getSelection()?.toString().trim()
      if (sel && sel.length > 1 && sel.length < 50 && !sel.includes('\n')) {
        // Dispatch Ctrl+K to open search, then fill it
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
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
      {/* Feature 18: Ambient background color shift (light/sepia themes only) */}
      {(theme === 'light' || theme === 'sepia') && ambientHue > 0 && (
        <div
          className="ambient-section-overlay"
          style={{
            background: `linear-gradient(135deg, hsla(${ambientHue}, 60%, 70%, 0.04), hsla(${ambientHue + 60}, 60%, 70%, 0.03))`,
          }}
        />
      )}

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

      {/* Calibration toast */}
      {calibrationToast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-xl bg-gray-800 text-white text-xs shadow-lg flex items-center gap-3 animate-fade-in">
          <span>Your reading speed: ~{calibrationToast} WPM. Calibrate for better time estimates?</span>
          <button
            onClick={() => {
              localStorage.setItem('md-reader-wpm', String(calibrationToast))
              localStorage.setItem('md-reader-wpm-calibrated', 'true')
              setCalibratedWpm(calibrationToast)
              setCalibrationToast(null)
              showToast('Reading speed calibrated!')
            }}
            className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 rounded text-white whitespace-nowrap"
          >
            Save
          </button>
          <button
            onClick={() => { setCalibrationToast(null); localStorage.setItem('md-reader-wpm-calibrated', 'true') }}
            className="text-gray-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Resume toast */}
      {resumeToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 rounded-full bg-gray-800 text-white text-xs shadow-lg flex items-center gap-2">
          <span>{resumeToast.text}</span>
          <button
            onClick={() => {
              contentRef.current?.scrollTo({ top: resumeToast.scrollTop, behavior: 'smooth' })
              setResumeToast(null)
            }}
            className="text-blue-300 hover:text-blue-100 underline whitespace-nowrap"
          >
            Jump there &darr;
          </button>
        </div>
      )}

      {/* First-time tip */}
      {firstTimeTip && (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs shadow-lg animate-slide-down cursor-pointer max-w-sm text-center"
          onClick={() => setFirstTimeTip(false)}
        >
          {(() => {
            const hasCode = (markdown.match(/```/g) ?? []).length >= 4
            const hasSteps = /^\d+\.\s/m.test(markdown)
            if (hasCode && hasSteps) return 'Tutorial detected — follow the steps in order. Press ? for shortcuts.'
            if (hasCode) return 'Technical doc — try the Mind Map tab for an overview. Press ? for shortcuts.'
            if (toc.length > 10) return 'Long document — use j/k keys to jump between sections. Press ? for shortcuts.'
            return 'Press ? for shortcuts · Try the tabs above · Click the chat icon to ask AI'
          })()}
        </div>
      )}

      {/* Scroll hint for long documents */}
      {showScrollHint && readTime >= 3 && readingProgress < 5 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-10 animate-bounce text-gray-300 dark:text-gray-600">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12l7 7 7-7"/>
          </svg>
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
          <div className={`max-w-3xl mx-auto px-8 pt-6 pb-0 text-[11px] ${tc.stats} flex items-center gap-2`}>
            <span className="flex items-center gap-0.5 flex-wrap">
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center">
                  {i > 0 && <span className="mx-1 text-gray-300 dark:text-gray-600">/</span>}
                  <span className={i === crumbs.length - 1 ? 'px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-500 dark:text-gray-400'}>{c}</span>
                </span>
              ))}
            </span>
            {/* Feature 17: Copy link to here */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                const url = `${window.location.origin}${window.location.pathname}#read/section=${encodeURIComponent(activeSection)}`
                navigator.clipboard.writeText(url)
                setLinkCopied(true)
                setTimeout(() => setLinkCopied(false), 1500)
              }}
              className="opacity-40 hover:opacity-80 transition-opacity shrink-0"
              title="Copy link to this section"
            >
              {linkCopied ? (
                <span className="text-green-500 text-[10px] font-medium">Link copied!</span>
              ) : (
                <svg className="w-3 h-3 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              )}
            </button>
          </div>
        )
      })()}

      {/* Document stats — collapsed by default, showing only read time */}
      <div className={`max-w-3xl mx-auto px-8 ${activeSection ? 'pt-2' : 'pt-8'} pb-2 text-xs ${tc.stats}`}>
        <div className="inline">
          <button
            onClick={() => setStatsExpanded((v) => !v)}
            className="cursor-pointer hover:opacity-70 transition-opacity inline-flex items-center gap-1"
            title="Click to expand stats"
          >
            <span>
              {readingProgress > 5
                ? (() => {
                    const minsLeft = Math.max(1, Math.ceil(readTime * (1 - readingProgress / 100)))
                    const finishTime = new Date(Date.now() + minsLeft * 60000)
                    return `~${minsLeft} min left (${finishTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`
                  })()
                : `${readTime} min read`}
            </span>
            {(() => {
              const avgWpm = parseInt(localStorage.getItem('md-reader-wpm') ?? '230')
              const trend = liveWpm ? (liveWpm > avgWpm * 1.15 ? '\u2191' : liveWpm < avgWpm * 0.85 ? '\u2193' : '') : ''
              return trend ? <span className={`text-[9px] ${trend === '\u2191' ? 'text-green-500' : 'text-amber-500'}`} title={`${trend === '\u2191' ? 'Reading faster' : 'Reading slower'} than your ${avgWpm} WPM average`}>{trend}</span> : null
            })()}
            {sessionMinutes > 0 && (
              <span className="text-[10px] text-gray-400">
                · {sessionMinutes}m reading
                {sessionMinutes >= 3 && readingProgress > 5 && readingProgress < 95 && (() => {
                  const pacePerMin = readingProgress / sessionMinutes
                  const minsToFinish = Math.round((100 - readingProgress) / pacePerMin)
                  return minsToFinish <= 10 ? <span className="text-green-500 ml-1">· finishing soon!</span> : null
                })()}
              </span>
            )}
            <svg className={`w-3 h-3 inline ml-1 opacity-40 transition-transform ${statsExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          {statsExpanded && <div className="flex items-center gap-4 mt-1 text-xs">
            <span
              className="cursor-pointer hover:opacity-70"
              onClick={() => {
                const stats = `${words.toLocaleString()} words | ${readTime} min read | ${difficulty}`
                navigator.clipboard.writeText(stats)
                showToast('Stats copied!')
              }}
              title="Click to copy stats"
            >
              {words.toLocaleString()} words
            </span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
              { Beginner: 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400',
                Intermediate: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400',
                Advanced: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400',
                Expert: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400',
              }[difficulty]
            }`}>
              {difficulty}
            </span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400`}>
              {contentType}
            </span>
            {codeBlockCount > 0 && (
              <span className="text-[10px] text-gray-400">{Math.floor(codeBlockCount)} code blocks</span>
            )}
            {hasMath && (
              <span className="text-[10px] text-gray-400">has math</span>
            )}
          </div>}
        </div>
      </div>

      {/* Featured term — only shown before user scrolls past 25% */}
      {readingProgress < 25 && keyTerm && (
        <div className="max-w-3xl mx-auto px-8 pb-2">
          <p className="text-[10px] text-gray-400 inline-flex items-center gap-1.5">
            Key term: <span className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded font-medium">{keyTerm[0]}</span>
            <span className="text-gray-300">({keyTerm[1]}× in document)</span>
          </p>
        </div>
      )}

      {/* Feature 20: "What changed?" badge */}
      {hasChanges && (
        <div className="max-w-3xl mx-auto px-8 pb-2">
          <button
            onClick={() => {
              setShowDiffHighlight((s) => {
                const next = !s
                // Apply or remove diff highlights on article children
                requestAnimationFrame(() => {
                  const article = contentRef.current?.querySelector('article')
                  if (!article) return
                  const children = Array.from(article.children) as HTMLElement[]
                  if (next) {
                    // Map paragraph indices in rendered output to markdown paragraph indices
                    let paraIdx = 0
                    for (const child of children) {
                      if (/^H[1-6]$/.test(child.tagName)) continue
                      if (diffChanges.has(paraIdx)) {
                        child.classList.add('diff-changed')
                      }
                      paraIdx++
                    }
                  } else {
                    children.forEach((c) => c.classList.remove('diff-changed'))
                  }
                })
                return next
              })
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
              showDiffHighlight
                ? 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400'
                : 'bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-500 hover:bg-green-100 dark:hover:bg-green-950/40'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            {showDiffHighlight ? 'Hide changes' : 'What changed?'}
            <span className="text-[9px] text-green-400">({diffChanges.size})</span>
          </button>
        </div>
      )}

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

      {/* Inline comment popover */}
      {commentPopover && (
        <div
          className="absolute z-50 w-72 bg-white dark:bg-gray-900 border border-teal-300 dark:border-teal-700 rounded-xl shadow-2xl p-3 space-y-2"
          style={{ left: commentPopover.x, top: commentPopover.y + 8 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">{commentPopover.comment.author}</span>
            <button onClick={() => { setCommentPopover(null); setEditingCommentText(null) }} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
          </div>
          {commentPopover.comment.selectedText && (
            <div className="border-l-2 border-teal-400 pl-2">
              <p className="text-[11px] text-gray-500 dark:text-gray-400 italic line-clamp-2">
                {commentPopover.comment.selectedText.slice(0, 80)}{commentPopover.comment.selectedText.length > 80 ? '...' : ''}
              </p>
            </div>
          )}
          {editingCommentText !== null ? (
            <div className="space-y-1.5">
              <textarea
                rows={3}
                autoFocus
                value={editingCommentText}
                onChange={(e) => setEditingCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (!editingCommentText.trim()) return
                    updateComment(commentPopover.comment.id!, { comment: editingCommentText.trim() }).then(() => {
                      if (activeDocId) getComments(activeDocId).then(setInlineComments)
                      setCommentPopover({ ...commentPopover, comment: { ...commentPopover.comment, comment: editingCommentText.trim() } })
                      setEditingCommentText(null)
                    })
                  }
                  if (e.key === 'Escape') setEditingCommentText(null)
                }}
                className="w-full text-xs px-2 py-1.5 rounded border border-teal-300 dark:border-teal-700 bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400">Enter to save, Esc to cancel</span>
                <button
                  onClick={() => {
                    if (!editingCommentText.trim()) return
                    updateComment(commentPopover.comment.id!, { comment: editingCommentText.trim() }).then(() => {
                      if (activeDocId) getComments(activeDocId).then(setInlineComments)
                      setCommentPopover({ ...commentPopover, comment: { ...commentPopover.comment, comment: editingCommentText.trim() } })
                      setEditingCommentText(null)
                    })
                  }}
                  disabled={!editingCommentText.trim()}
                  className="text-[10px] px-2 py-0.5 bg-teal-600 text-white rounded hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-800 dark:text-gray-200 leading-relaxed">{commentPopover.comment.comment}</p>
          )}
          <div className="flex items-center justify-between pt-1 border-t border-gray-100 dark:border-gray-800">
            <span className="text-[10px] text-gray-400">{new Date(commentPopover.comment.createdAt).toLocaleString()}</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setEditingCommentText(commentPopover.comment.comment)}
                className="text-[10px] px-1.5 py-0.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded transition-colors"
                title="Edit comment"
              >
                Edit
              </button>
              <button
                onClick={() => {
                  updateComment(commentPopover.comment.id!, { resolved: !commentPopover.comment.resolved }).then(() => {
                    if (activeDocId) getComments(activeDocId).then(setInlineComments)
                    appliedCommentIdsRef.current.delete(commentPopover.comment.id!)
                    setCommentPopover(null)
                    setEditingCommentText(null)
                  })
                }}
                className="text-[10px] px-1.5 py-0.5 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30 rounded transition-colors"
                title={commentPopover.comment.resolved ? 'Unresolve' : 'Resolve'}
              >
                {commentPopover.comment.resolved ? 'Reopen' : 'Resolve'}
              </button>
              <button
                onClick={() => {
                  if (!window.confirm('Delete this comment?')) return
                  removeComment(commentPopover.comment.id!).then(() => {
                    if (activeDocId) getComments(activeDocId).then(setInlineComments)
                    appliedCommentIdsRef.current.delete(commentPopover.comment.id!)
                    setCommentPopover(null)
                    setEditingCommentText(null)
                  })
                }}
                className="text-[10px] px-1.5 py-0.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors"
                title="Delete comment"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Key takeaways — auto-extracted from section opening sentences */}
      {toc.filter((t) => t.level === 2).length >= 3 && (
        <div className="max-w-3xl mx-auto px-8 pb-8">
          <details className="border border-gray-200 dark:border-gray-800 rounded-xl p-4">
            <summary className="text-sm font-semibold text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-800 dark:hover:text-gray-200">
              Key Takeaways ({toc.filter((t) => t.level === 2).length} sections)
            </summary>
            <ul className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-400">
              {toc.filter((t) => t.level === 2).map((entry) => {
                const sectionStart = markdown.indexOf(`## ${entry.text}`)
                if (sectionStart < 0) return null
                const afterHeading = markdown.slice(sectionStart).replace(/^##[^\n]+\n+/, '')
                const firstSentence = afterHeading.match(/^[^\n.!?]+[.!?]/)?.[0] ?? afterHeading.split('\n')[0]?.slice(0, 120)
                if (!firstSentence?.trim()) return null
                return (
                  <li key={entry.id} className="flex gap-2">
                    <span className="text-blue-400 shrink-0">&bull;</span>
                    <span><strong className="text-gray-700 dark:text-gray-300">{entry.text}:</strong> {firstSentence.replace(/\*\*/g, '').replace(/`/g, '').trim()}</span>
                  </li>
                )
              })}
            </ul>
          </details>
        </div>
      )}

      {/* Most quotable sentence */}
      {quotableSentence && (
        <div className="max-w-3xl mx-auto px-8 pb-4">
          <blockquote
            className="border-l-4 border-blue-400 dark:border-blue-600 pl-4 py-2 italic text-gray-600 dark:text-gray-400 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/20 rounded transition-colors"
            onClick={() => { navigator.clipboard.writeText(quotableSentence.text); const t = document.createElement('div'); t.className = 'toast-notify'; t.textContent = 'Quote copied!'; document.body.appendChild(t); setTimeout(() => t.remove(), 2000) }}
            title="Click to copy this quote"
          >
            <p>"{quotableSentence.text.slice(0, 150)}"</p>
          </blockquote>
        </div>
      )}

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

      {/* Reading completion report card */}
      {showReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowReport(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <p className="text-4xl mb-3">🎓</p>
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-200 mb-1">Reading Complete!</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{useStore.getState().fileName}</p>
            <div className="grid grid-cols-2 gap-3 text-left mb-4">
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <p className="text-[10px] text-gray-400 uppercase">Words</p>
                <p className="text-lg font-bold text-gray-700 dark:text-gray-300">{words.toLocaleString()}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <p className="text-[10px] text-gray-400 uppercase">Time</p>
                <p className="text-lg font-bold text-gray-700 dark:text-gray-300">{sessionMinutes > 0 ? `${sessionMinutes}m` : '<1m'}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <p className="text-[10px] text-gray-400 uppercase">Speed</p>
                <p className="text-lg font-bold text-gray-700 dark:text-gray-300">{sessionMinutes > 0 ? `${Math.round(words / sessionMinutes)}` : '\u2014'} <span className="text-xs font-normal">WPM</span></p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <p className="text-[10px] text-gray-400 uppercase">Level</p>
                <p className="text-lg font-bold text-gray-700 dark:text-gray-300">{difficulty}</p>
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] text-gray-400 uppercase">Focus</p>
                <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
                  {(() => {
                    const docId = useStore.getState().activeDocId
                    const sections = docId ? JSON.parse(localStorage.getItem(`md-reader-sections-read-${docId}`) ?? '[]') : []
                    const coverage = toc.length > 0 ? Math.round((sections.length / toc.length) * 100) : 0
                    return coverage >= 80 ? 'Deep reader' : coverage >= 50 ? 'Skimmer' : 'Scanner'
                  })()}
                </p>
              </div>
              <div className="w-16 h-16">
                <svg viewBox="0 0 36 36" className="w-full h-full">
                  <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeWidth="3" />
                  <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" className="text-blue-500" strokeWidth="3"
                    strokeDasharray={`${Math.round(readingProgress)} 100`}
                    strokeLinecap="round" transform="rotate(-90 18 18)" />
                </svg>
              </div>
            </div>
            <button
              onClick={() => setShowReport(false)}
              className="w-full py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Footnote popover */}
      {footnotePopover && (
        <div
          className="fixed z-50 max-w-xs px-3 py-2 rounded-lg bg-gray-900 text-white text-xs shadow-xl pointer-events-none"
          style={{
            left: `${Math.min(footnotePopover.x, window.innerWidth - 280)}px`,
            top: `${footnotePopover.y - 8}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {footnotePopover.content}
          <div className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-gray-900 rotate-45 -mt-1" />
        </div>
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
