import { browser } from '@wdio/globals'
import { readerWebview } from '../pageobjects/ReaderWebview.js'

describe('Open Reader (cmd+shift+r)', () => {
  before(async () => {
    // Open test.md and ensure it's the active editor
    await browser.executeWorkbench(async (vscode) => {
      const files = await vscode.workspace.findFiles('test.md')
      if (files.length > 0) {
        const doc = await vscode.workspace.openTextDocument(files[0])
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One)
      }
    })
    await browser.pause(1000)
  })

  it('should open reading view for the active markdown file', async () => {
    await browser.executeWorkbench(async (vscode) => {
      await vscode.commands.executeCommand('md-reader.openReader')
    })

    await browser.pause(3000)

    await readerWebview.switchToWebview()
    await readerWebview.waitForContent()

    const headings = await readerWebview.getHeadingTexts()
    expect(headings).toContain('Test Document')

    await readerWebview.switchToMain()
  })

  it('should show content from the correct file, not a stale file', async () => {
    await readerWebview.switchToWebview()
    const text = await readerWebview.getRenderedText()
    expect(text).toContain('Lorem ipsum dolor sit amet')
    expect(text).toContain('Section Two')
    await readerWebview.switchToMain()
  })

  it('should reuse existing panel on second invocation', async () => {
    await browser.executeWorkbench(async (vscode) => {
      await vscode.commands.executeCommand('md-reader.openReader')
    })
    await browser.pause(1000)

    await readerWebview.switchToWebview()
    const headings = await readerWebview.getHeadingTexts()
    expect(headings).toContain('Test Document')
    await readerWebview.switchToMain()
  })
})
