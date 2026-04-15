/**
 * md-reader GitHub Extension — In-Page Reader
 * Enhanced reading panel with Mind Map, Summary, TOC, TTS, and reading progress.
 * Works on GitHub, GHE, GitLab, Gitea, and any page with rendered markdown.
 */

// ─── Page Detection ─────────────────────────────────────────────

function isMarkdownPage() {
  const path = window.location.pathname
  if (/\.(md|markdown|mdx|mdown|mkd|mkdn|mdtxt|mdtext|txt)$/i.test(path)) return true
  if (document.querySelector('article.markdown-body, .markdown-body, .md-content, .wiki-content, .readme-markdown')) return true
  return false
}

function getFileName() {
  const parts = window.location.pathname.split('/')
  return parts[parts.length - 1] || 'document.md'
}

// ─── Content Extraction ─────────────────────────────────────────

function getRenderedMarkdown() {
  const selectors = [
    'article.markdown-body',
    '[data-testid="repo-content"] .markdown-body',
    '.readme .markdown-body',
    '.Box-body .markdown-body',
    '.markdown-body',
    '.md-content',
    '.wiki-content',
    '.readme-markdown',
    '.blob-viewer[data-type="rich"]',
    '.file-content .code',
    'article',
  ]
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el && el.textContent.trim().length > 50) return el.cloneNode(true)
  }
  return null
}

/** Convert DOM headings back to markdown for Markmap */
function extractMarkdownOutline(container) {
  const lines = []
  container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
    const level = parseInt(h.tagName[1])
    const prefix = '#'.repeat(level)
    lines.push(`${prefix} ${h.textContent.trim()}`)
  })
  return lines.join('\n')
}

/**
 * Strip leading emoji + whitespace from a heading label so the TOC and
 * summary-view stay visually calm. Keeps emoji in the actual rendered
 * heading inside the article (users want the flair there); only the
 * nav index is stripped. Mirrors the treatment the web app's
 * OutlinePanel uses.
 */
function stripLeadingEmoji(text) {
  try {
    const cleaned = String(text).replace(
      /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D)+/u,
      ''
    )
    return cleaned.trimStart() || text
  } catch {
    // Older engines that don't support Unicode property escapes — skip
    return text
  }
}

/** Build TOC from headings */
function buildToc(container) {
  const headings = container.querySelectorAll('h1, h2, h3, h4')
  return Array.from(headings).map((h, i) => ({
    level: parseInt(h.tagName[1]),
    text: stripLeadingEmoji(h.textContent.trim()),
    id: `mdr-heading-${i}`,
  }))
}

/** Generate a summary from the content — extracts key sentences */
function generateSummary(container) {
  const sections = []
  let currentHeading = null
  let currentParagraphs = []

  const flush = () => {
    if (currentParagraphs.length > 0) {
      sections.push({
        heading: currentHeading || 'Overview',
        // Take first sentence or first 200 chars of each paragraph group
        summary: currentParagraphs.slice(0, 2).map(p => {
          const text = p.trim()
          const firstSentence = text.match(/^[^.!?]+[.!?]/)
          return firstSentence ? firstSentence[0] : text.slice(0, 200)
        }).join(' ')
      })
    }
  }

  for (const node of container.childNodes) {
    if (node.nodeType !== 1) continue
    const tag = node.tagName
    if (/^H[1-4]$/.test(tag)) {
      flush()
      currentHeading = stripLeadingEmoji(node.textContent.trim())
      currentParagraphs = []
    } else if (tag === 'P' && node.textContent.trim().length > 20) {
      currentParagraphs.push(node.textContent.trim())
    }
  }
  flush()
  return sections
}

// ─── Markmap (bundled in markmap-bundle.js) ─────────────────────

// ─── Panel Creation ─────────────────────────────────────────────

let currentView = 'read' // 'read' | 'mindmap' | 'summary'

