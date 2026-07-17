import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Post-deploy verification: hit the LIVE github.io URL and confirm
 *   1. the marketing landing page serves
 *   2. mermaid blocks still render as SVG
 *   3. .excalidraw uploads route to the Excalidraw viewer
 *
 * NOT part of the default test suite — invoked explicitly post-deploy.
 */

const LIVE = 'https://manup-dev.github.io/themarkdownreader/'

test.describe('Live github.io deploy verification', () => {
  test.setTimeout(60_000)

  test('launch.html serves and renders', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const res = await page.goto(`${LIVE}launch.html`)
    expect(res?.status(), 'launch.html status').toBe(200)
    await page.waitForLoadState('networkidle')

    await expect(page.locator('.hero-title')).toBeVisible()
    const ctas = page.getByRole('link', { name: /Try it in your browser/i })
    expect(await ctas.count()).toBeGreaterThanOrEqual(1)
    expect(await ctas.first().getAttribute('href')).toMatch(/\?demo=true/)
    await ctx.close()
  })

  test('mermaid harness file still renders as SVG', async ({ browser }) => {
    const md = fs.readFileSync(path.join(process.cwd(), 'e2e', 'fixtures', 'harness', '00-overview.md'), 'utf-8')
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.setViewportSize({ width: 1400, height: 1000 })
    await page.goto(LIVE)
    await page.waitForLoadState('networkidle')

    await page.evaluate((md) => {
      window.postMessage({ type: 'md-reader-load', markdown: md, fileName: '00-overview.md' }, '*')
    }, md)

    await page.getByRole('button', { name: /no thanks/i }).click({ timeout: 3000 }).catch(() => {})

    const diagram = page.getByTestId('mermaid-diagram').first()
    await expect(diagram).toBeVisible({ timeout: 20_000 })
    await diagram.scrollIntoViewIfNeeded()
    const svg = diagram.locator('svg')
    await expect(svg).toBeVisible({ timeout: 15_000 })
    await expect(svg).toContainText('md-reader CLI')
    const bbox = await svg.boundingBox()
    expect(bbox).not.toBeNull()
    expect(bbox!.width).toBeGreaterThan(100)
    await ctx.close()
  })

  test('.excalidraw upload routes to Excalidraw viewer (not Reader)', async ({ browser }) => {
    const sample = path.resolve('e2e/fixtures/test-diagram.excalidraw')
    expect(fs.existsSync(sample)).toBe(true)

    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(LIVE)
    await page.waitForLoadState('networkidle')

    await page.locator('input[type=file]').first().setInputFiles(sample)

    const loader = page.getByText(/Loading Excalidraw/)
    const canvas = page.locator('.excalidraw, [class*="excalidraw"]').first()
    await expect(loader.or(canvas)).toBeVisible({ timeout: 20_000 })
    await expect(canvas).toBeVisible({ timeout: 25_000 })
    await expect(page.locator('.prose').first()).not.toBeVisible()
    await ctx.close()
  })
})
