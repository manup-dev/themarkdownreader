import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:4174',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx vite preview --port 4174',
    port: 4174,
    reuseExistingServer: true,
  },
})
