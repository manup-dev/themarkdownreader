import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Verify the deployed GitHub Pages build renders mermaid blocks correctly.
 *
 * Runs against the LIVE site, NOT the local preview server. We override the
 * baseURL inline so the existing local webServer config is unaffected.
 */

const LIVE_URL = 'https://manup-dev.github.io/themarkdownreader/'

test('live github.io — mermaid block in a harness file renders as SVG', async ({ browser }) => {
  test.setTimeout(60_000)
  const md = fs.readFileSync(path.join(process.cwd(), 'e2e', 'fixtures', 'harness', '00-overview.md'), 'utf-8')

  const context = await browser.newContext({ baseURL: LIVE_URL })
  const page = await context.newPage()
  await page.setViewportSize({ width: 1400, height: 1000 })
  await page.goto(LIVE_URL)
  await page.waitForLoadState('networkidle')

  await page.evaluate((md) => {
    window.postMessage({ type: 'md-reader-load', markdown: md, fileName: '00-overview.md' }, '*')
  }, md)

  await page.getByRole('button', { name: /no thanks/i }).click({ timeout: 3000 }).catch(() => {})

  const diagram = page.getByTestId('mermaid-diagram').first()
  await expect(diagram, 'mermaid container shows').toBeVisible({ timeout: 20_000 })
  await diagram.scrollIntoViewIfNeeded()
  const svg = diagram.locator('svg')
  await expect(svg, 'SVG renders inside the container').toBeVisible({ timeout: 20_000 })

  const bbox = await svg.boundingBox()
  expect(bbox).not.toBeNull()
  expect(bbox!.width).toBeGreaterThan(100)
  expect(bbox!.height).toBeGreaterThan(100)

  // Diagram must contain the source's actual node text
  await expect(svg).toContainText('md-reader CLI')

  await page.screenshot({ path: 'mermaid-live-proof.png', fullPage: false })
  await context.close()
})
