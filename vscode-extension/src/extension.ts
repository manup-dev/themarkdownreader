import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { ReaderPanel } from './ReaderPanel'

const WORDS_PER_MINUTE = 230

// ── Helpers ──────────────────────────────────────────────────────────

/** Slugify a heading string the same way most markdown renderers do */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Count words in a string */
function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** Parse headings from a markdown document, returning { line, level, text } */
function parseHeadings(doc: vscode.TextDocument): { line: number; level: number; text: string }[] {
  const headings: { line: number; level: number; text: string }[] = []
  const headingRe = /^(#{1,6})\s+(.+)/
  for (let i = 0; i < doc.lineCount; i++) {
    const match = doc.lineAt(i).text.match(headingRe)
    if (match) {
      headings.push({ line: i, level: match[1].length, text: match[2].trim() })
    }
  }
  return headings
}

// ── Feature 7: File progress tracking ────────────────────────────────

/** Map of file names to their reading progress */
const fileProgressMap = new Map<string, { progress: number; words: number }>()

/** Build a tooltip string showing progress for all tracked files */
function buildProgressTooltip(): string {
  if (fileProgressMap.size === 0) {
    return 'Open in md-reader'
  }
  const lines = ['md-reader - Reading Progress:', '']
  for (const [fileName, info] of fileProgressMap) {
    const filled = Math.round(info.progress / 10)
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled)
    lines.push(`${fileName}: ${bar} ${info.progress}% (${info.words} words)`)
  }
  return lines.join('\n')
}

// ── Feature 6: Get selected text helper ──────────────────────────────

/** Get selected text from active editor, or show info message if none */
function getSelectedText(): string | undefined {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showInformationMessage('Select some text first')
    return undefined
  }
  const selection = editor.selection
  const selectedText = editor.document.getText(selection)
  if (!selectedText) {
    vscode.window.showInformationMessage('Select some text first')
    return undefined
  }
  return selectedText
}

// ── Feature 8: Auto-open README suggestion ───────────────────────────

async function autoSuggestReadme(context: vscode.ExtensionContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders
  if (!folders || folders.length === 0) return

  const workspaceFolder = folders[0].uri.fsPath
  const promptKey = 'md-reader-readme-prompted-' + workspaceFolder

  if (context.globalState.get<boolean>(promptKey)) return

  const readmePath = path.join(workspaceFolder, 'README.md')
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(readmePath))
  } catch {
    // README.md doesn't exist
    return
  }

  // Delay 3 seconds before showing suggestion
  setTimeout(async () => {
    const choice = await vscode.window.showInformationMessage(
      'New project? Read README.md in md-reader for a beautiful reading experience',
      'Open README',
    )
    // Mark as prompted regardless of choice
    await context.globalState.update(promptKey, true)

    if (choice === 'Open README') {
      const doc = await vscode.workspace.openTextDocument(readmePath)
      await vscode.window.showTextDocument(doc)
      await vscode.commands.executeCommand('md-reader.openReader')
    }
  }, 3000)
}

