#!/usr/bin/env node
// Claude Code PostToolUse hook: when an agent Writes a new .md file, surface it
// in an already-running md-reader. Opt-in (you add it to settings.json). Silent
// no-op unless md-reader is reachable. Dependency-free so it runs in any project.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import os from 'node:os'
import crypto from 'node:crypto'
import { decideOpen } from './decide.mjs'

const BASE_URL = process.env.MD_READER_URL || 'http://localhost:5183'
const WINDOW_MS = Number(process.env.MD_READER_DEDUP_MS || 30000)

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { data += c })
    process.stdin.on('end', () => resolve(data))
    // If no stdin arrives (manual run), don't hang forever.
    setTimeout(() => resolve(data), 2000)
  })
}

function osOpen(url) {
  const platform = process.platform
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch { /* best-effort */ }
}

async function isReachable(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch { return false }
}

// Dedup state lives in the OS temp dir, keyed by project path — never in the
// repo (avoids colliding with the reserved .md-reader-trigger.json) and needs
// no .gitignore entry. Best-effort: if temp is cleared, a doc may reopen once.
function stateFileFor(cwd) {
  const key = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16)
  return path.join(os.tmpdir(), `md-reader-hook-${key}.json`)
}

async function main() {
  let event
  try {
    const raw = await readStdin()
    const payload = JSON.parse(raw)
    event = {
      toolName: payload.tool_name,
      filePath: payload.tool_input?.file_path,
      cwd: payload.cwd || process.cwd(),
    }
  } catch { process.exit(0) } // malformed input → no-op

  const statePath = stateFileFor(event.cwd)
  let state = { opened: {} }
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')) } catch { /* fresh */ }
  if (!state.opened) state.opened = {}

  const now = Date.now()
  const decision = decideOpen(event, state, { baseUrl: BASE_URL, now, windowMs: WINDOW_MS })
  if (!decision.open) process.exit(0)

  if (!(await isReachable(BASE_URL))) process.exit(0) // md-reader not running → silent

  osOpen(decision.url)

  // Record + prune state (keep it small: drop entries older than 1h).
  state.opened[decision.relPath] = now
  for (const [k, ts] of Object.entries(state.opened)) {
    if (now - ts > 3600000) delete state.opened[k]
  }
  try { fs.writeFileSync(statePath, JSON.stringify(state)) } catch { /* best-effort */ }

  // Optional context back to Claude.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `Surfaced ${decision.relPath} in md-reader (${BASE_URL}).`,
    },
  }))
  process.exit(0)
}

main()
