import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  testMatch: /playwright-.*\.test\.ts/,
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'https://api.github.com',
  },
  projects: [{ name: 'chromium' }],
})
