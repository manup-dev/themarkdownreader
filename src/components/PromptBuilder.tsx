import { useState, useCallback, useEffect, useRef } from 'react'
import { X, Copy, Check, Terminal, Wand2, ChevronDown } from 'lucide-react'
import { useStore } from '../store/useStore'
import { trackEvent } from '../lib/telemetry'
import type { Comment } from '../lib/docstore'

type PromptStyle = 'claude-code' | 'codex' | 'generic'

const STYLE_LABELS: Record<PromptStyle, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex / Copilot',
  generic: 'Generic',
}

interface LineMapping {
  sectionId: string
  line: number
}

interface Props {
  comments: Comment[]
  onClose: () => void
}

/**
 * Build a Claude Code-optimized prompt from user comments.
 * Uses line numbers when available (VS Code), section names otherwise.
 */
function buildPrompt(
  comments: Comment[],
  fileName: string,
  markdown: string,
  toc: { id: string; text: string; level: number }[],
  style: PromptStyle,
  lineMappings: LineMapping[],
  customInstructions: string,
): string {
  const lineMap = new Map(lineMappings.map((m) => [m.sectionId, m.line]))

  // Group comments by section
  const grouped = new Map<string, Comment[]>()
  for (const c of comments) {
    const key = c.sectionId || '__no_section__'
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(c)
  }

  const lines: string[] = []

  // Header
  if (style === 'claude-code') {
    lines.push(`In the file \`${fileName}\`:`)
    lines.push('')
    lines.push('## Requested changes')
    lines.push('')
  } else if (style === 'codex') {
    lines.push(`File: ${fileName}`)
    lines.push('')
    lines.push('Changes:')
    lines.push('')
  } else {
    lines.push(`# Changes for ${fileName}`)
    lines.push('')
  }

  // Comments by section
  for (const [sectionId, sectionComments] of grouped) {
    const tocEntry = toc.find((t) => t.id === sectionId)
    const sectionName = tocEntry?.text ?? 'Document'
    const lineNum = lineMap.get(sectionId)

    // Section header with line reference
    if (style === 'claude-code') {
      if (lineNum !== undefined) {
        lines.push(`### Section: "${sectionName}" (L${lineNum + 1})`)
      } else {
        lines.push(`### Section: "${sectionName}"`)
      }
    } else if (style === 'codex') {
      if (lineNum !== undefined) {
        lines.push(`## ${sectionName} (line ${lineNum + 1})`)
      } else {
        lines.push(`## ${sectionName}`)
      }
    } else {
      lines.push(`## ${sectionName}${lineNum !== undefined ? ` (line ${lineNum + 1})` : ''}`)
    }
    lines.push('')

    for (const c of sectionComments) {
      // Find approximate line of selected text within the section
      const selectedLine = findTextLine(markdown, c.selectedText)

      if (c.selectedText) {
        const truncated = c.selectedText.length > 200
          ? c.selectedText.slice(0, 200) + '...'
          : c.selectedText
        if (style === 'claude-code' && selectedLine !== -1) {
          lines.push(`> **Context** (around L${selectedLine + 1}): "${truncated}"`)
        } else {
          lines.push(`> "${truncated}"`)
        }
        lines.push('')
      }

      if (style === 'claude-code') {
        lines.push(`**Change:** ${c.comment}`)
      } else {
        lines.push(`- ${c.comment}`)
      }
      lines.push('')
    }
  }

  // Custom instructions
  if (customInstructions.trim()) {
    lines.push('---')
    lines.push('')
    lines.push('## Additional instructions')
    lines.push('')
    lines.push(customInstructions.trim())
    lines.push('')
  }

  // Footer
  if (style === 'claude-code') {
    lines.push('---')
    lines.push('')
    lines.push('Please implement all the changes above. Maintain the existing style, formatting, and tone of the document. If a change is ambiguous, make a reasonable choice and note it.')
  } else if (style === 'codex') {
    lines.push('---')
    lines.push('Apply all changes. Keep existing style.')
  }

  return lines.join('\n')
}