function createReaderPanel() {
  document.getElementById('md-reader-panel')?.remove()
  document.getElementById('md-reader-backdrop')?.remove()

  const renderedContent = getRenderedMarkdown()
  if (!renderedContent) {
    alert('Could not find markdown content on this page')
    return
  }

  const headings = renderedContent.querySelectorAll('h1, h2, h3, h4')
  headings.forEach((h, i) => h.id = `mdr-heading-${i}`)

  const toc = buildToc(renderedContent)
  const fileName = getFileName()
  const markdownOutline = extractMarkdownOutline(renderedContent)
  const summaryData = generateSummary(renderedContent)
  currentView = 'read'

  // Build panel
  const panel = document.createElement('div')
  panel.id = 'md-reader-panel'

  // Header with view tabs
  const header = document.createElement('div')
  header.className = 'mdr-header'
  header.innerHTML = `
    <div class="mdr-header-left">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      </svg>
      <span class="mdr-title">${fileName}</span>
      <div class="mdr-tabs">
        <button class="mdr-tab mdr-tab-active" data-view="read">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          Read
        </button>
        <button class="mdr-tab" data-view="mindmap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4m-7.07-15.07 2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83"/></svg>
          Mind Map
        </button>
        <button class="mdr-tab" data-view="summary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h10M7 12h10M7 17h6"/></svg>
          Summary
        </button>
      </div>
    </div>
    <div class="mdr-header-right">
      <button class="mdr-icon-btn" id="mdr-toc-toggle" title="Table of Contents">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
      </button>
      <button class="mdr-icon-btn" id="mdr-tts-btn" title="Read Aloud">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
      </button>
      <button class="mdr-icon-btn" id="mdr-font-up" title="Increase Font">A+</button>
      <button class="mdr-icon-btn" id="mdr-font-down" title="Decrease Font">A-</button>
      <button class="mdr-icon-btn" id="mdr-theme-toggle" title="Toggle Dark Mode">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
      <button class="mdr-icon-btn mdr-close" id="mdr-close" title="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `

  // Progress bar
  const progressBar = document.createElement('div')
  progressBar.className = 'mdr-progress-bar'
  progressBar.innerHTML = '<div class="mdr-progress-fill" id="mdr-progress-fill"></div>'

  // TOC sidebar
  const tocSidebar = document.createElement('div')
  tocSidebar.className = 'mdr-toc'
  tocSidebar.id = 'mdr-toc'
  tocSidebar.innerHTML = `
    <div class="mdr-toc-title">Contents</div>
    ${toc.map(h => `
      <a class="mdr-toc-item mdr-toc-level-${h.level}" data-target="${h.id}">
        ${h.text}
      </a>
    `).join('')}
  `

  // ─── View: Read ───────────────────────────────────────────
  const readView = document.createElement('div')
  readView.className = 'mdr-view mdr-view-active'
  readView.id = 'mdr-view-read'
  renderedContent.className = 'mdr-markdown-body'
  readView.appendChild(renderedContent)

  // ─── View: Mind Map ───────────────────────────────────────
  const mindmapView = document.createElement('div')
  mindmapView.className = 'mdr-view'
  mindmapView.id = 'mdr-view-mindmap'
  mindmapView.innerHTML = `
    <div class="mdr-mindmap-container">
      <div class="mdr-mindmap-loading">Loading mind map...</div>
      <svg id="mdr-mindmap-svg" style="width:100%;height:100%;display:none;"></svg>
    </div>
  `

  // ─── View: Summary ────────────────────────────────────────
  const summaryView = document.createElement('div')
  summaryView.className = 'mdr-view'
  summaryView.id = 'mdr-view-summary'

  if (summaryData.length === 0) {
    summaryView.innerHTML = '<div class="mdr-summary-empty">No sections found to summarize.</div>'
  } else {
    const stats = renderedContent.textContent.trim()
    const wordCount = stats.split(/\s+/).length
    const readTime = Math.max(1, Math.ceil(wordCount / 238))

    summaryView.innerHTML = `
      <div class="mdr-summary-stats">
        <div class="mdr-stat"><strong>${wordCount.toLocaleString()}</strong> words</div>
        <div class="mdr-stat"><strong>${readTime}</strong> min read</div>
        <div class="mdr-stat"><strong>${toc.length}</strong> sections</div>
      </div>
      <div class="mdr-summary-cards">
        ${summaryData.map(s => `
          <div class="mdr-summary-card">
            <div class="mdr-summary-heading">${s.heading}</div>
            <div class="mdr-summary-text">${s.summary}</div>
          </div>
        `).join('')}
      </div>
    `
  }

  // Content wrapper
  const content = document.createElement('div')
  content.className = 'mdr-content'
  content.id = 'mdr-content'
  content.appendChild(readView)
  content.appendChild(mindmapView)
  content.appendChild(summaryView)

  // Layout
  const body = document.createElement('div')
  body.className = 'mdr-body'
  body.appendChild(tocSidebar)
  body.appendChild(content)

  panel.appendChild(header)
  panel.appendChild(progressBar)
  panel.appendChild(body)

  // Backdrop
  const backdrop = document.createElement('div')
  backdrop.id = 'md-reader-backdrop'
  backdrop.addEventListener('click', closePanel)

  document.body.appendChild(backdrop)
  document.body.appendChild(panel)
  document.body.style.overflow = 'hidden'

  // Wire interactions
  wireInteractions(panel, content, toc, markdownOutline)

  // Animate in
  requestAnimationFrame(() => {
    backdrop.classList.add('mdr-visible')
    panel.classList.add('mdr-visible')
  })
}

