const DEFAULT_URL = 'http://localhost:5183'

// Load saved URL
const urlInput = document.getElementById('readerUrl')
chrome.storage?.local?.get('readerUrl', (data) => {
  urlInput.value = data.readerUrl || DEFAULT_URL
})

urlInput.addEventListener('change', () => {
  const url = urlInput.value.trim() || DEFAULT_URL
  chrome.storage?.local?.set({ readerUrl: url })
})

// Open current file
document.getElementById('openCurrent').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) return

  const url = new URL(tab.url)
  if (url.hostname !== 'github.com') {
    alert('Navigate to a markdown file on GitHub first')
    return
  }

  const path = url.pathname
  if (!/\.(md|markdown|mdx)$/i.test(path)) {
    alert('This does not appear to be a markdown file')
    return
  }

  // Convert to raw URL
  const match = path.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
  if (!match) {
    alert('Could not determine raw URL')
    return
  }

  const [, user, repo, rest] = match
  const rawUrl = `https://raw.githubusercontent.com/${user}/${repo}/${rest}`
  const readerUrl = urlInput.value.trim() || DEFAULT_URL

  // Open md-reader with URL hash
  chrome.tabs.create({ url: `${readerUrl}#url=${encodeURIComponent(rawUrl)}` })
  window.close()
})