/** Compute section-to-line-number mappings from raw markdown */
function computeLineMappings(markdown: string): LineMapping[] {
  if (!markdown) return []
  const mdLines = markdown.split('\n')
  const headingRe = /^(#{1,6})\s+(.+)/
  const mappings: LineMapping[] = []

  for (let i = 0; i < mdLines.length; i++) {
    const match = mdLines[i].match(headingRe)
    if (match) {
      const text = match[2].trim()
      const slug = text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim()
      mappings.push({ sectionId: slug, line: i })
    }
  }
  return mappings
}

/** Find the 0-based line number where `text` first appears in `markdown` */
function findTextLine(markdown: string, text: string): number {
  if (!text || text.length < 5) return -1
  // Use first 80 chars as search key to avoid matching issues with formatting
  const searchKey = text.slice(0, 80).replace(/\s+/g, ' ').trim()
  const mdLines = markdown.split('\n')
  let runningText = ''
  for (let i = 0; i < mdLines.length; i++) {
    runningText += mdLines[i] + ' '
    if (runningText.replace(/\s+/g, ' ').includes(searchKey)) {
      return i
    }
  }
  return -1
}

export function PromptBuilder({ comments, onClose }: Props) {
  const fileName = useStore((s) => s.fileName) ?? 'document.md'
  const markdown = useStore((s) => s.markdown)
  const toc = useStore((s) => s.toc)
  const [style, setStyle] = useState<PromptStyle>('claude-code')
  const [customInstructions, setCustomInstructions] = useState('')
  const [copied, setCopied] = useState(false)
  const [showStyleDropdown, setShowStyleDropdown] = useState(false)
  const [terminalSent, setTerminalSent] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => {
    // Start with all unresolved comments selected
    return new Set(comments.filter((c) => !c.resolved).map((c) => c.id!))
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Check if running in VS Code (vscode injects this function into the webview)
  const isVscode = typeof window !== 'undefined' && 'acquireVsCodeApi' in window

  // Resolve line numbers from markdown content directly (computed, not state)
  const lineMappings = computeLineMappings(markdown)

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowStyleDropdown(false)
      }
    }
    if (showStyleDropdown) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [showStyleDropdown])

  const unresolved = comments.filter((c) => !c.resolved)
  const selected = unresolved.filter((c) => selectedIds.has(c.id!))

  const toggleComment = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = () => {
    if (selectedIds.size === unresolved.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(unresolved.map((c) => c.id!)))
    }
  }

  const prompt = buildPrompt(
    selected,
    fileName,
    markdown,
    toc,
    style,
    lineMappings,
    customInstructions,
  )

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(prompt)
    setCopied(true)
    trackEvent('prompt_builder_copied', { style, commentCount: selected.length })
    setTimeout(() => setCopied(false), 2000)
  }, [prompt, style, selected.length])

  const handleSendToTerminal = useCallback(() => {
    window.postMessage({ type: 'sendToTerminal', text: prompt }, '*')
    setTerminalSent(true)
    trackEvent('prompt_builder_terminal', { style, commentCount: selected.length })
    setTimeout(() => setTerminalSent(false), 2000)
  }, [prompt, style, selected.length])

  if (unresolved.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
            <Wand2 className="h-3.5 w-3.5" />
            Prompt Builder
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-2">
            <p className="text-sm text-gray-400">No unresolved comments to build a prompt from.</p>
            <p className="text-xs text-gray-400">Add comments by selecting text and clicking the comment icon.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
            <Wand2 className="h-3.5 w-3.5" />
            Prompt Builder
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Style selector + stats */}
        <div className="flex items-center justify-between mt-2">
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowStyleDropdown(!showStyleDropdown)}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
            >
              {STYLE_LABELS[style]}
              <ChevronDown className="h-3 w-3" />
            </button>
            {showStyleDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-xl py-1 z-50 min-w-32">
                {(Object.keys(STYLE_LABELS) as PromptStyle[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => { setStyle(s); setShowStyleDropdown(false) }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
                      s === style ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {STYLE_LABELS[s]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="text-[10px] text-gray-400">
            {selected.length}/{unresolved.length} selected &middot; {lineMappings.length > 0 ? 'L# refs' : 'section refs'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Comment selection list */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">
              Include comments
            </label>
            <button
              onClick={toggleAll}
              className="text-[10px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-400"
            >
              {selectedIds.size === unresolved.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {unresolved.map((c) => {
              const section = toc.find((t) => t.id === c.sectionId)
              return (
                <label
                  key={c.id}
                  className={`flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                    selectedIds.has(c.id!)
                      ? 'bg-blue-50 dark:bg-blue-950/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id!)}
                    onChange={() => toggleComment(c.id!)}
                    className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-gray-700 dark:text-gray-300 truncate">
                      {c.comment}
                    </p>
                    {section && (
                      <span className="text-[9px] text-gray-400">{section.text}</span>
                    )}
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        {/* Generated prompt */}
        <div>
          <label className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">
            Generated prompt
          </label>
          <textarea
            ref={textareaRef}
            value={prompt}
            readOnly
            className="w-full mt-1 h-48 text-xs font-mono px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 resize-y focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Custom instructions */}
        <div>
          <label className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">
            Additional instructions (optional)
          </label>
          <textarea
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="e.g., Use formal tone, keep code examples in Python, preserve all existing links..."
            className="w-full mt-1 h-16 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent text-gray-800 dark:text-gray-200 placeholder-gray-400 resize-y focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-800 flex items-center gap-2">
        <button
          onClick={handleCopy}
          disabled={selected.length === 0}
          className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-colors ${
            copied
              ? 'bg-green-600 text-white'
              : selected.length === 0
                ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied!' : 'Copy Prompt'}
        </button>

        {isVscode && (
          <button
            onClick={handleSendToTerminal}
            disabled={selected.length === 0}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-colors ${
              terminalSent
                ? 'bg-green-600 text-white'
                : selected.length === 0
                  ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-700 text-white hover:bg-gray-600'
            }`}
            title="Copy prompt and open terminal"
          >
            <Terminal className="h-3.5 w-3.5" />
            {terminalSent ? 'Sent!' : 'Terminal'}
          </button>
        )}
      </div>
    </div>
  )
}
