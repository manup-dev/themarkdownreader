#!/usr/bin/env node
// PostToolUse hook for the md-reader Claude Code plugin.
//
// Claude Code spawns this process after `mcp__md-reader__show_mind_map` runs,
// passing the PostToolUse event JSON on stdin. The bundled MCP server is
// configured with MD_READER_RENDER_INLINE=0, so the tool returns the raw
// mind_map JSON; here we re-render it using THIS terminal's real capabilities
// and hand the result back via `updatedToolOutput`.
//
// Contract (verified against code.claude.com/docs):
//   stdin : { tool_name, tool_output: { content: [{ type:'text', text }] }, ... }
//   stdout: { hookSpecificOutput: { hookEventName:'PostToolUse', updatedToolOutput } }
//   updatedToolOutput mirrors the original tool_output shape.
//
// Robustness: any failure passes the original output through untouched and
// exits 0 — the hook must never block or corrupt a tool result.
import { renderMindMapResult } from './bridge.js'

interface TextBlock {
  type: string
  text?: string
}
interface ToolOutput {
  content?: TextBlock[]
  [k: string]: unknown
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

async function main(): Promise<void> {
  const raw = await readStdin()

  let toolOutput: ToolOutput
  let original: string
  try {
    const payload = JSON.parse(raw) as { tool_output?: ToolOutput }
    toolOutput = payload.tool_output ?? {}
    original = toolOutput.content?.[0]?.text ?? ''
  } catch {
    // Unparseable event — emit nothing so the tool output stays as-is.
    process.exit(0)
  }

  let rendered: string
  try {
    rendered = await renderMindMapResult(original)
  } catch {
    rendered = original
  }

  // Clone the tool_output, replacing the first text block's text.
  const content: TextBlock[] = Array.isArray(toolOutput.content)
    ? toolOutput.content.map((b, i) => (i === 0 ? { ...b, text: rendered } : b))
    : [{ type: 'text', text: rendered }]
  const updatedToolOutput: ToolOutput = { ...toolOutput, content }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        updatedToolOutput,
      },
    }),
  )
  process.exit(0)
}

void main()
