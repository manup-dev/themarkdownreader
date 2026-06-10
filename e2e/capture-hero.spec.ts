import { test } from '@playwright/test'

// Records the 15s hero loop as video (storyboard:
// docs/launch/hero-gif-storyboard.md). Convert to GIF with the ffmpeg
// command at the bottom of this file. NOT part of the regular suite —
// run explicitly: npx playwright test e2e/capture-hero.spec.ts
test.use({
  viewport: { width: 1280, height: 760 },
  video: { mode: 'on', size: { width: 1280, height: 760 } },
})

test('hero loop capture', async ({ page }) => {
  await page.goto('/?demo=true')
  await page.getByRole('button', { name: 'Skip tour' }).click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(1500)                       // beat 1: reader view

  await page.locator('[data-view-tabs]').getByRole('button', { name: 'Mind Map', exact: true }).click()
  await page.waitForTimeout(2500)                       // beat 2: mind map blooms

  await page.locator('[data-view-tabs]').getByRole('button', { name: 'Read', exact: true }).click()
  await page.waitForTimeout(800)

  // beat 3: select the practice passage → selection menu appears
  const passage = page.locator('blockquote', { hasText: 'authentication middleware' })
  await passage.scrollIntoViewIfNeeded()
  const box = await passage.boundingBox()
  if (box) {
    await page.mouse.move(box.x + 4, box.y + 4)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 8, box.y + box.height - 8, { steps: 24 })
    await page.mouse.up()
  }
  await page.waitForTimeout(2500)                       // beat 4: hold on the Ship-it menu
})

// Convert (≤8MB, 480px-readable, first≈last frame for clean loop):
// ffmpeg -i test-results/**/video.webm -vf "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" -loop 0 docs/launch/hero.gif
