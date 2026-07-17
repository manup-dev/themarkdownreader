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
  // 'github' posts per-test failure annotations (file/line/message) to the
  // commit's check run — the one CI diagnostic channel readable without an
  // auth token (raw job logs and report artifacts both require one).
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:4174',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Build first so the gate never runs against a stale (or absent) dist/.
    // `env -u GITHUB_ACTIONS` matches release-cli.yml's existing workaround:
    // vite.config.ts switches `base` to '/themarkdownreader/' whenever
    // GITHUB_ACTIONS is set (true in every Actions job, not just the Pages
    // deploy), which breaks root-relative page.goto('/...') calls against
    // `vite preview` serving at the root here.
    command: 'env -u GITHUB_ACTIONS sh -c "npm run build && npx vite preview --port 4174"',
    port: 4174,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
})
