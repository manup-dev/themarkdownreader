// Smoke: spawn the BUILT MCP server and complete an initialize handshake
// over stdio. Verifies the dist build is runnable (shebang, ESM imports
// resolved) — the exact thing `npx md-reader-mcp` does for an end user.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const server = spawn('node', [path.join(root, 'mcp-server/dist/index.js')], {
  stdio: ['pipe', 'pipe', 'inherit'],
})

const initialize = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } },
}) + '\n'

let out = ''
const timeout = setTimeout(() => { console.error('FAIL: no initialize response in 10s'); server.kill(); process.exit(1) }, 10_000)
server.stdout.on('data', (d) => {
  out += d.toString()
  if (out.includes('"serverInfo"')) {
    clearTimeout(timeout)
    console.log('PASS: MCP initialize handshake')
    server.kill()
    process.exit(0)
  }
})
server.on('exit', (code) => {
  if (code !== null && code !== 0) { console.error(`FAIL: server exited ${code}`); process.exit(1) }
})
server.stdin.write(initialize)
