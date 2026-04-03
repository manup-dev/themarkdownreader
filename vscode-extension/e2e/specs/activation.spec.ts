import { browser } from '@wdio/globals'

describe('Extension Activation', () => {
  it('should activate when a markdown file is opened', async () => {
    const workbench = await browser.getWorkbench()

    // Open the test.md fixture file
    await browser.executeWorkbench(async (vscode) => {
      const files = await vscode.workspace.findFiles('test.md')
      if (files.length > 0) {
        const doc = await vscode.workspace.openTextDocument(files[0])
        await vscode.window.showTextDocument(doc)
      }
    })

    await browser.pause(2000)

    // Verify the status bar item appears
    const statusBar = await workbench.getStatusBar()
    const items = await statusBar.getItems()
    const mdReaderItem = items.find(
      (item: string) => item.includes('md-reader') || item.includes('book'),
    )
    expect(mdReaderItem).toBeDefined()
  })

  it('should register openReader command', async () => {
    const result = await browser.executeWorkbench(async (vscode) => {
      const commands = await vscode.commands.getCommands(true)
      return commands.includes('md-reader.openReader')
    })

    expect(result).toBe(true)
  })

  it('should register all expected commands', async () => {
    const expectedCommands = [
      'md-reader.openReader',
      'md-reader.openMindMap',
      'md-reader.readAloud',
      'md-reader.openSummary',
      'md-reader.openTreemap',
      'md-reader.toggleToc',
      'md-reader.toggleTheme',
      'md-reader.focusMode',
      'md-reader.increaseFontSize',
      'md-reader.decreaseFontSize',
      'md-reader.copyAsRichText',
    ]

    const registeredCommands = await browser.executeWorkbench(async (vscode) => {
      return vscode.commands.getCommands(true)
    }) as string[]

    for (const cmd of expectedCommands) {
      expect(registeredCommands).toContain(cmd)
    }
  })
})
