import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: ['traffic-compact.spec.ts', 'traffic-report.spec.ts'],
  workers: 1,
  use: {
    baseURL: 'http://localhost:3100',
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
});
