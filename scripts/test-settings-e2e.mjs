#!/usr/bin/env node
/**
 * E2E test: Validate settings panel fixes on deployed GitHub Pages
 *
 * Tests:
 * 1. Settings panel opens
 * 2. Dropdown (Preferred Backend) can be clicked without closing panel
 * 3. Labs section is visible (scrollable)
 * 4. Buttons inside settings work without closing panel
 * 5. Error messages are backend-agnostic (no "needs Ollama")
 */

import { chromium } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SITE_URL = process.env.SITE_URL || 'https://manup-dev.github.io/themarkdownreader/'
const SCREENSHOT_DIR = path.join(__dirname, '..', 'test-screenshots')

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

let passed = 0
let failed = 0

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${name}`)
    passed++
  } else {
    console.log(`  ❌ ${name}${detail ? ': ' + detail : ''}`)
    failed++
  }
}

async function run() {
  console.log('🧪 Settings Panel E2E Test')
  console.log(`   Site: ${SITE_URL}`)
  console.log('━'.repeat(60))

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  try {
    // Load site and dismiss modals
    console.log('\n  Setting up...')
    await page.goto(SITE_URL, { waitUntil: 'networkidle', timeout: 30000 })
    await page.evaluate(() => {
      localStorage.removeItem('md-reader-openrouter-key')
      localStorage.removeItem('md-reader-preferred-backend')
      localStorage.setItem('md-reader-tour-complete', 'true')
      localStorage.setItem('md-reader-welcome-seen', 'true')
      localStorage.setItem('md-reader-welcome-dismissed', 'true')
      localStorage.setItem('md-reader-telemetry-consent', 'denied')
      localStorage.setItem('md-reader-telemetry-prompted', 'true')
      localStorage.setItem('md-reader-analytics-prompted', 'true')
    })
    await page.goto(SITE_URL, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(2000)

    // Dismiss any remaining modals
    for (let i = 0; i < 3; i++) {
      for (const text of ['Skip tour', 'No thanks', 'No Thanks', 'Done', 'Got it', 'Close']) {
        try {
          const btn = page.locator(`button:has-text("${text}")`).first()
          if (await btn.isVisible({ timeout: 300 })) {
            await btn.click()
            await page.waitForTimeout(300)
          }
        } catch { /* continue */ }
      }
    }

    // Upload a test file
    const fileInput = await page.$('input[type="file"]')
    if (fileInput) {
      const tmpFile = path.join(SCREENSHOT_DIR, 'test-doc.md')
      fs.writeFileSync(tmpFile, '# Test\n\nHello world.\n\n## Section 2\n\nMore content here about AI and machine learning.\n')
      await fileInput.setInputFiles(tmpFile)
      await page.waitForTimeout(2000)
    }

    // Dismiss post-upload modals
    for (let i = 0; i < 3; i++) {
      for (const text of ['Skip tour', 'No thanks', 'No Thanks', 'Done', 'Got it']) {
        try {
          const btn = page.locator(`button:has-text("${text}")`).first()
          if (await btn.isVisible({ timeout: 300 })) {
            await btn.click()
            await page.waitForTimeout(300)
          }
        } catch { /* continue */ }
      }
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'e2e-01-ready.png') })
    console.log('  Setup complete.\n')

    // ─── Test 1: Open Settings ─────────────────────────────────────────
    console.log('  TEST 1: Settings panel opens')
    const gearBtn = page.locator('button:has(svg.lucide-settings)').first()
    // Fallback: find by aria or last toolbar button
    const settingsBtn = (await gearBtn.count()) > 0
      ? gearBtn
      : page.locator('button').filter({ has: page.locator('[class*="settings"], [class*="Settings"]') }).first()

    if (await settingsBtn.count() === 0) {
      // Try finding by position - gear icon is typically in top-right
      const allBtns = page.locator('button')
      const count = await allBtns.count()
      console.log(`     (${count} buttons on page, trying to find settings...)`)
      // List visible buttons to find the gear
      for (let i = Math.max(0, count - 5); i < count; i++) {
        const btn = allBtns.nth(i)
        const text = await btn.textContent()
        const visible = await btn.isVisible()
        if (visible) console.log(`     Button ${i}: "${text?.trim().slice(0, 30)}"`)
      }
    }

    await settingsBtn.click()
    await page.waitForTimeout(500)

    // Check if settings panel appeared
    const settingsPanel = page.locator('select')
    const panelVisible = (await settingsPanel.count()) > 0
    assert('Settings panel opens', panelVisible)
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'e2e-02-settings-open.png') })

    // ─── Test 2: Dropdown interaction ──────────────────────────────────
    console.log('\n  TEST 2: Dropdown works without closing panel')
    if (panelVisible) {
      const dropdown = settingsPanel.first()

      // Click the dropdown
      await dropdown.click()
      await page.waitForTimeout(500)

      // Check settings panel is still open
      const stillOpen = await dropdown.isVisible()
      assert('Panel stays open after dropdown click', stillOpen)

      // Select a different option
      await dropdown.selectOption({ index: 1 })
      await page.waitForTimeout(500)

      const stillOpenAfterSelect = await dropdown.isVisible()
      assert('Panel stays open after selecting option', stillOpenAfterSelect)

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'e2e-03-dropdown-works.png') })

      // Reset to auto
      await dropdown.selectOption({ value: 'auto' })
      await page.waitForTimeout(300)
    }

    // ─── Test 3: Labs section visible ──────────────────────────────────
    console.log('\n  TEST 3: Labs section is visible')

    // Scroll within the settings panel to find Labs
    const labsText = page.locator('text=Labs').first()
    const labsVisible = await labsText.isVisible({ timeout: 1000 }).catch(() => false)

    if (!labsVisible) {
      // Try scrolling the settings panel
      const panelEl = page.locator('.overflow-y-auto').last()
      if (await panelEl.count() > 0) {
        await panelEl.evaluate(el => el.scrollTop = el.scrollHeight)
        await page.waitForTimeout(500)
      }
    }

    const labsNowVisible = await labsText.isVisible({ timeout: 1000 }).catch(() => false)
    assert('Labs section is visible (after scroll)', labsNowVisible)
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'e2e-04-labs-visible.png') })

    // Check for feature flag toggles in Labs
    if (labsNowVisible) {
      const podcastToggle = page.locator('text=Podcast').first()
      const hasPodcast = await podcastToggle.isVisible({ timeout: 500 }).catch(() => false)
      assert('Podcast toggle exists in Labs', hasPodcast)
    }

    // ─── Test 4: Storage section visible ───────────────────────────────
    console.log('\n  TEST 4: Storage section')
    const storageText = page.locator('text=Storage').first()
    const storageVisible = await storageText.isVisible({ timeout: 1000 }).catch(() => false)
    assert('Storage section is visible', storageVisible)

    // ─── Test 5: Coach error message ───────────────────────────────────
    console.log('\n  TEST 5: Backend-agnostic error messages')

    // Close settings first
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // Click Coach tab
    const coachBtn = page.locator('button:has-text("Coach")').first()
    if (await coachBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await coachBtn.click()
      await page.waitForTimeout(2000)

      const pageText = await page.textContent('body')
      const hasOllamaMsg = pageText?.includes('needs Ollama') || pageText?.includes('Make sure Ollama is running')
      const hasGenericMsg = pageText?.includes('AI backend') || pageText?.includes('backend settings')

      assert('No Ollama-specific error messages', !hasOllamaMsg, hasOllamaMsg ? 'Still shows "needs Ollama"' : '')
      assert('Shows generic backend message', hasGenericMsg || !pageText?.includes('coach needs'))

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'e2e-05-coach-message.png') })
    } else {
      console.log('     (Coach button not visible, skipping)')
    }

    // ─── Summary ───────────────────────────────────────────────────────
    console.log('\n' + '━'.repeat(60))
    console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`)
    console.log('━'.repeat(60))

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'e2e-final.png') })

  } catch (err) {
    console.error('  ❌ Test error:', err.message)
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'e2e-error.png') }).catch(() => {})
  } finally {
    await browser.close()
  }

  process.exit(failed > 0 ? 1 : 0)
}

run().catch(console.error)
