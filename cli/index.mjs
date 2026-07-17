#!/usr/bin/env node

import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { resolve, join, basename } from 'path'
import { fileURLToPath } from 'url'
import sirv from 'sirv'
import open from 'open'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DIST_DIR = join(__dirname, 'dist')
const VERSION = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8')).version

// ─── Parse args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const flags = { port: 4173, help: false, noOpen: false, version: false }
const files = []

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--help' || args[i] === '-h') flags.help = true
  else if (args[i] === '--version' || args[i] === '-v') flags.version = true
  else if (args[i] === '--no-open') flags.noOpen = true
  else if (args[i] === '--port' || args[i] === '-p') {
    const raw = args[++i]
    if (raw === undefined || !/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
      console.error(`Error: --port requires an integer between 1 and 65535 (got: ${raw ?? 'nothing'})`)
      console.error('Usage: mdr --port 8080')
      process.exit(1)
    }
    flags.port = Number(raw)
  }
  else files.push(args[i])
}

if (flags.version) {
  console.log(`md-reader v${VERSION}`)
  process.exit(0)
}

if (flags.help) {
  console.log(`
  md-reader v${VERSION} — AI-native markdown reader

  Usage (mdr is a short alias for md-reader):
    mdr [file.md]                 Open a markdown file
    mdr --port 8080               Use a custom port
    claude -p "..." | mdr         Pipe an agent's markdown via stdin
    mdr                           Open empty (drag & drop)

  Options:
    -p, --port <n>   Port to serve on (default: 4173)
    --no-open        Don't auto-open the browser
    -v, --version    Print the version and exit
    -h, --help       Show this help

  AI backends (auto-detected):
    1. Ollama (local GPU) — if running at localhost:11434
    2. WebLLM (browser)   — via WebGPU, no setup needed
    3. OpenRouter (cloud)  — paste API key in settings
  `)
  process.exit(0)
}

// ─── Read stdin if piped ───────────────────────────────────────────────────

async function readStdin() {
  if (process.stdin.isTTY) return null
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf-8')
}

// ─── Check Ollama ──────────────────────────────────────────────────────────

async function checkOllama() {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(2000)
    })
    if (!res.ok) return { available: false, models: [] }
    const data = await res.json()
    const models = data.models?.map(m => m.name) || []
    return { available: true, models }
  } catch {
    return { available: false, models: [] }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(DIST_DIR)) {
    console.error('Error: Built app not found. The CLI package may be corrupted.')
    console.error('Try: npm install -g md-reader@latest')
    process.exit(1)
  }

  // Read file argument or stdin
  let markdownContent = null
  let fileName = null

  if (files.length > 0) {
    const filePath = resolve(files[0])
    if (!existsSync(filePath)) {
      console.error(`Error: File not found: ${files[0]}`)
      process.exit(1)
    }
    markdownContent = readFileSync(filePath, 'utf-8')
    fileName = basename(files[0])
  } else {
    const stdin = await readStdin()
    if (stdin) {
      markdownContent = stdin
      fileName = 'stdin.md'
    }
  }

  const ollama = await checkOllama()

  // Serve the built app
  const serve = sirv(DIST_DIR, { single: true, dev: false })

  const server = createServer((req, res) => {
    // API endpoint: serve the piped/file content to the app
    if (req.url === '/__cli__/content') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      })
      res.end(JSON.stringify({ markdown: markdownContent, fileName, ollama }))
      return
    }
    serve(req, res)
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Error: port ${flags.port} is already in use.`)
      console.error(`Try another port: mdr --port ${flags.port + 1}`)
    } else {
      console.error(`Error: ${err.message}`)
    }
    process.exit(1)
  })

  server.listen(flags.port, () => {
    const url = `http://localhost:${flags.port}`
    // The app only fetches piped/file content when ?cli=true is present —
    // print the SAME url we auto-open so --no-open / SSH users can copy it.
    const openUrl = markdownContent ? `${url}?cli=true` : url

    console.log()
    console.log(`  \x1b[1mmd-reader\x1b[0m v${VERSION}`)
    console.log()
    console.log(`  \x1b[2m→\x1b[0m Local:   \x1b[36m${openUrl}\x1b[0m`)

    if (markdownContent) {
      console.log(`  \x1b[2m→\x1b[0m File:    ${fileName}`)
    }

    if (ollama.available) {
      console.log(`  \x1b[2m→\x1b[0m Ollama:  \x1b[32m✓ detected\x1b[0m (${ollama.models.slice(0, 3).join(', ')})`)
    } else {
      console.log(`  \x1b[2m→\x1b[0m Ollama:  \x1b[33mnot running\x1b[0m (AI falls back to WebLLM in-browser)`)
    }

    console.log()
    console.log('  \x1b[2mPress Ctrl+C to stop\x1b[0m')
    console.log()

    if (!flags.noOpen) {
      open(openUrl)
    }
  })

  process.on('SIGINT', () => { server.close(); process.exit(0) })
  process.on('SIGTERM', () => { server.close(); process.exit(0) })
}

main().catch((err) => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
