import { existsSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
export default defineConfig({
  testDir: 'tests/e2e', fullyParallel: false, workers: 1, timeout: 30_000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173/recipe-book/', viewport: { width: 390, height: 844 },
    browserName: 'chromium', launchOptions: { executablePath }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/recipe-book/', reuseExistingServer: !process.env.CI },
})
