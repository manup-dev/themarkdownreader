#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import fs from 'fs'
import path from 'path'
import { z } from 'zod'

const PROJECT_ROOT = process.cwd()
const MD_READER_URL = process.env.MD_READER_URL || 'http://localhost:5183'
const IS_VSCODE = !!(process.env.VSCODE_IPC_HOOK_CLI || process.env.VSCODE_GIT_IPC_HANDLE || process.env.TERM_PROGRAM === 'vscode')

// ─── Helpers ────────────────────────────────────────────────────────────────

function validateMdPath(inputPath: string): string {
  const resolved = path.resolve(PROJECT_ROOT, inputPath)
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error(`Path "${inputPath}" is outside the project root`)
  }
  if (!resolved.endsWith('.md')) {
    throw new Error(`Path "${inputPath}" is not a markdown file`)
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${inputPath}`)
  }
  return resolved
}

async function checkHealth(): Promise<void> {
  try {
    const res = await fetch(MD_READER_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) throw new Error()
  } catch {
    throw new Error(
      `md-reader is not running at ${MD_READER_URL}. Start it with: npm run dev or ./startup.sh`
    )
  }
}

async function openView(absPath: string, view: string, extra?: Record<string, string>): Promise<string> {
  const relativePath = path.relative(PROJECT_ROOT, absPath)

  // VS Code: use URI handler → opens in the VS Code webview panel
  if (IS_VSCODE) {
    const params = new URLSearchParams({
      file: absPath,
      view,
      ...extra,
    })
    const vscodeUri = `vscode://md-reader.md-reader/open?${params.toString()}`

    const { execSync } = await import('child_process')
    execSync(`code --open-url "${vscodeUri}"`, { stdio: 'ignore' })

    return vscodeUri
  }

  // Browser: health check + open in default browser
  await checkHealth()

  const params = new URLSearchParams({
    file: relativePath,
    view,
    ...extra,
  })

  const url = `${MD_READER_URL}/#${params.toString()}`

  const { default: open } = await import('open')
  await open(url)

  return url
}

// ─── MCP Server ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'md-reader',
  version: '0.1.0',
})

// Tool 1: show_mind_map
server.tool(
  'show_mind_map',
  'Open an interactive mind map visualization of a markdown file. Shows the document structure as an expandable tree with zoom/pan.',
  { path: z.string().describe('Relative path to a .md file, e.g. "docs/architecture.md"') },
  async ({ path: inputPath }) => {
    const absPath = validateMdPath(inputPath)
    const url = await openView(absPath, 'mindmap')
    return { content: [{ type: 'text', text: `Opened mind map for ${inputPath}\n${url}` }] }
  }
)

// Tool 2: show_knowledge_graph
server.tool(
  'show_knowledge_graph',
  'Open a force-directed concept network extracted from a markdown file. Shows concepts as nodes and relationships as edges, color-coded by type.',
  { path: z.string().describe('Relative path to a .md file') },
  async ({ path: inputPath }) => {
    const absPath = validateMdPath(inputPath)
    const url = await openView(absPath, 'knowledge-graph')
    return { content: [{ type: 'text', text: `Opened knowledge graph for ${inputPath}\n${url}` }] }
  }
)

// Tool 3: show_treemap
server.tool(
  'show_treemap',
  'Open a treemap showing document sections sized proportionally by word count. Hover for stats, click to navigate.',
  { path: z.string().describe('Relative path to a .md file') },
  async ({ path: inputPath }) => {
    const absPath = validateMdPath(inputPath)
    const url = await openView(absPath, 'treemap')
    return { content: [{ type: 'text', text: `Opened treemap for ${inputPath}\n${url}` }] }
  }
)

// Tool 4: read_aloud
server.tool(
  'read_aloud',
  'Start text-to-speech narration of a markdown file. Reads with markdown-aware prosody: slower headings, code block descriptions, quote announcements.',
  {
    path: z.string().describe('Relative path to a .md file'),
    section: z.string().optional().describe('Optional heading text to start reading from (case-insensitive substring match)'),
  },
  async ({ path: inputPath, section }) => {
    const absPath = validateMdPath(inputPath)
    const extra: Record<string, string> = { tts: 'true' }
    if (section) extra.section = section
    const url = await openView(absPath, 'read', extra)
    const msg = section
      ? `Started reading ${inputPath} aloud from section "${section}"`
      : `Started reading ${inputPath} aloud`
    return { content: [{ type: 'text', text: `${msg}\n${url}` }] }
  }
)

// Tool 5: show_coach
server.tool(
  'show_coach',
  'Open the AI coach view with simplified explanations and interactive quizzes for a markdown file.',
  {
    path: z.string().describe('Relative path to a .md file'),
    section: z.string().optional().describe('Optional heading text to focus on (case-insensitive substring match)'),
  },
  async ({ path: inputPath, section }) => {
    const absPath = validateMdPath(inputPath)
    const extra: Record<string, string> = {}
    if (section) extra.section = section
    const url = await openView(absPath, 'coach', extra)
    return { content: [{ type: 'text', text: `Opened coach view for ${inputPath}\n${url}` }] }
  }
)

// ─── Start ──────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('MCP server failed to start:', err)
  process.exit(1)
})
