import { defineConfig } from '@playwright/test';
/** Pure CPL model tests: no browser, dev server or application build. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'cpl-document.spec.ts',
  workers: 1,
});