// ── Activation ───────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  // ── Commands ──────────────────────────────────────────────────────

  // Open reader for current markdown file
  context.subscriptions.push(
    vscode.commands.registerCommand('md-reader.openReader', () => {
      ReaderPanel.createOrShow(context, 'read')
    }),
  )

  // Open mind map directly
  context.subscriptions.push(
    vscode.commands.registerCommand('md-reader.openMindMap', () => {
      ReaderPanel.createOrShow(context, 'mindmap')
    }),
  )

  // Read aloud
  context.subscriptions.push(
    vscode.commands.registerCommand('md-reader.readAloud', () => {
      ReaderPanel.createOrShow(context, 'read')
      // Webview will receive a separate 'readAloud' message
      setTimeout(() => ReaderPanel.current?.postMessage({ type: 'readAloud' }), 500)
    }),
  )

  // Feature 6: Summarize Selection
  context.subscriptions.push(
    vscode.commands.registerCommand('md-reader.summarizeSelection', () => {
      const selectedText = getSelectedText()
      if (!selectedText) return
      ReaderPanel.createOrShow(context, 'read')
      setTimeout(() => {
        ReaderPanel.current?.postMessage({ type: 'aiAction', action: 'summarize', text: selectedText })
      }, 500)
    }),
  )

  // Feature 6: Explain Selection
  context.subscriptions.push(
    vscode.commands.registerCommand('md-reader.explainSelection', () => {
      const selectedText = getSelectedText()
      if (!selectedText) return
      ReaderPanel.createOrShow(context, 'read')
      setTimeout(() => {
        ReaderPanel.current?.postMessage({ type: 'aiAction', action: 'explain', text: selectedText })
      }, 500)
    }),
  )

  // Feature 6: Read Selection Aloud
  context.subscriptions.push(
    vscode.commands.registerCommand('md-reader.readSelectionAloud', () => {
      const selectedText = getSelectedText()
      if (!selectedText) return
      ReaderPanel.createOrShow(context, 'read')
      setTimeout(() => {
        ReaderPanel.current?.postMessage({ type: 'readAloudText', text: selectedText })
      }, 500)
    }),
  )

  // Feature 9: Copy as Rich Text
  context.subscriptions.push(
    vscode.commands.registerCommand('md-reader.copyAsRichText', () => {
      if (!ReaderPanel.current) {
        vscode.window.showInformationMessage('Open a markdown file in md-reader first')
        return
      }
      ReaderPanel.current.postMessage({ type: 'copyRichText' })
    }),
  )

  // ── Auto-update webview ───────────────────────────────────────────

  // Auto-update webview when active markdown editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document.languageId === 'markdown') {
        ReaderPanel.current?.updateContent(editor.document)
      }
    }),
  )

  // Auto-update on document edit
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === 'markdown' && e.document === vscode.window.activeTextEditor?.document) {
        ReaderPanel.current?.updateContent(e.document)
      }
    }),
  )

  // ── Feature 1: Sync scroll — editor → reader ─────────────────────

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      const editor = e.textEditor
      if (editor.document.languageId !== 'markdown') return
      if (!ReaderPanel.current) return

      const firstVisibleLine = e.visibleRanges[0]?.start.line ?? 0

      // Search backward from first visible line for the nearest heading
      for (let i = firstVisibleLine; i >= 0; i--) {
        const lineText = editor.document.lineAt(i).text
        const match = lineText.match(/^#{1,6}\s+(.+)/)
        if (match) {
          const sectionId = slugify(match[1].trim())
          ReaderPanel.current.postMessage({ type: 'scrollToSection', sectionId })
          break
        }
      }
    }),
  )

  // ── Feature 2: CodeLens — reading time on headings ────────────────

  const codeLensProvider: vscode.CodeLensProvider = {
    provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
      if (doc.languageId !== 'markdown') return []

      const headings = parseHeadings(doc)
      const lenses: vscode.CodeLens[] = []

      for (let idx = 0; idx < headings.length; idx++) {
        const h = headings[idx]
        // Count words until next heading of same or higher (<=) level
        const endLine = (() => {
          for (let j = idx + 1; j < headings.length; j++) {
            if (headings[j].level <= h.level) return headings[j].line
          }
          return doc.lineCount
        })()

        let words = 0
        for (let line = h.line + 1; line < endLine; line++) {
          words += wordCount(doc.lineAt(line).text)
        }
        const mins = Math.max(1, Math.ceil(words / WORDS_PER_MINUTE))

        const range = new vscode.Range(h.line, 0, h.line, 0)
        lenses.push(
          new vscode.CodeLens(range, {
            title: `⏱ ${mins} min · ${words} words`,
            command: '',
          }),
        )
      }

      return lenses
    },
  }

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'markdown', scheme: 'file' },
      codeLensProvider,
    ),
  )

  // ── Feature 3: Status bar — reading progress ─────────────────────

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBar.text = '$(book) md-reader'
  statusBar.command = 'md-reader.openReader'
  statusBar.tooltip = 'Open in md-reader'
  context.subscriptions.push(statusBar)

  const resetStatusBar = () => {
    statusBar.text = '$(book) md-reader'
    statusBar.tooltip = buildProgressTooltip()
  }

  // Show status bar when a markdown file is open
  const updateStatusBar = () => {
    if (vscode.window.activeTextEditor?.document.languageId === 'markdown') {
      statusBar.show()
    } else {
      statusBar.hide()
    }
  }
  updateStatusBar()
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBar))

  // Listen for progress messages from the webview via ReaderPanel callback
  ReaderPanel.onProgressCallback = (percent: number, minutesLeft: number, fileName?: string, totalWords?: number) => {
    statusBar.text = `$(book) ${percent}% · ${minutesLeft}m left`
    // Feature 7: Track per-file progress
    if (fileName) {
      fileProgressMap.set(fileName, { progress: percent, words: totalWords ?? 0 })
    }
    statusBar.tooltip = buildProgressTooltip()
  }

  ReaderPanel.onDisposeCallback = () => {
    resetStatusBar()
  }

  // ── Feature 4: Hover provider — preview markdown links ───────────

  const hoverProvider: vscode.HoverProvider = {
    provideHover(doc, position): vscode.Hover | undefined {
      const line = doc.lineAt(position.line).text
      // Match markdown links: [text](path.md)
      const linkRe = /\[([^\]]+)\]\(([^)]+\.md)\)/g
      let match: RegExpExecArray | null
      while ((match = linkRe.exec(line)) !== null) {
        const startChar = match.index
        const endChar = match.index + match[0].length
        if (position.character < startChar || position.character > endChar) continue

        const linkPath = decodeURIComponent(match[2])
        const docDir = path.dirname(doc.uri.fsPath)
        const absPath = path.isAbsolute(linkPath) ? linkPath : path.resolve(docDir, linkPath)

        if (!fs.existsSync(absPath)) continue

        const content = fs.readFileSync(absPath, 'utf-8')
        const fileName = path.basename(absPath)
        const words = wordCount(content)
        const mins = Math.max(1, Math.ceil(words / WORDS_PER_MINUTE))

        // Find first heading
        const headingMatch = content.match(/^#{1,6}\s+(.+)/m)
        const firstHeading = headingMatch ? headingMatch[1].trim() : ''

        const parts = [`**${fileName}**`]
        if (firstHeading) parts.push('', firstHeading)
        parts.push('', `📄 ${words} words · ${mins} min read`)

        const md = new vscode.MarkdownString(parts.join('\n'))
        const range = new vscode.Range(position.line, startChar, position.line, endChar)
        return new vscode.Hover(md, range)
      }
      return undefined
    },
  }

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: 'markdown', scheme: 'file' },
      hoverProvider,
    ),
  )

  // ── Feature 5: Document symbol provider — outline view ────────────

  const symbolProvider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(doc): vscode.DocumentSymbol[] {
      const headings = parseHeadings(doc)
      if (headings.length === 0) return []

      // Compute word counts per section (same logic as CodeLens)
      const sectionWords: number[] = headings.map((h, idx) => {
        const endLine = (() => {
          for (let j = idx + 1; j < headings.length; j++) {
            if (headings[j].level <= h.level) return headings[j].line
          }
          return doc.lineCount
        })()
        let words = 0
        for (let line = h.line + 1; line < endLine; line++) {
          words += wordCount(doc.lineAt(line).text)
        }
        return words
      })

      // Build nested symbol tree
      function buildTree(startIdx: number, endIdx: number, parentLevel: number): vscode.DocumentSymbol[] {
        const symbols: vscode.DocumentSymbol[] = []
        let i = startIdx

        while (i < endIdx) {
          const h = headings[i]
          if (h.level <= parentLevel) break

          const words = sectionWords[i]
          const mins = Math.max(1, Math.ceil(words / WORDS_PER_MINUTE))

          // Find the range: from this heading to the next heading of same or higher level
          let rangeEndLine = doc.lineCount - 1
          for (let j = i + 1; j < endIdx; j++) {
            if (headings[j].level <= h.level) {
              rangeEndLine = headings[j].line - 1
              break
            }
          }

          const range = new vscode.Range(h.line, 0, rangeEndLine, doc.lineAt(rangeEndLine).text.length)
          const selRange = new vscode.Range(h.line, 0, h.line, doc.lineAt(h.line).text.length)

          const symbol = new vscode.DocumentSymbol(
            h.text,
            `⏱ ${mins}m · ${words} words`,
            vscode.SymbolKind.String,
            range,
            selRange,
          )

          // Collect children: all subsequent headings with level > h.level until we hit same or higher
          let childEnd = i + 1
          while (childEnd < endIdx && headings[childEnd].level > h.level) {
            childEnd++
          }

          if (childEnd > i + 1) {
            symbol.children = buildTree(i + 1, childEnd, h.level)
          }

          symbols.push(symbol)
          i = childEnd
        }

        return symbols
      }

      return buildTree(0, headings.length, 0)
    },
  }

  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      { language: 'markdown', scheme: 'file' },
      symbolProvider,
    ),
  )

  // ── Feature 8: Auto-open README suggestion ─────────────────────────
  autoSuggestReadme(context)
}

export function deactivate() {
  ReaderPanel.current?.dispose()
}
