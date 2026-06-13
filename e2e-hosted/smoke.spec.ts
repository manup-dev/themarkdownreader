import { test, expect } from '@playwright/test'

const HOSTED_URL =
  process.env.HOSTED_URL ?? 'https://manup-dev.github.io/themarkdownreader/?demo=true'

const NOISY_ERROR_PATTERNS = [
  /ResizeObserver loop/i,
  /WebGPU/i,
  /webllm/i,
  /Failed to load resource.*model/i,
  /huggingface/i,
  /ollama/i,
  /openrouter/i,
  /AbortError/i,
]

function captureConsoleErrors(page: import('@playwright/test').Page) {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return {
    realErrors: () =>
      errors.filter((e) => !NOISY_ERROR_PATTERNS.some((p) => p.test(e))),
  }
}

test.describe('Hosted demo smoke tests', () => {
  test('page loads without fatal errors', async ({ page }) => {
    const probe = captureConsoleErrors(page)

    const response = await page.goto(HOSTED_URL, { waitUntil: 'networkidle' })
    expect(response?.status(), 'HTTP status').toBeLessThan(400)

    await expect(page).toHaveTitle(/md-reader/i)

    const errors = probe.realErrors()
    expect(
      errors,
      `Unexpected console errors:\n  - ${errors.join('\n  - ')}`,
    ).toHaveLength(0)
  })

  test('demo content renders with headings', async ({ page }) => {
    await page.goto(HOSTED_URL, { waitUntil: 'networkidle' })

    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 })
  })

  test('table of contents shows section links', async ({ page }) => {
    await page.goto(HOSTED_URL, { waitUntil: 'networkidle' })

    // The document outline (TOC) renders section links as <button>s inside
    // <nav aria-label="Document outline">, not <a> anchors.
    const tocLink = page
      .locator('nav[aria-label="Document outline" i] button, aside button')
      .first()
    await expect(tocLink).toBeVisible({ timeout: 5_000 })
  })

  test('theme toggle changes html class', async ({ page }) => {
    await page.goto(HOSTED_URL, { waitUntil: 'networkidle' })

    const before = (await page.locator('html').getAttribute('class')) ?? ''
    const beforeStyle = (await page.locator('html').getAttribute('style')) ?? ''
    const beforeTheme = (await page.locator('html').getAttribute('data-theme')) ?? ''

    await page.keyboard.press('t')
    await page.waitForTimeout(400)

    const after = (await page.locator('html').getAttribute('class')) ?? ''
    const afterStyle = (await page.locator('html').getAttribute('style')) ?? ''
    const afterTheme = (await page.locator('html').getAttribute('data-theme')) ?? ''

    const changed =
      before !== after || beforeStyle !== afterStyle || beforeTheme !== afterTheme
    expect(changed, 'theme should change after pressing "t"').toBe(true)
  })

  test('command palette opens on Ctrl+K', async ({ page }) => {
    await page.goto(HOSTED_URL, { waitUntil: 'networkidle' })

    await page.keyboard.press('Control+k')

    const palette = page.locator('[role="dialog"], [role="combobox"], [role="listbox"]').first()
    await expect(palette).toBeVisible({ timeout: 3_000 })
  })

  test('keyboard help opens on ?', async ({ page }) => {
    await page.goto(HOSTED_URL, { waitUntil: 'networkidle' })

    // Press '?' directly. `press('Shift+/')` delivers key='/' (with
    // shiftKey), which triggers the '/' search shortcut in read view, not
    // the '?' help shortcut — so it must be pressed as the literal char.
    await page.keyboard.press('?')
    await page.waitForTimeout(300)

    const help = page.getByText(/keyboard|shortcut/i).first()
    await expect(help).toBeVisible({ timeout: 3_000 })
  })

  test('mindmap view renders an SVG via Ctrl+2', async ({ page }) => {
    await page.goto(HOSTED_URL, { waitUntil: 'networkidle' })

    await page.keyboard.press('Control+2')

    const svg = page.locator('svg').first()
    await expect(svg).toBeVisible({ timeout: 8_000 })
  })

  test('renders at mobile viewport without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(HOSTED_URL, { waitUntil: 'networkidle' })

    await expect(page.locator('h1, h2').first()).toBeVisible()

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(
      scrollWidth - clientWidth,
      'no horizontal overflow at mobile width',
    ).toBeLessThanOrEqual(2)
  })

  test('main bundle responds within a reasonable time', async ({ page }) => {
    const start = Date.now()
    await page.goto(HOSTED_URL, { waitUntil: 'domcontentloaded' })
    const ttfb = Date.now() - start
    expect(ttfb, 'DOMContentLoaded under 10s from CI runner').toBeLessThan(10_000)
  })
})
