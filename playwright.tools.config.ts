import { defineConfig } from '@playwright/test'

// Capture utilities (hero video, visual proofs) — tooling, not a test gate.
// Run: npx playwright test --config playwright.tools.config.ts [e2e/tools/<file>]
export default defineConfig({
  testDir: './e2e/tools',
  timeout: 120_000,
  retries: 0,
  use: { baseURL: 'http://localhost:4174' },
  webServer: {
    command: 'npm run build && npx vite preview --port 4174',
    port: 4174,
    reuseExistingServer: true,
    timeout: 240_000,
  },
})
