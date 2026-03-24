/**
 * md-reader GitHub Extension
 * Adds "Open in md-reader" button to GitHub markdown file views.
 * Works on: github.com/user/repo/blob/branch/file.md
 */

const MD_READER_URL = 'https://md-reader.netlify.app' // or localhost:5183 for dev

function isMarkdownPage() {
  const path = window.location.pathname
  return /\.(md|markdown|mdx|mdown|mkd|mkdn|mdtxt|mdtext|txt)$/i.test(path)
}

function getRawUrl() {
  // Convert github.com/user/repo/blob/branch/file.md
  // to raw.githubusercontent.com/user/repo/branch/file.md
  const path = window.location.pathname
  const match = path.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
  if (!match) return null
  const [, user, repo, rest] = match
  return `https://raw.githubusercontent.com/${user}/${repo}/${rest}`
}

function getFileName() {
  const path = window.location.pathname
  const parts = path.split('/')
  return parts[parts.length - 1] || 'document.md'
}

function createButton() {
  const btn = document.createElement('button')
  btn.className = 'md-reader-btn'
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
    </svg>
    <span>Open in md-reader</span>
  `
  btn.title = 'Read this markdown file with mind maps, AI chat, and more'

  let isLoading = false
  btn.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (isLoading) return
    isLoading = true

    const rawUrl = getRawUrl()
    if (!rawUrl) {
      alert('Could not determine raw URL for this file')
      return
    }

    btn.classList.add('md-reader-btn-loading')
    btn.querySelector('span').textContent = 'Loading...'

    try {
      const res = await fetch(rawUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const markdown = await res.text()
      const fileName = getFileName()

      // Open md-reader with the content via postMessage
      const readerWindow = window.open(MD_READER_URL, 'md-reader')

      // Wait for the reader to load, then send content (target specific origin, not *)
      const targetOrigin = new URL(MD_READER_URL).origin
      const sendContent = () => {
        readerWindow.postMessage({
          type: 'md-reader-load',
          markdown,
          fileName,
          source: rawUrl,
        }, targetOrigin)
      }

      // Try immediately, then retry after load
      setTimeout(sendContent, 1000)
      setTimeout(sendContent, 3000)
      setTimeout(sendContent, 5000)

    } catch (err) {
      console.error('md-reader: Failed to fetch markdown:', err)
      // Fallback: open md-reader with URL pre-filled
      window.open(`${MD_READER_URL}#url=${encodeURIComponent(rawUrl)}`, 'md-reader')
    } finally {
      btn.classList.remove('md-reader-btn-loading')
      btn.querySelector('span').textContent = 'Open in md-reader'
      isLoading = false
    }
  })

  return btn
}

function injectButton() {
  // Don't re-inject
  if (document.querySelector('.md-reader-btn')) return

  // Find the file actions bar on GitHub
  // GitHub's UI: the raw/blame/edit buttons are in a toolbar above the file content
  const actionsBar =
    document.querySelector('.react-blob-header-edit-and-raw-actions') ||
    document.querySelector('[class*="BlobToolbar"]') ||
    document.querySelector('.Box-header .d-flex') ||
    document.querySelector('.file-actions') ||
    document.querySelector('[data-testid="raw-button"]')?.parentElement

  if (actionsBar) {
    const btn = createButton()
    actionsBar.prepend(btn)
    return
  }

  // Fallback: floating button in bottom-right
  const floatingBtn = createButton()
  floatingBtn.classList.add('md-reader-btn-floating')
  document.body.appendChild(floatingBtn)
}

function init() {
  if (!isMarkdownPage()) return
  // Wait for GitHub's SPA to finish rendering
  const observer = new MutationObserver(() => {
    if (isMarkdownPage() && !document.querySelector('.md-reader-btn')) {
      injectButton()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // Initial injection
  setTimeout(injectButton, 500)
  setTimeout(injectButton, 2000)
}

// GitHub uses Turbo for navigation — re-run on page changes
document.addEventListener('turbo:load', init)
document.addEventListener('turbo:render', init)

// Initial load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
