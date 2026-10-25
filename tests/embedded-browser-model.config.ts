import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: 'embedded-browser-model.spec.ts',
  workers: 1,
});
