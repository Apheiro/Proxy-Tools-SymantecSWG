import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: 'traffic-report-model.spec.ts',
  workers: 1,
});
