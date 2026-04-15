// Default to the live deploy. Users can override via the settings input
// below (stored in chrome.storage.local → "readerUrl"). Point this at
// your own dev server when hacking locally.
const DEFAULT_URL = 'https://manup-dev.github.io/themarkdownreader/'

// Load saved URL and sync both the input and the "Open md-reader App"
// secondary button to it, so users who set a custom host (e.g. local
// dev) don't land on the hardcoded default.
const urlInput = document.getElementById('readerUrl')
const openAppBtn = document.getElementById('openApp')
chrome.storage?.local?.get('readerUrl', (data) => {
  const url = data.readerUrl || DEFAULT_URL
  urlInput.value = url
  if (openAppBtn) openAppBtn.href = url
})

urlInput.addEventListener('change', () => {
  const url = urlInput.value.trim() || DEFAULT_URL
  chrome.storage?.local?.set({ readerUrl: url })
  if (openAppBtn) openAppBtn.href = url
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
