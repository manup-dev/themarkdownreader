import { defineConfig, devices } from '@playwright/test'

const HOSTED_URL =
  process.env.HOSTED_URL ?? 'https://manup-dev.github.io/themarkdownreader/?demo=true'

export default defineConfig({
  testDir: './e2e-hosted',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: HOSTED_URL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
