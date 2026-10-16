import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('data-source-mode', JSON.stringify('mock'));
    const inventory = [
      {
        hostname: 'SWG',
        registered_address: 'swg.example.test',
        primary_address: '192.0.2.10',
        active: true,
        pinglog: '',
        nslookup: '',
        last_check: 'old',
        hostinfo: {
          hostname: 'swg.example.test',
          ip: '192.0.2.10',
          dnsname: 'unknown',
          dnsip: '192.0.2.53',
        },
        tags: ['Production'],
      },
    ];
    if (!localStorage.getItem('proxies'))
      localStorage.setItem('proxies', JSON.stringify(inventory));
    Object.assign(window, {
      proxyChecks: [],
      __TAURI_INTERNALS__: {
        invoke: async (
          command: string,
          args: { hostname?: string } = {},
        ) => {
          if (command === 'getproxystatus') {
            (
              window as unknown as { proxyChecks: string[] }
            ).proxyChecks.push(args.hostname!);
            const prior = inventory[0];
            return {
              ...prior,
              hostname: args.hostname,
              registered_address: args.hostname,
              primary_address: args.hostname,
              active:
                localStorage.getItem('simulate-offline') !== 'yes',
              last_check: '2026-10-16T12:00:00Z',
              pinglog: `Pinging ${args.hostname} [${args.hostname}]`,
              nslookup: `Resolution: ${args.hostname}\nName: unknown\nPTR timed out`,
              hostinfo: { ...prior.hostinfo, hostname: 'unknown' },
              tags: undefined,
            };
          }
          return null;
        },
      },
    });
  });
});

test('rechecking an IP with failed PTR retains and persists hostname across reloads', async ({
  page,
}) => {
  await page.goto('/proxies');
  for (const offline of [false, true, false]) {
    await page.evaluate(
      (offline) =>
        localStorage.setItem(
          'simulate-offline',
          offline ? 'yes' : 'no',
        ),
      offline,
    );
    await page
      .getByRole('button', { name: 'Re-check proxies' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Re-check proxies' }),
    ).toBeEnabled();
    await expect(
      page.getByText('SWG', { exact: true }),
    ).toBeVisible();
    const stored = await page.evaluate(
      () => JSON.parse(localStorage.getItem('proxies')!)[0],
    );
    expect(stored.hostname).toBe('SWG');
    expect(stored.hostinfo.hostname).toBe('swg.example.test');
    expect(stored.active).toBe(!offline);
    expect(stored.tags).toEqual(['Production']);
  }
  await page.reload();
  await expect(page.getByText('SWG', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { proxyChecks: string[] }).proxyChecks,
    ),
  ).toEqual([]);
});

test('loading a damaged name repairs it from the original registration without changing identity or tags', async ({
  page,
}) => {
  await page.goto('/proxies');
  await page.evaluate(() => {
    const entries = JSON.parse(localStorage.getItem('proxies')!);
    entries[0].hostname = '192.0.2.10';
    entries[0].hostinfo.hostname = 'unknown';
    localStorage.setItem('proxies', JSON.stringify(entries));
  });
  await page.reload();
  await expect(
    page.getByText('swg.example.test', { exact: true }),
  ).toBeVisible();
  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem('proxies')!)[0],
  );
  expect(stored.hostname).toBe('swg.example.test');
  expect(stored.registered_address).toBe('swg.example.test');
  expect(stored.primary_address).toBe('192.0.2.10');
  expect(stored.tags).toEqual(['Production']);
});
