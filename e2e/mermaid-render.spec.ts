import { test, expect } from '@playwright/test'

/**
 * Verify that fenced ```mermaid blocks render as SVG diagrams in the Reader.
 *
 * Run: npx playwright test e2e/mermaid-render.spec.ts
 */

const MERMAID_DOC = `# Diagram Render Test

This document embeds a Mermaid diagram. The reader must render it as SVG, not
as a code block.

\`\`\`mermaid
flowchart TB
    A[Start] --> B{Decision}
    B -- yes --> C[Render SVG]
    B -- no --> D[Show code]
\`\`\`

Trailing prose so the diagram has surrounding context.
`

test.describe('Mermaid diagram rendering', () => {
  test.setTimeout(60_000)

  test('renders fenced ```mermaid block as inline SVG', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Push the markdown into the app via the postMessage protocol the app already supports.
    await page.evaluate((md) => {
      window.postMessage({ type: 'md-reader-load', markdown: md, fileName: 'mermaid.md' }, '*')
    }, MERMAID_DOC)

    // Wait for the diagram container to appear, then for an <svg> inside it.
    const diagram = page.getByTestId('mermaid-diagram')
    await expect(diagram).toBeVisible({ timeout: 15_000 })
    const svg = diagram.locator('svg')
    await expect(svg).toBeVisible({ timeout: 15_000 })

    // SVG must contain the decision node text from our diagram source.
    await expect(svg).toContainText('Decision')

    // Sanity check: the raw mermaid source must NOT be rendered as a visible code block.
    // We assert the diagram surface dominates by checking the SVG has non-zero bounding box.
    const bbox = await svg.boundingBox()
    expect(bbox).not.toBeNull()
    expect(bbox!.width).toBeGreaterThan(50)
    expect(bbox!.height).toBeGreaterThan(50)

    await page.screenshot({ path: 'mermaid-rendered.png', fullPage: false })
  })

  test('falls back gracefully on invalid mermaid syntax', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const badDoc = '# Bad\n\n```mermaid\nthis is not valid mermaid\n```\n'
    await page.evaluate((md) => {
      window.postMessage({ type: 'md-reader-load', markdown: md, fileName: 'bad.md' }, '*')
    }, badDoc)

    // Either a diagram surface shows (mermaid sometimes still renders an error SVG)
    // or our explicit error fallback shows. Both are acceptable — the page must not crash.
    const errorFallback = page.getByText('Diagram failed to render')
    const diagram = page.getByTestId('mermaid-diagram')
    await expect(errorFallback.or(diagram).first()).toBeVisible({ timeout: 15_000 })
  })
})
