import { browser } from '@wdio/globals'
import { readerWebview } from '../pageobjects/ReaderWebview.js'

describe('Theme, Layout & TTS', () => {
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

  describe('Layout', () => {
    it('should fill the entire webview panel height', async () => {
      const root = await $('#root')
      const rootHeight = await root.getSize('height')
      expect(rootHeight).toBeGreaterThan(200)

      const outerDiv = await root.$('.flex.h-screen')
      if (await outerDiv.isExisting()) {
        const divHeight = await outerDiv.getSize('height')
        expect(divHeight).toBeGreaterThanOrEqual(rootHeight - 5)
      }
    })
  })

  describe('Theme', () => {
    it('should have all four theme buttons', async () => {
      const buttons = await $$('button[title]')
      const titles: string[] = []
      for (const btn of buttons) {
        const title = await btn.getAttribute('title')
        if (title) titles.push(title)
      }
      expect(titles).toContain('Light theme')
      expect(titles).toContain('Dark theme')
      expect(titles).toContain('Sepia theme')
      expect(titles).toContain('High Contrast theme')
    })

    it('should apply dark class when dark theme clicked', async () => {
      const darkBtn = await $('button[title="Dark theme"]')
      await darkBtn.click()
      await browser.pause(500)

      const html = await $('html')
      const classes = await html.getAttribute('class')
      expect(classes).toContain('dark')
    })

    it('should apply sepia class when sepia theme clicked', async () => {
      const sepiaBtn = await $('button[title="Sepia theme"]')
      await sepiaBtn.click()
      await browser.pause(500)

      const html = await $('html')
      const classes = await html.getAttribute('class')
      expect(classes).toContain('sepia')
    })

    it('should revert to light theme', async () => {
      const lightBtn = await $('button[title="Light theme"]')
      await lightBtn.click()
      await browser.pause(500)

      const html = await $('html')
      const classes = await html.getAttribute('class')
      expect(classes || '').not.toContain('dark')
      expect(classes || '').not.toContain('sepia')
    })
  })

  describe('TTS Player', () => {
    it('should show TTS player when Read Aloud button exists', async () => {
      const ttsBtn = await $('[data-tts-player]')
      expect(await ttsBtn.isExisting()).toBe(true)
    })
  })
})
