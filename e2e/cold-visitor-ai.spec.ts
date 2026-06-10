import { test, expect } from '@playwright/test'

// Headless Chromium has no WebGPU and no Ollama → detection lands on 'none',
// exactly like a Safari/Firefox/mobile PH visitor. The app must offer a
// recovery path, not a dead "No AI backend available" message.
test('cold visitor with no AI backend gets a guided setup path', async ({ page }) => {
  await page.goto('/?demo=true')
  await page.getByRole('button', { name: 'Skip tour' }).click()

  // Open the chat panel via the tools FAB
  await page.getByRole('button', { name: 'Tools menu' }).click()
  await page.getByRole('button', { name: 'Chat with document' }).click()

  // The recovery CTA replaces the dead-end text
  const cta = page.getByRole('button', { name: /free cloud AI/i })
  await expect(cta).toBeVisible()

  // Clicking it opens AI Settings with the OpenRouter key field
  await cta.click()
  await expect(page.getByPlaceholder(/sk-or-/i)).toBeVisible()
})

test('Coach view shows the same setup prompt instead of a vague error', async ({ page }) => {
  await page.goto('/?demo=true')
  await page.getByRole('button', { name: 'Skip tour' }).click()
  await page.getByRole('button', { name: /^Coach/ }).click()
  await expect(page.getByRole('button', { name: /free cloud AI/i })).toBeVisible()
})
