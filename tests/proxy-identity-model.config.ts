import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: 'proxy-identity-model.spec.ts',
  workers: 1,
});