function closePanel() {
  const panel = document.getElementById('md-reader-panel')
  const backdrop = document.getElementById('md-reader-backdrop')
  if (panel) {
    panel.classList.remove('mdr-visible')
    backdrop?.classList.remove('mdr-visible')
    setTimeout(() => {
      panel.remove()
      backdrop?.remove()
      document.body.style.overflow = ''
    }, 300)
  }
  speechSynthesis.cancel()
}

// ─── Interactions ───────────────────────────────────────────────

function wireInteractions(panel, contentEl, toc, markdownOutline) {
  let fontSize = 18
  let isDark = false
  let tocVisible = true
  let isSpeaking = false
  let mindmapRendered = false

  // Close
  panel.querySelector('#mdr-close').addEventListener('click', closePanel)
  const escHandler = (e) => {
    if (e.key === 'Escape') { closePanel(); document.removeEventListener('keydown', escHandler) }
  }
  document.addEventListener('keydown', escHandler)

  // ─── View Switching ─────────────────────────────────────
  panel.querySelectorAll('.mdr-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view
      currentView = view

      // Update tab active state
      panel.querySelectorAll('.mdr-tab').forEach(t => t.classList.remove('mdr-tab-active'))
      tab.classList.add('mdr-tab-active')

      // Show/hide views
      panel.querySelectorAll('.mdr-view').forEach(v => v.classList.remove('mdr-view-active'))
      panel.querySelector(`#mdr-view-${view}`).classList.add('mdr-view-active')

      // Show/hide TOC (only for read view)
      const tocEl = panel.querySelector('#mdr-toc')
      tocEl.classList.toggle('mdr-toc-hidden', view !== 'read')

      // Render mind map on first switch
      if (view === 'mindmap' && !mindmapRendered) {
        try { renderMindmap(panel, markdownOutline) } catch (e) { console.error('Mind map error:', e) }
        mindmapRendered = true
      }
    })
  })

  // ─── TOC ────────────────────────────────────────────────
  panel.querySelector('#mdr-toc-toggle').addEventListener('click', () => {
    if (currentView !== 'read') return
    tocVisible = !tocVisible
    panel.querySelector('#mdr-toc').classList.toggle('mdr-toc-hidden', !tocVisible)
  })

  panel.querySelectorAll('.mdr-toc-item').forEach(item => {
    item.addEventListener('click', () => {
      // Switch to read view first
      if (currentView !== 'read') {
        panel.querySelector('.mdr-tab[data-view="read"]').click()
      }
      const target = contentEl.querySelector(`#${item.dataset.target}`)
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      panel.querySelectorAll('.mdr-toc-item').forEach(i => i.classList.remove('mdr-toc-active'))
      item.classList.add('mdr-toc-active')
    })
  })

  // ─── Progress ───────────────────────────────────────────
  const readView = panel.querySelector('#mdr-view-read')
  contentEl.addEventListener('scroll', () => {
    if (currentView !== 'read') return
    const pct = contentEl.scrollTop / (contentEl.scrollHeight - contentEl.clientHeight) * 100
    panel.querySelector('#mdr-progress-fill').style.width = `${Math.min(100, pct)}%`

    const headings = readView.querySelectorAll('h1, h2, h3, h4')
    let active = null
    headings.forEach(h => {
      if (h.getBoundingClientRect().top < contentEl.getBoundingClientRect().top + 100) active = h.id
    })
    if (active) {
      panel.querySelectorAll('.mdr-toc-item').forEach(i => {
        i.classList.toggle('mdr-toc-active', i.dataset.target === active)
      })
    }
  })

  // ─── Font Size ──────────────────────────────────────────
  const updateFontSize = () => {
    const mb = readView.querySelector('.mdr-markdown-body')
    if (mb) mb.style.fontSize = `${fontSize}px`
  }
  panel.querySelector('#mdr-font-up').addEventListener('click', () => { fontSize = Math.min(28, fontSize + 2); updateFontSize() })
  panel.querySelector('#mdr-font-down').addEventListener('click', () => { fontSize = Math.max(12, fontSize - 2); updateFontSize() })

  // ─── Dark Mode ──────────────────────────────────────────
  panel.querySelector('#mdr-theme-toggle').addEventListener('click', () => {
    isDark = !isDark
    panel.classList.toggle('mdr-dark', isDark)
  })

  // ─── TTS ────────────────────────────────────────────────
  panel.querySelector('#mdr-tts-btn').addEventListener('click', () => {
    if (isSpeaking) {
      speechSynthesis.cancel()
      isSpeaking = false
      panel.querySelector('#mdr-tts-btn').classList.remove('mdr-active')
      return
    }
    const text = readView.innerText
    if (!text) return
    // Split into chunks (speechSynthesis has length limits)
    const chunks = text.match(/.{1,3000}[.!?\n]|.{1,3000}/g) || [text]
    let idx = 0
    const speakNext = () => {
      if (idx >= chunks.length) {
        isSpeaking = false
        panel.querySelector('#mdr-tts-btn').classList.remove('mdr-active')
        return
      }
      const utterance = new SpeechSynthesisUtterance(chunks[idx++])
      utterance.rate = 1.1
      utterance.onend = speakNext
      speechSynthesis.speak(utterance)
    }
    speakNext()
    isSpeaking = true
    panel.querySelector('#mdr-tts-btn').classList.add('mdr-active')
  })
}

