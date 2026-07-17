import { test, expect, type Page } from '@playwright/test'

// Simulate a visitor with genuinely no AI backend available — no WebGPU, no
// reachable Ollama — exactly like a Safari/Firefox/mobile PH visitor. The app
// must offer a recovery path, not a dead "No AI backend available" message.
//
// Relying on the *execution environment* to naturally lack WebGPU/Ollama is
// unreliable: a dev machine with a local Ollama container makes backend
// detection resolve to 'ollama', and modern headless Chromium (especially
// `playwright install --with-deps`, which pulls in software rendering libs)
// can report WebGPU as available via a software adapter — both silently skip
// this test's "no backend" scenario instead of failing loudly. Force the
// cold-visitor condition deterministically instead of hoping the host lacks
// these capabilities.
//
// `serviceWorkers: 'block'` (set per-test below) is required for the Ollama
// route mock to actually take effect: this app registers a service worker
// (src/main.tsx) that, once active, intercepts fetch() calls — including
// the cross-origin ${OLLAMA_BASE_URL}/api/tags health check — at a layer
// below page.route(), letting the request reach the real network (and a
// real dev-machine Ollama container) regardless of the mock. Blocking
// service workers keeps the health-check fetch on the page's normal
// network path where page.route() can reliably intercept it.
async function simulateNoAiBackend(page: Page) {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true })
    } catch {
      // Some Chromium builds may expose `gpu` as a non-configurable own
      // property; fall back to a prototype-level override so the app's
      // `!navigator.gpu` check still sees it as absent either way.
      try {
        Object.defineProperty(Object.getPrototypeOf(navigator), 'gpu', { get: () => undefined, configurable: true })
      } catch { /* best-effort — checkWebGPU() also races a 2s timeout as a backstop */ }
    }
  })
  await page.route(/\/api\/tags(\?|$)/, (route) => route.abort())
}

test.use({ serviceWorkers: 'block' })

test('cold visitor with no AI backend gets a guided setup path', async ({ page }) => {
  await simulateNoAiBackend(page)
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
  await simulateNoAiBackend(page)
  await page.goto('/?demo=true')
  await page.getByRole('button', { name: 'Skip tour' }).click()
  await page.getByRole('button', { name: /^Coach/ }).click()
  await expect(page.getByRole('button', { name: /free cloud AI/i })).toBeVisible()
})
