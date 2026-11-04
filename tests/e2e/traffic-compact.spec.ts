import { expect, test } from '@playwright/test';
import { installStaticTrafficSite } from '../fixtures/staticTrafficSite';

test.beforeEach(async ({ page }) => {
  await installStaticTrafficSite(page);
});

test('compact record pages fetch and render detail only when opened', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('data-source-mode', JSON.stringify('mock'));
    const epoch = Date.UTC(2026, 0, 1);
    const timeline = [{ epoch, requests: 1, bytes: 30 }];
    const logValue = (value: string) => ({
      raw: value,
      value,
      availability: 'value',
    });
    const record = {
      id: 'fixture.log:1',
      storeId: 1,
      source: 'fixture.log',
      timestamp: '2026-01-01 00:00:00',
      malformed: false,
      schema: [],
      rawLine: '',
      normalized: {},
      issues: [],
      rawFields: {
        'cs-host': logValue('example.test'),
        'cs-bytes': logValue('30'),
      },
    };
    const dataset = {
      captureId: 'static-compact-test',
      source: 'fixture.log',
      timeline,
      fields: ['cs-host'],
      records: [],
      diagnostics: [],
      fieldAvailability: [],
      receivedLines: 1,
      recordsProcessed: 1,
      bytesProcessed: 30,
      diagnosticsTotal: 0,
    };
    const calls: {
      command: string;
      query?: Record<string, unknown>;
    }[] = [];
    Object.assign(window, {
      compactCalls: calls,
      __TAURI_INTERNALS__: {
        invoke: async (
          command: string,
          args: { query?: Record<string, unknown> } = {},
        ) => {
          calls.push({ command, query: args.query });
          if (command === 'list_traffic_analyses') return [];
          if (command === 'get_traffic_processing_config')
            return {
              logicalCpus: 2,
              recommendedWorkers: 1,
              maxWorkers: 2,
              chunkBytes: 4096,
            };
          if (command === 'get_mock_access_log') return '# fixture';
          if (command === 'start_access_log_parse')
            return dataset.captureId;
          if (command === 'append_access_log_parse_chunk')
            return dataset;
          if (command === 'get_traffic_record')
            return {
              ...record,
              schema: ['cs-host'],
              rawLine: 'unique-detail-payload',
              rawLineReconstructed: true,
            };
          if (command === 'query_traffic_capture')
            return {
              summary: {
                requests: 1,
                bytes: 30,
                issues: 0,
                denied: 0,
                uniqueUsers: 0,
                uniqueClients: 0,
                uniqueDestinations: 1,
                first: epoch,
                last: epoch,
                requestsPerSecond: 1,
                bytesPerSecond: 30,
              },
              rankings: {},
              rankingCounts: {},
              timeline,
              records: args.query?.omitRecords ? [] : [record],
              page: 1,
              pageSize: 100,
              totalRecords: 1,
              totalPages: 1,
              diagnostics: [],
              diagnosticsTotal: 0,
              options: {},
            };
          return null;
        },
      },
    });
  });
  await page.goto('/Diagnostics/TrafficAnalysis?proxy=fixture');
  await page
    .getByRole('button', { name: 'Explore demo data' })
    .click();
  await page
    .getByRole('button', { name: 'Fields & Records', exact: true })
    .click();
  const disclosure = page
    .locator('summary')
    .filter({ hasText: 'Raw & normalized fields' });
  await expect(disclosure).toBeVisible();
  await expect(
    page.getByText('unique-detail-payload', { exact: true }),
  ).toHaveCount(0);
  const detailCalls = () =>
    page.evaluate(
      () =>
        (
          window as unknown as { compactCalls: { command: string }[] }
        ).compactCalls.filter(
          (c) => c.command === 'get_traffic_record',
        ).length,
    );
  expect(await detailCalls()).toBe(0);
  await disclosure.click();
  await expect(
    page.getByText('unique-detail-payload', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Reconstructed ELFF line', { exact: false }),
  ).toBeVisible();
  expect(await detailCalls()).toBe(1);
  await disclosure.click();
  await disclosure.click();
  expect(await detailCalls()).toBe(1);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as {
          compactCalls: { query?: { compactRecords?: boolean } }[];
        }
      ).compactCalls.some((c) => c.query?.compactRecords),
    ),
  ).toBe(true);
});
