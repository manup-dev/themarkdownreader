import * as vscode from 'vscode'
import { ReaderPanel } from './ReaderPanel'

export function activate(context: vscode.ExtensionContext) {
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

  // Status bar item
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBar.text = '$(book) md-reader'
  statusBar.command = 'md-reader.openReader'
  statusBar.tooltip = 'Open in md-reader'
  context.subscriptions.push(statusBar)

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
}

export function deactivate() {
  ReaderPanel.current?.dispose()
}
