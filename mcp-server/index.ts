#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import fs from 'fs'
import path from 'path'
import { z } from 'zod'

const PROJECT_ROOT = process.cwd()
const MD_READER_URL = process.env.MD_READER_URL || 'http://localhost:5183'

// ─── Helpers ────────────────────────────────────────────────────────────────

function validateMdPath(inputPath: string): string {
  const resolved = path.resolve(PROJECT_ROOT, inputPath)
  if (resolved !== PROJECT_ROOT && !resolved.startsWith(PROJECT_ROOT + path.sep)) {
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

  // TTS requires audio output — VS Code webview sandbox can't produce sound, so always use browser
  const skipVscode = extra?.tts === 'true'

  // VS Code integration: write view file + open file via code CLI
  // The extension's onDidChangeActiveTextEditor reads .md-reader-view and opens the panel
  const viewFile = path.join(PROJECT_ROOT, '.md-reader-view')
  if (!skipVscode) try {
    fs.writeFileSync(viewFile, view)
    const { execFileSync } = await import('child_process')
    execFileSync('/snap/bin/code', [absPath], { stdio: 'ignore', timeout: 3000 })
    return `vscode: opened ${relativePath} in ${view} view`
  } catch {
    try { fs.unlinkSync(viewFile) } catch { /* ignore */ }
    // code CLI not available — fall back to browser
  }

  // Browser fallback: health check + open in default browser
  await checkHealth()

  const browserParams = new URLSearchParams({
    file: relativePath,
    view,
    ...extra,
  })

  const url = `${MD_READER_URL}/#${browserParams.toString()}`

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

// Tool 6: generate_podcast
server.tool(
  'generate_podcast',
  'Generate an AI podcast overview of a markdown file. Two AI hosts discuss the key ideas in a conversational format.',
  {
    path: z.string().describe('Absolute or relative path to the .md file'),
  },
  async ({ path: inputPath }) => {
    const absPath = validateMdPath(inputPath)
    await checkHealth()
    openView(absPath, 'podcast')
    return {
      content: [
        {
          type: 'text',
          text: `Opened podcast view for ${path.basename(absPath)}. The AI will generate a two-host conversation about the document.`,
        },
      ],
    }
  }
)

// Tool 7: generate_diagram
server.tool(
  'generate_diagram',
  'Generate an AI diagram from a markdown file. Extracts key concepts and relationships into a visual Excalidraw diagram.',
  {
    path: z.string().describe('Absolute or relative path to the .md file'),
    section: z.string().optional().describe('Optional heading to focus on'),
    type: z.enum(['auto', 'flowchart', 'hierarchy', 'sequence', 'mindmap', 'comparison']).optional().describe('Diagram type (default: auto-detect)'),
  },
  async ({ path: inputPath, section, type }) => {
    const absPath = validateMdPath(inputPath)
    await checkHealth()
    const extra = [
      section ? `section=${encodeURIComponent(section)}` : '',
      type ? `diagramType=${type}` : '',
    ].filter(Boolean).join('&')
    openView(absPath, 'diagram', extra || undefined)
    return {
      content: [
        {
          type: 'text',
          text: `Opened diagram view for ${path.basename(absPath)}.${type ? ` Type: ${type}.` : ' AI will auto-detect the best diagram type.'}`,
        },
      ],
    }
  }
)

// ─── Tool 8: create_share_url ───────────────────────────────────────────────

server.tool(
  'create_share_url',
  'Build a portable share URL for a markdown file plus its sidecar annotations (if a .foo.md.annot file exists alongside). Returns a self-contained link that opens the doc + annotations in any md-reader instance.',
  {
    path: z.string().describe('Relative path to the .md file'),
    publicDocUrl: z.string().optional().describe('Public URL where this .md is reachable (e.g. raw.githubusercontent.com URL). Required for the share link to actually be openable elsewhere.'),
    maxInlineBytes: z.number().optional().describe('Soft cap for inline-encoded annotations. Default 8192. If exceeded, falls back to URL-pair tier (recipient sibling-resolves the .annot).'),
  },
  async ({ path: inputPath, publicDocUrl, maxInlineBytes }) => {
    const absPath = validateMdPath(inputPath)
    const md = fs.readFileSync(absPath, 'utf-8')
    const fileName = path.basename(absPath)
    const sidecarPath = path.join(path.dirname(absPath), `.${fileName}.annot`)
    const sidecarExists = fs.existsSync(sidecarPath)
    const walExisting = sidecarExists ? fs.readFileSync(sidecarPath, 'utf-8') : ''

    const contentHash = await sha256Hex(md)
    const docKey = contentHash
    const headerLine = JSON.stringify({
      v: 1,
      ts: Date.now(),
      id: `hdr_${Date.now().toString(36)}`,
      op: 'header',
      doc: { docKey, title: fileName, contentHash, source: publicDocUrl },
      schema: 'mdreader.annot/1',
      createdAt: Date.now(),
      createdBy: 'claude-code-mcp',
    })

    // Strip any existing header in the sidecar; we replace it with our own.
    const tailLines = walExisting.split('\n').filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return false
      try {
        const parsed = JSON.parse(trimmed) as { op?: string }
        return parsed.op !== 'header'
      } catch {
        return false
      }
    })
    const wal = [headerLine, ...tailLines].join('\n') + '\n'

    if (!publicDocUrl) {
      return {
        content: [{
          type: 'text',
          text: `Built WAL for ${inputPath} (${tailLines.length} event${tailLines.length === 1 ? '' : 's'}, ${wal.length} bytes), but no publicDocUrl was provided so a share URL cannot be assembled. Pass a public raw URL to get a copy-pasteable share link.`,
        }],
      }
    }

    const cap = maxInlineBytes ?? 8192
    const origin = MD_READER_URL
    const encoded = base64UrlEncode(wal)
    const inlineUrl = `${origin}/#url=${encodeURIComponent(publicDocUrl)}&annot=${encoded}&hash=sha256:${contentHash}`
    const fitsInline = inlineUrl.length <= cap

    const shareUrl = fitsInline
      ? inlineUrl
      : `${origin}/#url=${encodeURIComponent(publicDocUrl)}&hash=sha256:${contentHash}`

    const tier = fitsInline ? 'inline' : 'url-pair'
    const note = fitsInline
      ? `${tailLines.length} event${tailLines.length === 1 ? '' : 's'} fit inline.`
      : `${tailLines.length} event${tailLines.length === 1 ? '' : 's'} too large for inline; using URL-pair. Recipient will sibling-resolve .${fileName}.annot from the same host.`

    return {
      content: [{
        type: 'text',
        text: `Share URL for ${inputPath} (${tier}):\n${shareUrl}\n\n${note}\nWAL size: ${wal.length} bytes. Sidecar: ${sidecarExists ? sidecarPath : '(none — would only carry header)'}`,
      }],
    }
  }
)

// ─── Tool 9: open_share_url ─────────────────────────────────────────────────

server.tool(
  'open_share_url',
  'Open a md-reader share URL in the user\'s default browser. Use to hand off to a teammate or to preview a share you just created.',
  {
    url: z.string().describe('A share URL produced by create_share_url, or any URL whose hash carries #url= or #repo= share params.'),
  },
  async ({ url }) => {
    if (!/^https?:\/\//.test(url)) {
      throw new Error('URL must start with http:// or https://')
    }
    const { default: open } = await import('open')
    await open(url)
    return { content: [{ type: 'text', text: `Opened share URL in browser:\n${url}` }] }
  }
)

// ─── Helpers (share-specific) ──────────────────────────────────────────────

async function sha256Hex(text: string): Promise<string> {
  const { createHash } = await import('crypto')
  return createHash('sha256').update(text, 'utf-8').digest('hex')
}

function base64UrlEncode(text: string): string {
  return Buffer.from(text, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// ─── Start ──────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('MCP server failed to start:', err)
  process.exit(1)
})
