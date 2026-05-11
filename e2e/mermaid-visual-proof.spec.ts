import { test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * One-off visual proof: load a real harness markdown file and capture a
 * full-page screenshot showing the mermaid diagrams rendered inline.
 */

test('visual proof — 00-overview.md mermaid renders inline', async ({ page }) => {
  test.setTimeout(60_000)
  const md = fs.readFileSync(path.join('/home/manu/Desktop/learn/harness', '00-overview.md'), 'utf-8')

  await page.setViewportSize({ width: 1400, height: 1000 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.evaluate((md) => {
    window.postMessage({ type: 'md-reader-load', markdown: md, fileName: '00-overview.md' }, '*')
  }, md)

  // Dismiss the analytics popup if present
  await page.getByRole('button', { name: /no thanks/i }).click({ timeout: 3000 }).catch(() => {})

  const diagram = page.getByTestId('mermaid-diagram').first()
  await diagram.scrollIntoViewIfNeeded()
  await diagram.locator('svg').waitFor({ state: 'visible', timeout: 15_000 })

  await page.screenshot({ path: 'mermaid-harness-proof.png', fullPage: false })
})
