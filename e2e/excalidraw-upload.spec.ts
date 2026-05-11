import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Excalidraw upload + viewer integration test.
 *
 * Validates the uncommitted changes in:
 *   - src/components/Upload.tsx     (accept .excalidraw files)
 *   - src/App.tsx                   (route .excalidraw to ExcalidrawViewer)
 *   - src/components/ExcalidrawViewer.tsx
 *   - src/lib/remark-excalidraw.ts
 */

const SAMPLE = path.resolve('.playwright-mcp/test-diagram.excalidraw')

test.describe('Excalidraw integration', () => {
  test.setTimeout(60_000)

  test('accept-attribute on the file input includes .excalidraw', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const accept = await page.locator('input[type=file]').first().getAttribute('accept')
    expect(accept, 'file input accept attribute').toContain('.excalidraw')
  })

  test('rejects unsupported extensions with the updated error', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Stub a fake file via the input (something with a known-bad extension)
    const fileInput = page.locator('input[type=file]').first()
    await fileInput.setInputFiles({
      name: 'bogus.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('not a markdown file'),
    })

    await expect(page.getByText(/upload a .md, .markdown, .txt, or .excalidraw file/)).toBeVisible({ timeout: 5000 })
  })

  test('uploads an .excalidraw file and renders the Excalidraw viewer', async ({ page }) => {
    expect(fs.existsSync(SAMPLE), `sample fixture missing: ${SAMPLE}`).toBe(true)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const fileInput = page.locator('input[type=file]').first()
    await fileInput.setInputFiles(SAMPLE)

    // ExcalidrawViewer first shows a loader "Loading Excalidraw..." until the
    // dynamic import resolves; then the actual canvas (an Excalidraw <div>)
    // appears. We just need to assert *some* form of the viewer is mounted —
    // and crucially that the Reader / Markdown path is NOT used.
    const loader = page.getByText(/Loading Excalidraw/)
    const canvas = page.locator('.excalidraw, [class*="excalidraw"]').first()

    // Either we see the loader, or the canvas itself, within a few seconds.
    await expect(loader.or(canvas)).toBeVisible({ timeout: 15_000 })

    // Wait for the actual Excalidraw canvas to mount.
    await expect(canvas).toBeVisible({ timeout: 25_000 })

    // Assert the markdown Reader DID NOT render (since .excalidraw routes elsewhere)
    const readerProse = page.locator('.prose').first()
    await expect(readerProse).not.toBeVisible()

    await page.screenshot({ path: 'excalidraw-uploaded.png', fullPage: false })
  })
})
