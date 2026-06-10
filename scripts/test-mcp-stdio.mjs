// Smoke: spawn the BUILT MCP server and (1) complete an initialize handshake,
// then (2) call show_mind_map and assert it renders a real tree — not a runtime
// error. This second step exists because show_mind_map regressed to
// "unified is not defined" while the init-only smoke stayed green.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Use this repo's own README as the fixture — guaranteed to exist and have headings.
const FIXTURE = 'README.md'
const server = spawn('node', [path.join(root, 'mcp-server/dist/index.js')], {
  stdio: ['pipe', 'pipe', 'inherit'],
  cwd: root,
  // Force a no-op browser open and a known terminal cap so the render is deterministic.
  env: { ...process.env, MD_READER_TERM_CAPS: 'unicode' },
})

const send = (o) => server.stdin.write(JSON.stringify(o) + '\n')
let out = ''
let phase = 'init'
const fail = (msg) => { console.error(`FAIL: ${msg}`); server.kill(); process.exit(1) }
const timeout = setTimeout(() => fail(`no response in 15s (phase: ${phase})`), 15_000)

server.stdout.on('data', (d) => {
  out += d.toString()

  if (phase === 'init' && out.includes('"serverInfo"')) {
    phase = 'tool'
    out = '' // reset buffer for the tool response
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'show_mind_map', arguments: { path: FIXTURE } } })
    return
  }

  if (phase === 'tool' && out.includes('"id":2')) {
    clearTimeout(timeout)
    let resp
    try { resp = JSON.parse(out.split('\n').find((l) => l.includes('"id":2'))) }
    catch { return fail(`could not parse tool response: ${out.slice(-300)}`) }
    const text = resp?.result?.content?.[0]?.text ?? ''
    if (resp?.result?.isError) return fail(`show_mind_map returned isError: ${text}`)
    if (/is not defined|undefined is not/.test(text)) return fail(`runtime error in render: ${text}`)
    if (!/[├└│]/.test(text)) return fail(`no tree drawing in output: ${text.slice(0, 200)}`)
    phase = 'done'
    console.log('PASS: MCP initialize + show_mind_map render')
    server.kill()
    process.exit(0)
  }
})

server.on('exit', (code) => {
  if (code !== null && code !== 0) fail(`server exited ${code}`)
  if (code === 0 && phase !== 'done') fail(`server exited 0 before completing (phase: ${phase})`)
})

send({ jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } })
