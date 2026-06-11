// E2E for the Claude Code plugin pipeline (Phase 4):
//   1. Spawn the BUILT MCP server with MD_READER_RENDER_INLINE=0 (the mode the
//      plugin's bundled .mcp.json sets) and call show_mind_map. Assert it
//      returns RAW mind_map JSON (not a pre-rendered tree).
//   2. Feed that result to the bundled PostToolUse hook (claude-code-plugin/
//      hook.mjs) as Claude Code would, and assert the hook re-renders it into a
//      box-drawing tree via updatedToolOutput.
// This proves the gate + hook contract end-to-end without a live CC session.
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = 'README.md'
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1) }

const server = spawn('node', [path.join(root, 'mcp-server/dist/index.js')], {
  stdio: ['pipe', 'pipe', 'inherit'],
  cwd: root,
  env: { ...process.env, MD_READER_RENDER_INLINE: '0', MD_READER_TERM_CAPS: 'unicode' },
})

const send = (o) => server.stdin.write(JSON.stringify(o) + '\n')
let out = ''
let phase = 'init'
const timeout = setTimeout(() => fail(`no response in 15s (phase: ${phase})`), 15_000)

server.stdout.on('data', (d) => {
  out += d.toString()

  if (phase === 'init' && out.includes('"serverInfo"')) {
    phase = 'tool'
    out = ''
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'show_mind_map', arguments: { path: FIXTURE } } })
    return
  }

  if (phase === 'tool' && out.includes('"id":2')) {
    clearTimeout(timeout)
    server.kill()
    let resp
    try { resp = JSON.parse(out.split('\n').find((l) => l.includes('"id":2'))) }
    catch { return fail(`could not parse tool response: ${out.slice(-300)}`) }
    const rawText = resp?.result?.content?.[0]?.text ?? ''
    if (resp?.result?.isError) return fail(`show_mind_map returned isError: ${rawText}`)

    // Step 1: with INLINE=0 the server must return raw JSON, NOT a rendered tree.
    let parsed
    try { parsed = JSON.parse(rawText) } catch { return fail(`gated output is not raw JSON: ${rawText.slice(0, 200)}`) }
    if (parsed.type !== 'mind_map') return fail(`gated output is not a mind_map payload: ${rawText.slice(0, 200)}`)
    if (/[├└│]/.test(rawText)) return fail('gated output was pre-rendered (contains tree chars) — gate not honored')

    // Step 2: feed it through the bundled hook as a PostToolUse event.
    const event = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__md-reader__show_mind_map',
      tool_output: { content: [{ type: 'text', text: rawText }] },
    })
    let hookOut
    try {
      hookOut = execFileSync('node', [path.join(root, 'claude-code-plugin/hook.mjs')], {
        input: event,
        env: { ...process.env, MD_READER_TERM_CAPS: 'unicode' },
        encoding: 'utf-8',
      })
    } catch (e) { return fail(`hook crashed: ${e.message}`) }

    let hookJson
    try { hookJson = JSON.parse(hookOut) } catch { return fail(`hook stdout not JSON: ${hookOut.slice(0, 200)}`) }
    const rendered = hookJson?.hookSpecificOutput?.updatedToolOutput?.content?.[0]?.text ?? ''
    if (hookJson?.hookSpecificOutput?.hookEventName !== 'PostToolUse') return fail('hook missing hookEventName')
    if (!/[├└│]/.test(rendered)) return fail(`hook did not render a tree: ${rendered.slice(0, 200)}`)

    console.log('PASS: plugin pipeline (gated raw JSON → hook → terminal tree)')
    process.exit(0)
  }
})

server.on('exit', (code) => {
  if (code !== null && code !== 0 && phase !== 'tool') fail(`server exited ${code}`)
})

send({ jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } } })
