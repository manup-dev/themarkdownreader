import { browser } from '@wdio/globals'

/**
 * Page object for interacting with the md-reader webview panel.
 * Handles iframe switching and element queries inside the webview.
 */
export class ReaderWebview {
  /**
   * Switch into the md-reader webview iframe.
   * Must be called before interacting with webview DOM elements.
   */
  async switchToWebview(): Promise<void> {
    const workbench = await browser.getWorkbench()
    await browser.waitUntil(
      async () => {
        const webviews = await workbench.getAllWebviews()
        return webviews.length > 0
      },
      { timeout: 15_000, timeoutMsg: 'Webview did not appear within 15s' },
    )
    const webviews = await workbench.getAllWebviews()
    const webview = webviews[0]
    await webview.open()
  }

  /**
   * Switch back out of the webview iframe to the main VS Code frame.
   */
  async switchToMain(): Promise<void> {
    await browser.switchFrame(null)
  }

  /**
   * Wait for markdown content to render inside the webview.
   */
  async waitForContent(timeout = 10_000): Promise<void> {
    await browser.waitUntil(
      async () => {
        const h1 = await $('h1')
        if (await h1.isExisting()) return true
        const content = await $('#content')
        if (await content.isExisting() && await content.isDisplayed()) return true
        return false
      },
      { timeout, timeoutMsg: `Webview content did not render within ${timeout}ms` },
    )
  }

  /**
   * Get all visible heading texts from the rendered markdown.
   */
  async getHeadingTexts(): Promise<string[]> {
    // Query headings inside the main content area (skip TOC sidebar headings)
    const headings = await $$('article h1, article h2, article h3, article h4, article h5, article h6, .prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6')
    const texts: string[] = []
    for (const h of headings) {
      let text = await h.getText()
      if (text) {
        // Strip leading # characters that may be included in the text
        text = text.replace(/^#+\s*/, '')
        texts.push(text)
      }
    }
    return texts
  }

  /**
   * Get the full visible text content of the reader.
   */
  async getRenderedText(): Promise<string> {
    const body = await $('body')
    return body.getText()
  }

  /**
   * Get the current view mode by checking which tab is active.
   */
  async getActiveViewMode(): Promise<string> {
    const buttons = await $$('button')
    for (const btn of buttons) {
      const classes = await btn.getAttribute('class')
      const text = await btn.getText()
      if (classes?.includes('bg-blue-100') || classes?.includes('bg-blue-950')) {
        return text.toLowerCase().replace(/\s+/g, '-')
      }
    }
    return 'unknown'
  }

  /**
   * Click a view mode tab by its label text.
   */
  async switchView(label: string): Promise<void> {
    const buttons = await $$('button')
    for (const btn of buttons) {
      const text = await btn.getText()
      if (text?.toLowerCase() === label.toLowerCase()) {
        await btn.click()
        return
      }
    }
    throw new Error(`View tab "${label}" not found`)
  }
}

export const readerWebview = new ReaderWebview()
