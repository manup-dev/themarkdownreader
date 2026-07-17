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

// Map each content-script host (manifest.json content_scripts[0].matches) to
// a raw-URL builder. Returns null when the path doesn't look like a file page.
const RAW_URL_BUILDERS = {
  'github.com': (url) => {
    const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
    return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : null
  },
  'gist.github.com': (url) => {
    const m = url.pathname.match(/^\/([^/]+)\/([0-9a-f]+)/)
    return m ? `https://gist.githubusercontent.com/${m[1]}/${m[2]}/raw` : null
  },
  'raw.githubusercontent.com': (url) => url.href,
  'gitlab.com': (url) => {
    const m = url.pathname.match(/^\/(.+)\/-\/blob\/(.+)$/)
    return m ? `https://gitlab.com/${m[1]}/-/raw/${m[2]}` : null
  },
  'bitbucket.org': (url) => {
    const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/src\/(.+)$/)
    return m ? `https://bitbucket.org/${m[1]}/${m[2]}/raw/${m[3]}` : null
  },
  'codeberg.org': (url) => {
    const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/src\/(.+)$/)
    return m ? `https://codeberg.org/${m[1]}/${m[2]}/raw/${m[3]}` : null
  },
}

// Open current file
document.getElementById('openCurrent').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) return

  const url = new URL(tab.url)
  const buildRawUrl = RAW_URL_BUILDERS[url.hostname]
  if (!buildRawUrl) {
    alert('Navigate to a markdown file on GitHub, GitLab, Bitbucket, Codeberg, or a Gist first')
    return
  }

  // Gists don't carry a file extension in the page path; every other host
  // must point at a markdown file.
  if (url.hostname !== 'gist.github.com' && !/\.(md|markdown|mdx)$/i.test(url.pathname)) {
    alert('This does not appear to be a markdown file')
    return
  }

  const rawUrl = buildRawUrl(url)
  if (!rawUrl) {
    alert('Could not determine raw URL')
    return
  }

  const readerUrl = urlInput.value.trim() || DEFAULT_URL

  // Open md-reader with URL hash
  chrome.tabs.create({ url: `${readerUrl}#url=${encodeURIComponent(rawUrl)}` })
  window.close()
})
