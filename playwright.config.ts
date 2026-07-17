import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Zero-assertion capture utilities live in e2e/tools — not part of the gate.
  // Run them via: npx playwright test --config playwright.tools.config.ts
  testIgnore: ['**/tools/**'],
  timeout: 30000,
  retries: 1,
  // CI's "Upload Playwright report" step (.github/workflows/ci.yml) uploads
  // playwright-report/ on failure, but that directory only exists if an
  // html reporter is configured — without this, the upload step silently
  // no-ops (upload-artifact defaults if-no-files-found to 'warn') and a red
  // CI run leaves no debuggable artifact behind.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4174',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Build first so the gate never runs against a stale (or absent) dist/.
    command: 'npm run build && npx vite preview --port 4174',
    port: 4174,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
})
