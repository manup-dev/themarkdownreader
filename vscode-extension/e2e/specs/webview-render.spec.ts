import { browser } from '@wdio/globals'
import { readerWebview } from '../pageobjects/ReaderWebview.js'

describe('Webview Rendering', () => {
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

  it('should render headings from the markdown file', async () => {
    const headings = await readerWebview.getHeadingTexts()
    expect(headings).toContain('Test Document')
    expect(headings).toContain('Section One')
    expect(headings).toContain('Section Two')
    expect(headings).toContain('Section Three')
  })

  it('should render code blocks', async () => {
    const codeBlocks = await $$('pre code')
    expect(codeBlocks.length).toBeGreaterThanOrEqual(1)

    const codeText = await codeBlocks[0].getText()
    expect(codeText).toContain('Hello, world!')
  })

  it('should render list items', async () => {
    const listItems = await $$('li')
    const texts: string[] = []
    for (const li of listItems) {
      texts.push(await li.getText())
    }
    expect(texts).toContain('Item one')
    expect(texts).toContain('Item two')
    expect(texts).toContain('Item three')
  })

  it('should render blockquotes', async () => {
    const blockquotes = await $$('blockquote')
    expect(blockquotes.length).toBeGreaterThanOrEqual(1)
    const text = await blockquotes[0].getText()
    expect(text).toContain('This is a blockquote')
  })

  it('should render tables', async () => {
    const tables = await $$('table')
    expect(tables.length).toBeGreaterThanOrEqual(1)

    const cells = await $$('td')
    const cellTexts: string[] = []
    for (const cell of cells) {
      cellTexts.push(await cell.getText())
    }
    expect(cellTexts).toContain('Cell 1')
    expect(cellTexts).toContain('Cell 2')
  })

  it('should render inline formatting', async () => {
    const text = await readerWebview.getRenderedText()
    expect(text).toContain('bold')
    expect(text).toContain('italic')
    expect(text).toContain('inline code')
  })
})
