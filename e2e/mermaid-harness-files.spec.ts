import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Load the actual harness markdown files from /home/manu/Desktop/learn/harness
 * one by one, and verify each mermaid block becomes an SVG with non-zero size.
 *
 * Run: npx playwright test e2e/mermaid-harness-files.spec.ts
 */

const HARNESS_DIR = '/home/manu/Desktop/learn/harness'

function listMermaidFiles(): string[] {
  return fs.readdirSync(HARNESS_DIR)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => fs.readFileSync(path.join(HARNESS_DIR, f), 'utf-8').includes('```mermaid'))
    .sort()
}

function countMermaidBlocks(md: string): number {
  return (md.match(/```mermaid/g) ?? []).length
}

test.describe('Mermaid blocks in real harness files', () => {
  test.setTimeout(60_000)

  for (const file of listMermaidFiles()) {
    test(`${file} — all mermaid blocks render as SVG`, async ({ page }) => {
      const full = path.join(HARNESS_DIR, file)
      const md = fs.readFileSync(full, 'utf-8')
      const expectedBlocks = countMermaidBlocks(md)
      expect(expectedBlocks, 'pre-condition: at least one mermaid block').toBeGreaterThan(0)

      await page.goto('/')
      await page.waitForLoadState('networkidle')

      await page.evaluate(({ md, fileName }) => {
        window.postMessage({ type: 'md-reader-load', markdown: md, fileName }, '*')
      }, { md, fileName: file })

      // Wait until every mermaid block is rendered.
      const diagrams = page.getByTestId('mermaid-diagram')
      await expect.poll(async () => await diagrams.count(), {
        timeout: 20_000,
        message: `expected ${expectedBlocks} mermaid diagrams`,
      }).toBe(expectedBlocks)

      // Wait for every block to finish loading (state attribute set to ok or error).
      await expect.poll(async () => {
        return await diagrams.evaluateAll((els) =>
          els.every((el) => (el as HTMLElement).dataset.mermaidState),
        )
      }, { timeout: 20_000, message: 'all diagrams settled' }).toBe(true)

      // App contract:
      //   - Every block must settle (no infinite spinner).
      //   - Valid blocks render an SVG with non-zero size.
      //   - Invalid blocks (author syntax errors) show the parse-error fallback
      //     with the raw source — never a blank container.
      const states = await diagrams.evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.mermaidState),
      )

      // At least one diagram on the page should render — otherwise something is
      // wrong globally (e.g. mermaid failed to load at all).
      expect(states.filter((s) => s === 'ok').length, `${file}: at least one diagram renders`).toBeGreaterThan(0)

      const count = await diagrams.count()
      for (let i = 0; i < count; i++) {
        await diagrams.nth(i).scrollIntoViewIfNeeded()
        const state = states[i]
        if (state === 'ok') {
          const svg = diagrams.nth(i).locator('svg')
          await expect(svg, `diagram ${i + 1} in ${file}`).toBeVisible({ timeout: 10_000 })
          const bbox = await svg.boundingBox()
          expect(bbox, `diagram ${i + 1} bbox in ${file}`).not.toBeNull()
          expect(bbox!.width, `diagram ${i + 1} width in ${file}`).toBeGreaterThan(50)
          expect(bbox!.height, `diagram ${i + 1} height in ${file}`).toBeGreaterThan(20)
        } else {
          // Error fallback path — the message and raw code must both be visible.
          const errorText = diagrams.nth(i).getByText(/Diagram failed to render/)
          await expect(errorText, `error fallback for diagram ${i + 1} in ${file}`).toBeVisible()
          const sourceCode = diagrams.nth(i).locator('pre code')
          await expect(sourceCode, `raw source visible for diagram ${i + 1} in ${file}`).toBeVisible()
        }
      }

      // Make sure the page also did NOT render the raw mermaid source as visible
      // pre-formatted text in addition (would mean both code + svg shown).
      const rawSourceMatches = await page.locator('code.language-mermaid').count()
      expect(rawSourceMatches, `should not also render raw mermaid <code> in ${file}`).toBe(0)
    })
  }
})
