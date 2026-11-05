/** Controlled browser bridge only; no capture is opened, written or reprocessed. */
import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page, days: number) {
  await page.addInitScript(
    ({ days }) => {
      const root = window as any;
      const events = Array.from({ length: days }, (_, i) => [
        {
          epoch: Date.UTC(2026, 9, i + 1, 9, i % 3 === 1 ? 30 : 0),
          requests: 10 + i,
          bytes: (days - i) * 1024,
        },
        {
          epoch: Date.UTC(2026, 9, i + 1, 9, 45),
          requests: 2,
          bytes: 2048,
        },
      ]).flat();
      const source = {
        id: 'controlled-v3',
        source: `${days} controlled days`,
        scope: null,
        records: 30089,
        first: events[0].epoch,
        last: events.at(-1)!.epoch,
        untimedRecords: 0,
      };
      localStorage.setItem(
        'data-source-mode',
        JSON.stringify('live'),
      );
      localStorage.setItem(
        'comparative-reports:timezone:live:comparison-test',
        'UTC',
      );
      root.comparisonCalls = [];
      root.comparisonDelay = 0;
      root.__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: any = {}) => {
          root.comparisonCalls.push({ command, args });
          if (command === 'list_traffic_comparison_captures')
            return args.unassigned
              ? [{ ...source, savedAt: '2026-11-05', path: '' }]
              : [];
          if (command === 'discover_traffic_comparison')
            return {
              sources: [source],
              utcMinutes: events.map((e) => e.epoch),
            };
          if (command !== 'query_traffic_comparison') return null;
          const fail = root.comparisonFailNext;
          root.comparisonFailNext = false;
          await new Promise((resolve) =>
            setTimeout(resolve, root.comparisonDelay),
          );
          if (fail) throw new Error('Controlled query failure');
          const request = args.request;
          const periods = request.periods.flatMap((p: any) => {
            const observed = events.filter((e) =>
              p.ranges.some(
                (r: any) => e.epoch >= r.start && e.epoch < r.end,
              ),
            );
            if (!observed.length) return [];
            const requests = observed.reduce(
                (n, e) => n + e.requests,
                0,
              ),
              bytes = observed.reduce((n, e) => n + e.bytes, 0);
            const entries = [
              {
                name: 'one.example',
                requests: requests - 1,
                bytes: 1024,
              },
              {
                name: 'two.example',
                requests: 1,
                bytes: bytes - 1024,
              },
            ].sort(
              (a: any, b: any) =>
                b[request.metric] - a[request.metric],
            );
            return [
              {
                ...p,
                requests,
                bytes,
                first: observed[0].epoch,
                last: observed.at(-1)!.epoch,
                observedDurationMs:
                  observed.at(-1)!.epoch - observed[0].epoch,
                clients: 2,
                hosts: 2,
                http4xx: 1,
                http5xx: 0,
                denied: 1,
                issues: 1,
                parseFailures: 0,
                activeMinutes: observed.length,
                timeline: observed,
                rankings: { host: entries, client: entries },
                maxEventGapMs: 1800000,
              },
            ];
          });
          return {
            periods,
            sources: [source],
            excluded: request.periods.length - periods.length,
            common: { host: [], client: [] },
            changes: {},
          };
        },
      };
    },
    { days },
  );
  await page.goto(
    '/Diagnostics/ComparativeReports?proxy=comparison-test',
  );
  await expect(
    page.getByRole('heading', {
      name: 'Comparative Reports',
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Choose saved captures' })
    .click();
  await page
    .getByRole('checkbox', {
      name: 'Browse unassigned legacy captures',
    })
    .check();
  await expect(
    page.getByText(
      'Unassigned captures have no verified proxy or profile.',
      { exact: false },
    ),
  ).toBeVisible();
  await page.getByRole('checkbox').nth(1).check();
  await page.keyboard.press('Escape');
}
async function zone(page: Page, name: string) {
  await page.getByRole('button', { name: /^Time zone:/ }).click();
  await page
    .getByRole('textbox', { name: 'Search time zones' })
    .fill(name);
  await page.getByRole('button', { name, exact: true }).click();
}

test('30 periods: clock activity, pagination, complete table and focused rankings on desktop/mobile', async ({
  page,
}) => {
  await prepare(page, 30);
  await page
    .getByRole('button', { name: 'Hourly', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Compare 1 capture', exact: true })
    .click();
  await expect(
    page.getByText('30 observed periods ·', { exact: false }),
  ).toBeVisible();
  const summaries = page.getByRole('region', {
    name: 'Period summaries',
  });
  await expect(
    summaries.getByRole('heading', { level: 3 }),
  ).toHaveCount(4);
  await page
    .getByRole('button', { name: 'Next period page' })
    .click();
  await expect(
    page.getByText('Periods 5–8 of 30', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'All periods table', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'All period summary data' })
      .getByRole('row'),
  ).toHaveCount(31);
  await page
    .getByRole('button', { name: 'Cards', exact: true })
    .click();
  await expect(
    page.getByText('6 / 30 series visible', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Focus activity period' })
    .selectOption('hourly:2026-10-20');
  await expect(
    page.getByText('1 / 30 series visible', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Ranking period', exact: true })
    .selectOption('hourly:2026-10-30');
  await page
    .getByRole('combobox', { name: 'Second ranking period' })
    .selectOption('hourly:2026-10-01');
  await page
    .getByRole('button', { name: 'Bytes', exact: true })
    .click();
  await expect(
    page.getByText('Bytes · Top 10', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Top N' })
    .selectOption('20');
  await expect(
    page.getByText('Bytes · Top 20', { exact: true }),
  ).toBeVisible();
  await expect(
    summaries.getByRole('heading', { level: 3 }),
  ).toHaveCount(4);
  await expect(
    summaries.getByText('bytes', { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: '/tmp/comparative-reports-30-desktop.png',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('button', { name: 'Hourly', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: '/tmp/comparative-reports-30-mobile.png',
  });
  expect(
    await page
      .locator('main')
      .evaluate(
        (main) =>
          main.scrollWidth <= main.clientWidth &&
          main.getBoundingClientRect().right <= innerWidth,
      ),
  ).toBe(true);
  const activity = page.locator('[data-slot="card"]').filter({
    has: page.getByRole('heading', { name: /^Overlaid activity/ }),
  });
  await activity.screenshot({
    path: '/tmp/comparative-reports-activity-mobile.png',
  });
  expect(
    await page.evaluate(() =>
      (window as any).comparisonCalls.some((c: any) =>
        /parse|download.*log/.test(c.command),
      ),
    ),
  ).toBe(false);
  await page.emulateMedia({ colorScheme: 'dark' });
  await activity.screenshot({
    path: '/tmp/comparative-reports-activity-dark.png',
  });
});

test('12 periods: timezone auto requery, atomic retained snapshot, errors, rapid changes and export zone', async ({
  page,
}) => {
  await prepare(page, 12);
  await page
    .getByRole('button', { name: 'Compare 1 capture', exact: true })
    .click();
  await expect(
    page.getByText('12 observed periods ·', { exact: false }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).comparisonDelay = 800;
  });
  await zone(page, 'America/New_York');
  await expect(
    page.getByText('Showing the previous comparison in UTC', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Observed totals & normalized rates',
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'CSV', exact: true }),
  ).toHaveAttribute('title', 'Export displayed results in UTC');
  await expect(
    page.getByText('12 observed periods ·', { exact: false }),
  ).toContainText('America/New_York');
  const latest = await page.evaluate(() =>
    (window as any).comparisonCalls
      .filter((c: any) => c.command === 'query_traffic_comparison')
      .at(-1),
  );
  expect(
    new Date(latest.args.request.periods[0].start).getUTCHours(),
  ).toBe(4);
  await page.evaluate(() => {
    (window as any).comparisonFailNext = true;
  });
  await zone(page, 'Europe/London');
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Controlled query failure',
  );
  await expect(
    page.getByText('12 observed periods ·', { exact: false }),
  ).toContainText('America/New_York');
  await zone(page, 'Europe/Paris');
  await zone(page, 'Asia/Tokyo');
  await expect(
    page.getByText('12 observed periods ·', { exact: false }),
  ).toContainText('Asia/Tokyo');
  await expect(
    page.getByRole('button', { name: 'CSV', exact: true }),
  ).toHaveAttribute(
    'title',
    'Export displayed results in Asia/Tokyo',
  );
  expect(
    await page.evaluate(() =>
      localStorage.getItem(
        'comparative-reports:timezone:live:comparison-test',
      ),
    ),
  ).toBe('Asia/Tokyo');
});
