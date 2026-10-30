import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const brave = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1440, height: 1050 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(brave) ? brave : undefined),
    },
  },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
});