// ─── Mind Map Rendering (bundled Markmap) ───────────────────────

function renderMindmap(panel, markdownOutline) {
  const container = panel.querySelector('.mdr-mindmap-container')
  const loading = container.querySelector('.mdr-mindmap-loading')
  const svgEl = container.querySelector('#mdr-mindmap-svg')

  try {
    const { Transformer, Markmap } = window.MarkmapBundle
    if (!Transformer || !Markmap) throw new Error('MarkmapBundle not available')

    const transformer = new Transformer()
    const { root } = transformer.transform(markdownOutline)

    loading.style.display = 'none'
    svgEl.style.display = 'block'

    // Collapse nodes deeper than 2 levels by default
    function collapseDeep(node, depth) {
      if (depth >= 2 && node.children?.length) {
        node.payload = { ...node.payload, fold: 1 }
      }
      node.children?.forEach(c => collapseDeep(c, depth + 1))
    }
    collapseDeep(root, 0)

    Markmap.create(svgEl, {
      autoFit: true,
      duration: 500,
      maxWidth: 300,
      paddingX: 16,
      spacingVertical: 8,
      spacingHorizontal: 80,
      color: (node) => {
        const colors = ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#4f46e5']
        return colors[node.state?.id % colors.length || 0]
      },
    }, root)
  } catch (err) {
    console.error('md-reader: Mind map error:', err)
    loading.textContent = 'Failed to render mind map.'
    loading.style.color = '#ef4444'
  }
}

// ─── Inject Button ──────────────────────────────────────────────

function createButton() {
  const btn = document.createElement('button')
  btn.className = 'md-reader-btn'
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
    </svg>
    <span>Read</span>
  `
  btn.title = 'Open enhanced reader'
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    createReaderPanel()
  })
  return btn
}

function injectButton() {
  if (document.querySelector('.md-reader-btn')) return

  const actionsBar =
    document.querySelector('.react-blob-header-edit-and-raw-actions') ||
    document.querySelector('[class*="BlobToolbar"]') ||
    document.querySelector('.Box-header .d-flex') ||
    document.querySelector('.file-actions') ||
    document.querySelector('[data-testid="raw-button"]')?.parentElement

  if (actionsBar) {
    actionsBar.prepend(createButton())
    return
  }

  const floatingBtn = createButton()
  floatingBtn.classList.add('md-reader-btn-floating')
  document.body.appendChild(floatingBtn)
}

function init() {
  if (!isMarkdownPage()) return

  // MutationObserver catches GitHub's lazy-loaded React toolbar
  const observer = new MutationObserver(() => {
    if (isMarkdownPage() && !document.querySelector('.md-reader-btn')) {
      injectButton()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // Retry at increasing intervals — GitHub's React UI can be slow to render the toolbar
  for (const delay of [300, 800, 1500, 3000, 6000]) {
    setTimeout(() => {
      if (!document.querySelector('.md-reader-btn')) injectButton()
    }, delay)
  }
}

// GitHub SPA navigation events
document.addEventListener('turbo:load', init)
document.addEventListener('turbo:render', init)
// Older GitHub pjax
document.addEventListener('pjax:end', init)

// Also re-init on popstate (back/forward navigation)
window.addEventListener('popstate', () => setTimeout(init, 300))

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
