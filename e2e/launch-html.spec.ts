import { test, expect } from '@playwright/test'

test.describe('Launch landing page', () => {
  test('serves with 200, no console errors, key assets resolve', async ({ page }) => {
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.url()} (${req.failure()?.errorText})`)
    })

    const response = await page.goto('/launch.html')
    expect(response?.status(), 'HTTP status').toBe(200)
    await page.waitForLoadState('networkidle')

    // Hero text must render
    await expect(page.locator('.hero-title')).toBeVisible()
    await expect(page.getByText(/podcast, mind map, or tutor/i)).toBeVisible()

    // CTAs must be present and link to the app (page has hero + footer CTAs)
    const ctas = page.getByRole('link', { name: /Try it in your browser/i })
    await expect(ctas.first()).toBeVisible()
    expect(await ctas.count(), 'expected 2 CTAs (hero + footer)').toBeGreaterThanOrEqual(1)
    expect(await ctas.first().getAttribute('href')).toMatch(/\?demo=true/)

    // og-card.png and favicon.svg referenced — make sure they exist
    const ogResponse = await page.request.get('/og-card.png')
    expect(ogResponse.status(), '/og-card.png status').toBeLessThan(400)
    const favResponse = await page.request.get('/favicon.svg')
    expect(favResponse.status(), '/favicon.svg status').toBeLessThan(400)

    // Page should not log console errors or hit network failures
    expect(consoleErrors, 'console errors').toEqual([])
    expect(failedRequests, 'failed requests').toEqual([])

    await page.screenshot({ path: 'launch-html.png', fullPage: false })
  })
})
