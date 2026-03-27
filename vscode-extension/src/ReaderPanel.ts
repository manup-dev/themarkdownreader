import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'

export class ReaderPanel {
  public static current: ReaderPanel | undefined
  private static readonly viewType = 'mdReader'

  /** Called by extension.ts to receive progress updates from webview */
  public static onProgressCallback: ((percent: number, minutesLeft: number, fileName?: string, totalWords?: number) => void) | undefined
  /** Called when the panel is disposed */
  public static onDisposeCallback: (() => void) | undefined
  /** Called when panel active state changes (for context key) */
  public static onPanelActiveCallback: ((active: boolean) => void) | undefined

  private readonly panel: vscode.WebviewPanel
  private readonly extensionUri: vscode.Uri
  private disposables: vscode.Disposable[] = []
  private debounceTimer: NodeJS.Timeout | undefined

  // Feature 10: Session tracking
  private readonly sessionStart: number = Date.now()
  private lastPercent = 0
  private lastWordCount = 0
  private currentFileName = ''

  // Pending content to send when webview is ready (set by loadContent before 'ready' fires)
  private pendingContent: { content: string; fileName: string; view?: string; section?: string } | null = null
  private pendingContentTimer: ReturnType<typeof setTimeout> | null = null

  public static createOrShow(context: vscode.ExtensionContext, defaultView = 'read') {
    const column = vscode.ViewColumn.Beside

    if (ReaderPanel.current) {
      ReaderPanel.current.panel.reveal(column)
      ReaderPanel.current.sendCurrentEditor()
      return
    }

    const panel = vscode.window.createWebviewPanel(
      ReaderPanel.viewType,
      'md-reader',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(context.extensionUri, 'webview', 'dist'),
        ],
      },
    )

    ReaderPanel.current = new ReaderPanel(panel, context.extensionUri, defaultView)
    ReaderPanel.onPanelActiveCallback?.(true)
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, defaultView: string) {
    this.panel = panel
    this.extensionUri = extensionUri

    this.panel.webview.html = this.getHtmlForWebview(defaultView)

    // Handle webview messages
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables,
    )

    // Cleanup on close
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)

    // Send initial content when webview is ready
    // (webview posts 'ready' message on mount)
  }

  public postMessage(message: unknown) {
    this.panel.webview.postMessage(message)
  }

  public updateContent(document: vscode.TextDocument) {
    // Debounce rapid updates (typing)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      const fileName = path.basename(document.fileName)
      this.currentFileName = fileName
      const content = document.getText()
      this.lastWordCount = content.split(/\s+/).filter(Boolean).length
      this.panel.webview.postMessage({
        type: 'setMarkdown',
        content,
        fileName,
      })
    }, 300)
  }

  public sendCurrentEditor() {
    const editor = vscode.window.activeTextEditor
    if (editor?.document.languageId === 'markdown') {
      this.updateContent(editor.document)
    }
  }

  /** Load specific content + view, handling the case where webview isn't ready yet */
  public loadContent(content: string, fileName: string, view?: string, section?: string) {
    this.pendingContent = { content, fileName, view, section }
    // Cancel any previous pending timer to avoid double-sends
    if (this.pendingContentTimer) clearTimeout(this.pendingContentTimer)
    // For fresh panels: the 'ready' handler will call sendPendingContent().
    // For already-mounted panels: retry multiple times to ensure delivery.
    this.pendingContentTimer = setTimeout(() => this.sendPendingContent(), 300)
    setTimeout(() => this.sendPendingContent(), 800)
    setTimeout(() => this.sendPendingContent(), 1500)
  }

  private sendPendingContent() {
    if (!this.pendingContent) return
    const { content, fileName, view, section } = this.pendingContent
    this.currentFileName = fileName
    this.lastWordCount = content.split(/\s+/).filter(Boolean).length
    this.panel.webview.postMessage({ type: 'setMarkdown', content, fileName })
    // Send view switch AFTER setMarkdown settles (setMarkdown resets viewMode to 'read')
    if (view) {
      setTimeout(() => {
        this.panel.webview.postMessage({ type: 'config', defaultView: view })
        // Navigate to section if specified
        if (section) {
          const slug = section.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s]+/g, '-')
          this.panel.webview.postMessage({ type: 'scrollToSection', sectionId: slug })
        }
      }, 200)
    }
    this.pendingContent = null
    // Cancel fallback timer if ready handler already sent
    if (this.pendingContentTimer) { clearTimeout(this.pendingContentTimer); this.pendingContentTimer = null }
  }

  private handleMessage(message: { type: string; [key: string]: unknown }) {
    switch (message.type) {
      case 'ready':
        // If content was queued (MCP trigger), send config WITHOUT defaultView — pendingContent controls the view
        if (this.pendingContent) {
          this.sendConfig(true)
          this.sendPendingContent()
        } else {
          this.sendConfig()
          this.sendCurrentEditor()
        }
        break

      case 'navigate': {
        // Jump to line in editor
        const line = typeof message.line === 'number' && isFinite(message.line) ? Math.max(0, message.line) : 0
        const editor = vscode.window.activeTextEditor
        if (editor) {
          const maxLine = editor.document.lineCount - 1
          const safeLine = Math.min(line, maxLine)
          const pos = new vscode.Position(safeLine, 0)
          editor.selection = new vscode.Selection(pos, pos)
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
        }
        break
      }
      case 'saveState': {
        // Persist theme/fontSize to VS Code settings
        const config = vscode.workspace.getConfiguration('md-reader')
        if (message.theme) config.update('theme', message.theme, vscode.ConfigurationTarget.Global)
        if (message.fontSize) config.update('fontSize', message.fontSize, vscode.ConfigurationTarget.Global)
        break
      }

      case 'progress': {
        const percent = message.percent as number
        const minutesLeft = message.minutesLeft as number
        const totalWords = (message.totalWords as number) ?? 0
        const progressFileName = (message.fileName as string) ?? this.currentFileName
        // Feature 10: Track for session summary
        this.lastPercent = percent
        this.lastWordCount = totalWords
        if (progressFileName) this.currentFileName = progressFileName
        if (ReaderPanel.onProgressCallback) {
          ReaderPanel.onProgressCallback(percent, minutesLeft, this.currentFileName, totalWords)
        }
        break
      }

      case 'info':
        vscode.window.showInformationMessage(message.text as string)
        break
    }
  }

  private sendConfig(skipDefaultView = false) {
    const config = vscode.workspace.getConfiguration('md-reader')
    const vscodeTheme = vscode.window.activeColorTheme.kind

    let theme = config.get<string>('theme', 'auto')
    if (theme === 'auto') {
      theme = vscodeTheme === vscode.ColorThemeKind.Dark || vscodeTheme === vscode.ColorThemeKind.HighContrast
        ? 'dark' : 'light'
    }

    const msg: Record<string, unknown> = {
      type: 'config',
      theme,
      fontSize: config.get<number>('fontSize', 18),
      ollamaUrl: config.get<string>('ollamaUrl', 'http://localhost:11434'),
    }
    if (!skipDefaultView) {
      msg.defaultView = config.get<string>('defaultView', 'read')
    }
    this.panel.webview.postMessage(msg)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private getHtmlForWebview(defaultView: string): string {
    const webview = this.panel.webview

    // Try to load built webview assets
    const webviewDistPath = path.join(this.extensionUri.fsPath, 'webview', 'dist')
    const indexPath = path.join(webviewDistPath, 'index.html')

    if (fs.existsSync(indexPath)) {
      // Production: load built webview
      let html = fs.readFileSync(indexPath, 'utf-8')

      // Convert relative paths to webview URIs
      // Use Uri.joinPath with extensionUri (not Uri.file) so it works in Remote SSH
      const webviewDistUri = vscode.Uri.joinPath(this.extensionUri, 'webview', 'dist')
      const baseUri = webview.asWebviewUri(webviewDistUri)
      html = html.replace(/(href|src)="\.\/assets\//g, `$1="${baseUri}/assets/`)

      // Remove crossorigin attributes (not needed in webview, can cause CORS issues)
      html = html.replace(/ crossorigin/g, '')

      // DO NOT inject a CSP — VS Code provides its own CSP for webviews.
      // Adding a custom one is more restrictive and blocks module scripts.

      return html
    }

    // Development fallback: inline minimal React app
    const nonce = getNonce()
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src http://localhost:* https://openrouter.ai; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
  <title>md-reader</title>
  <style>
    body { margin: 0; padding: 20px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    h1 { font-size: 1.5em; margin: 0 0 8px; }
    p { color: var(--vscode-descriptionForeground); margin: 4px 0; }
    .prose { max-width: 720px; margin: 0 auto; line-height: 1.7; }
    .prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6 { margin-top: 1.5em; margin-bottom: 0.5em; }
    .prose h1 { font-size: 2em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 0.3em; }
    .prose h2 { font-size: 1.5em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 0.3em; }
    .prose h3 { font-size: 1.25em; }
    .prose p { margin: 0.8em 0; }
    .prose code { background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    .prose pre { background: var(--vscode-textCodeBlock-background); padding: 12px; border-radius: 6px; overflow-x: auto; }
    .prose pre code { background: none; padding: 0; }
    .prose blockquote { border-left: 3px solid var(--vscode-textBlockQuote-border); margin: 0; padding: 0 16px; color: var(--vscode-textBlockQuote-foreground); }
    .prose ul, .prose ol { padding-left: 1.5em; }
    .prose li { margin: 0.3em 0; }
    .prose a { color: var(--vscode-textLink-foreground); text-decoration: none; }
    .prose a:hover { text-decoration: underline; }
    .prose table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    .prose th, .prose td { border: 1px solid var(--vscode-panel-border); padding: 6px 12px; text-align: left; }
    .prose th { background: var(--vscode-textCodeBlock-background); }
    .prose strong { color: var(--vscode-foreground); }
    .prose img { max-width: 100%; border-radius: 6px; }
    .prose hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 2em 0; }
    .badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .stats { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
    #content { display: none; }
    #loading { text-align: center; padding: 40px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div id="loading">
    <h1>md-reader</h1>
    <p>Open a markdown file to start reading.</p>
    <p style="font-size:12px; margin-top: 20px; opacity: 0.6">Tip: For the full experience with mind maps, treemaps, and AI features,<br>build the webview: <code>cd vscode-extension/webview && npm run build</code></p>
  </div>
  <div id="content">
    <div class="stats" id="stats"></div>
    <div class="prose" id="markdown-body"></div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Simple markdown to HTML converter (fallback when webview not built)
    function mdToHtml(md) {
      return md
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/^> (.+)$/gm, '<blockquote><p>$1</p></blockquote>')
        .replace(/^---$/gm, '<hr>')
        .replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>')
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
        .replace(/\\*([^*]+)\\*/g, '<em>$1</em>')
        .replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, '<img alt="$1" src="$2">')
        .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\\/li>)/s, '<ul>$1</ul>')
        .replace(/\\n\\n/g, '</p><p>')
        .replace(/^(?!<[hbuolpai])/gm, '<p>')
    }

    function wordCount(text) {
      return text.split(/\\s+/).filter(Boolean).length;
    }

    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (msg.type === 'setMarkdown') {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = 'block';
        document.getElementById('markdown-body').innerHTML = mdToHtml(msg.content);
        var words = wordCount(msg.content);
        var mins = Math.max(1, Math.ceil(words / 230));
        document.getElementById('stats').innerHTML =
          '<span class="badge">' + msg.fileName + '</span> &nbsp; ' +
          words.toLocaleString() + ' words &middot; ' + mins + ' min read';
      }
      if (msg.type === 'config') {
        // Apply font size
        document.querySelector('.prose').style.fontSize = msg.fontSize + 'px';
      }
    });

    // Tell extension we're ready
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`
  }

  public dispose() {
    // Clear pending debounce timer
    if (this.debounceTimer) clearTimeout(this.debounceTimer)

    // Feature 10: Show reading session summary on close
    const sessionDuration = Date.now() - this.sessionStart
    const sessionSeconds = Math.floor(sessionDuration / 1000)
    if (sessionSeconds > 30 && this.currentFileName && this.lastPercent > 0) {
      const minutes = Math.floor(sessionSeconds / 60)
      const wordsRead = Math.round((this.lastPercent / 100) * this.lastWordCount)
      const displayTime = minutes > 0 ? `${minutes}m` : `${sessionSeconds}s`
      vscode.window.showInformationMessage(
        `\uD83D\uDCD6 Read ${wordsRead} words (${this.lastPercent}%) of ${this.currentFileName} in ${displayTime}`,
      )
    }

    ReaderPanel.current = undefined
    ReaderPanel.onPanelActiveCallback?.(false)
    ReaderPanel.onDisposeCallback?.()
    this.panel.dispose()
    while (this.disposables.length) {
      const d = this.disposables.pop()
      if (d) d.dispose()
    }
  }
}

function getNonce(): string {
  let text = ''
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return text
}
