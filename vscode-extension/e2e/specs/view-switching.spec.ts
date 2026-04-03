import { browser } from '@wdio/globals'
import { readerWebview } from '../pageobjects/ReaderWebview.js'

describe('View Switching', () => {
  before(async () => {
    await browser.executeWorkbench(async (vscode) => {
      const files = await vscode.workspace.findFiles('test.md')
      if (files.length > 0) {
        const doc = await vscode.workspace.openTextDocument(files[0])
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One)
      }
      await vscode.commands.executeCommand('md-reader.openReader')
    })
    await browser.pause(3000)
    await readerWebview.switchToWebview()
    await readerWebview.waitForContent()
  })

  after(async () => {
    await readerWebview.switchToMain()
  })

  it('should start in Read view', async () => {
    const mode = await readerWebview.getActiveViewMode()
    expect(mode).toBe('read')
  })

  it('should switch to Mind Map view', async () => {
    await readerWebview.switchView('Mind Map')
    await browser.pause(2000)

    // Markmap renders an SVG
    const svgs = await $$('svg')
    expect(svgs.length).toBeGreaterThanOrEqual(1)
  })

  it('should switch to Cards view', async () => {
    await readerWebview.switchView('Cards')
    await browser.pause(2000)

    const mode = await readerWebview.getActiveViewMode()
    expect(mode).toBe('cards')
  })

  it('should switch back to Read view', async () => {
    await readerWebview.switchView('Read')
    await browser.pause(1000)

    const mode = await readerWebview.getActiveViewMode()
    expect(mode).toBe('read')

    const headings = await readerWebview.getHeadingTexts()
    expect(headings).toContain('Test Document')
  })
})

describe('View Switching via Commands', () => {
  // Separate describe with fresh setup to avoid frame context issues
  before(async () => {
    await browser.executeWorkbench(async (vscode) => {
      const files = await vscode.workspace.findFiles('test.md')
      if (files.length > 0) {
        const doc = await vscode.workspace.openTextDocument(files[0])
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One)
      }
      // Open as mindmap directly via command
      await vscode.commands.executeCommand('md-reader.openMindMap')
    })
    await browser.pause(3000)
  })

  it('should open Mind Map view via command', async () => {
    await readerWebview.switchToWebview()

    await browser.waitUntil(
      async () => {
        const mode = await readerWebview.getActiveViewMode()
        return mode === 'mind-map'
      },
      { timeout: 10_000, timeoutMsg: 'Mind Map view did not open via command' },
    )

    await readerWebview.switchToMain()
  })
})
