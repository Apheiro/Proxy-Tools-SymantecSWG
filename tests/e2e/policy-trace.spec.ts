import { expect, test, type Page } from '@playwright/test';
import { traceLog, traceScenario } from '../fixtures/policyTrace';

async function openTrace(page: Page, logs: TransactionInfo[]) {
  await page.addInitScript((initial) => {
    localStorage.setItem('data-source-mode', JSON.stringify('mock'));
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<string, number>();
    let id = 0;
    const emit = (records: typeof initial) => {
      const handler = listeners.get('logs:update');
      if (handler)
        callbacks.get(handler)?.({
          event: 'logs:update',
          id: handler,
          payload: {
            json: records.map((record) => JSON.stringify(record)),
            raw: records.map(
              (record) =>
                `start transaction\ntransaction ID=${record.transaction.id} type=${record.transaction.type}\nRAW-${record.transaction.id}\nhanded off from: ${record.transaction.pid ?? 'none'}\nstop transaction`,
            ),
          },
        });
    };
    Object.assign(window, {
      emitTraceRecords: emit,
      __TAURI_INTERNALS__: {
        transformCallback: (callback: (event: unknown) => void) => {
          callbacks.set(++id, callback);
          return id;
        },
        unregisterCallback: (key: number) => callbacks.delete(key),
        invoke: async (
          command: string,
          args: Record<string, unknown> = {},
        ) => {
          if (command === 'plugin:event|listen') {
            listeners.set(
              args.event as string,
              args.handler as number,
            );
            return args.handler;
          }
          if (command === 'plugin:event|unlisten') {
            return;
          }
          if (command === 'start_logs') {
            emit(initial);
            return;
          }
          return null;
        },
      },
    });
  }, logs);
  await page.goto(
    '/Diagnostics/Trace?proxy=192.0.2.1&traceUrl=etuyon.html',
  );
  await expect(
    page.getByText(`${logs.length} shown · ${logs.length} received`, {
      exact: true,
    }),
  ).toBeVisible();
}

function transaction(page: Page, id: string) {
  return page.getByRole('article', {
    name: `Transaction ${id}`,
    exact: true,
  });
}

test('reported outcomes, UTC timestamps, raw blocks and only explicit handoffs remain consistent', async ({
  page,
}, testInfo) => {
  await openTrace(page, traceScenario());
  const list = page.getByRole('region', {
    name: 'Policy trace transactions',
  });
  await list.scrollIntoViewIfNeeded();
  await expect(list).not.toContainText('Invalid Date');
  await expect(list).not.toContainText(/unreached|unreachable/i);
  const child = transaction(page, '1234');
  await expect(
    child.getByText('Allowed', { exact: true }),
  ).toBeVisible();
  await expect(child).toContainText('ALLOW (intercept https)');
  await expect(child).toContainText('02 Aug 2026');
  await expect(child).toContainText('15:51:32');
  await expect(
    child.getByRole('button', { name: /From #123 · http.proxy/ }),
  ).toBeVisible();
  await child
    .getByRole('button', { name: 'Details', exact: true })
    .click();
  const details = page.getByRole('dialog');
  await expect(
    details.getByText('Recorded checkpoints', { exact: true }),
  ).toBeVisible();
  await expect(
    details.getByRole('rowheader', {
      name: 'client-out',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    details.getByRole('rowheader', {
      name: 'client-in',
      exact: true,
    }),
  ).toBeVisible();
  await details
    .getByRole('button', { name: 'Show log', exact: true })
    .click();
  await expect(details.locator('pre')).toContainText('RAW-1234');
  await details
    .getByRole('button', { name: /From #123 · http.proxy/ })
    .click();
  await expect(details).toContainText('ID 123');
  await expect(details.locator('pre')).toContainText('RAW-123\n');
  await expect(details.locator('pre')).not.toContainText('RAW-1234');
  await page.screenshot({
    path: testInfo.outputPath('trace-details.png'),
  });
  await details
    .getByRole('button', { name: 'Close transaction details' })
    .click();
  await page
    .getByRole('searchbox', { name: 'Search transactions' })
    .fill('example.test/resource');
  await expect(
    page.getByText('1 shown · 5 received', { exact: true }),
  ).toBeVisible();
  await expect(
    transaction(page, '1235').getByRole('button', {
      name: /From #1234 · ssl.tunnel/,
    }),
  ).toBeVisible();
  await transaction(page, '1235')
    .getByRole('button', { name: /From #1234 · ssl.tunnel/ })
    .click();
  await expect(details).toContainText('ID 1234');
});

test('thousands of records render a bounded window, scroll to the end and filter all data', async ({
  page,
}, testInfo) => {
  const logs = Array.from({ length: 2500 }, (_, index) =>
    traceLog(String(10000 + index), {
      time: new Date(
        Date.UTC(2026, 7, 2, 15, 0, 0) - index * 1000,
      ).toISOString(),
      verdict:
        index === 2499
          ? 'EXCEPTION(tcp_error): Could not connect'
          : 'ALLOWED',
      dest: `https://service-${index}.example.test/${'long-path/'.repeat(index % 5)}`,
    }),
  );
  await openTrace(page, logs);
  const list = page.getByRole('region', {
    name: 'Policy trace transactions',
  });
  await list.scrollIntoViewIfNeeded();
  expect(await list.getByRole('article').count()).toBeLessThan(30);
  const viewport = list.locator('[data-slot="scroll-area-viewport"]');
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(transaction(page, '12499')).toBeVisible();
  expect(await list.getByRole('article').count()).toBeLessThan(30);
  await page
    .getByRole('searchbox', { name: 'Search transactions' })
    .fill('service-2499.example.test');
  await expect(
    page.getByText('1 shown · 2500 received', { exact: true }),
  ).toBeVisible();
  await expect(
    transaction(page, '12499').getByText('Exception', {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('trace-list-desktop.png'),
  });
  await page
    .getByRole('button', { name: 'Clear search', exact: true })
    .click();
  await expect(
    page.getByText('2500 shown · 2500 received', { exact: true }),
  ).toBeVisible();
  await expect(transaction(page, '10000')).toBeVisible();
  await page.evaluate(
    (records) =>
      (
        window as unknown as {
          emitTraceRecords: (records: TransactionInfo[]) => void;
        }
      ).emitTraceRecords(records),
    logs.slice(0, 5),
  );
  await expect(
    page.getByText('2500 shown · 2500 received', { exact: true }),
  ).toBeVisible();
});

test('mobile cards expose missing evidence honestly and verdict/date filters work', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTrace(page, traceScenario());
  await page
    .getByRole('button', { name: 'Filters', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Not reported / unclassified',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', { name: 'Apply filters', exact: true })
    .click();
  await expect(
    page.getByText('1 shown · 5 received', { exact: true }),
  ).toBeVisible();
  const unknown = transaction(page, '900');
  await expect(unknown).toContainText('Not reported');
  await expect(unknown).toContainText('Not recorded');
  await expect(unknown).toContainText(
    'From #899 · Not in this capture',
  );
  await expect(
    unknown.getByRole('button', { name: /From #899/ }),
  ).toHaveCount(0);
  const box = await unknown.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  await unknown.screenshot({
    path: testInfo.outputPath('trace-card-mobile.png'),
  });
  await unknown
    .getByRole('button', { name: 'Details', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toContainText(
    'Invalid Date',
  );
});

test('custom local time ranges include valid UTC timestamps and exclude unrecorded dates', async ({
  page,
}) => {
  await openTrace(page, traceScenario());
  await page
    .getByRole('button', { name: 'Filters', exact: true })
    .click();
  for (const [label, iso] of [
    ['From', '2026-08-02T15:51:00Z'],
    ['To', '2026-08-02T15:52:00Z'],
  ]) {
    const local = await page.evaluate((value) => {
      const date = new Date(value);
      const pad = (part: number) => String(part).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }, iso);
    await page
      .getByRole('button', { name: label, exact: true })
      .click();
    const draft = page.getByPlaceholder('YYYY-MM-DD HH:mm', {
      exact: true,
    });
    await draft.fill(local);
    await draft.press('Enter');
    await draft.press('Escape');
  }
  await page
    .getByRole('button', { name: 'Apply filters', exact: true })
    .click();
  await expect(
    page.getByText('3 shown · 5 received', { exact: true }),
  ).toBeVisible();
  await expect(transaction(page, '900')).toHaveCount(0);
  await expect(transaction(page, '901')).toHaveCount(0);
});

async function relatedFlows(page: Page) {
  await page
    .getByRole('combobox', { name: 'Group by', exact: true })
    .click();
  await page
    .getByRole('option', { name: 'Related flow', exact: true })
    .click();
}

test('related flows persist, collapse and preserve context when filtering or receiving a parent later', async ({
  page,
}, testInfo) => {
  await openTrace(page, traceScenario());
  await relatedFlows(page);
  const list = page.getByRole('region', {
    name: 'Policy trace transactions',
  });
  const flow = list.getByRole('button', {
    name: 'Collapse flow 123',
    exact: true,
  });
  await expect(flow).toContainText('3 transactions');
  await expect(flow).toContainText('3 allowed');
  await expect(flow).toContainText(
    'First record: 02 Aug 2026 15:51:31 UTC',
  );
  const ids = await list
    .getByRole('article')
    .evaluateAll((articles) =>
      articles.map((article) => article.getAttribute('aria-label')),
    );
  expect(ids.indexOf('Transaction 123')).toBeGreaterThan(
    ids.indexOf('Transaction 1234'),
  );
  expect(ids.indexOf('Transaction 1234')).toBeGreaterThan(
    ids.indexOf('Transaction 1235'),
  );
  await flow.click();
  await expect(transaction(page, '123')).toHaveCount(0);
  await expect(
    list.getByRole('button', {
      name: 'Expand flow 123',
      exact: true,
    }),
  ).toHaveAttribute('aria-expanded', 'false');
  await list
    .getByRole('button', { name: 'Expand flow 123', exact: true })
    .click();
  await expect(transaction(page, '123')).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: 'Group by', exact: true }),
  ).toHaveText('Related flow');
  await page
    .getByRole('searchbox', { name: 'Search transactions' })
    .fill('example.test/resource');
  await expect(
    page.getByText('1 shown · 5 received', { exact: true }),
  ).toBeVisible();
  await expect(flow).toContainText('3 transactions · 1 shown');
  await expect(transaction(page, '123')).toHaveCount(0);
  await expect(transaction(page, '1235')).toBeVisible();
  await transaction(page, '1235')
    .getByRole('button', { name: /From #1234/ })
    .click();
  await expect(page.getByRole('dialog')).toContainText('ID 1234');
  await page
    .getByRole('button', { name: 'Close transaction details' })
    .click();
  await page
    .getByRole('button', { name: 'Clear search', exact: true })
    .click();
  await page.evaluate(
    (records) =>
      (
        window as unknown as {
          emitTraceRecords: (records: TransactionInfo[]) => void;
        }
      ).emitTraceRecords(records),
    [traceLog('899', { time: '2026-08-02 15:51:30 UTC' })],
  );
  await expect(
    page.getByText('6 shown · 6 received', { exact: true }),
  ).toBeVisible();
  const viewport = list.locator('[data-slot="scroll-area-viewport"]');
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    list.getByRole('button', {
      name: 'Collapse flow 899',
      exact: true,
    }),
  ).toContainText('2 transactions');
  await expect(list).not.toContainText(
    'Referenced parent #899 is not in this capture.',
  );
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({
    path: testInfo.outputPath('related-flows-desktop.png'),
  });
});

test('one large related flow stays virtualized and compact controls adapt to mobile', async ({
  page,
}, testInfo) => {
  const logs = Array.from({ length: 1500 }, (_, index) =>
    traceLog(String(10000 + index), {
      parent: index ? String(9999 + index) : undefined,
    }),
  );
  await openTrace(page, logs);
  await relatedFlows(page);
  const list = page.getByRole('region', {
    name: 'Policy trace transactions',
  });
  const flow = list.getByRole('button', {
    name: 'Collapse flow 10000',
    exact: true,
  });
  await expect(flow).toContainText('1500 transactions');
  await expect(transaction(page, '11499')).toBeVisible();
  expect(await list.getByRole('article').count()).toBeLessThan(30);
  const viewport = list.locator('[data-slot="scroll-area-viewport"]');
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(transaction(page, '10000')).toBeVisible();
  expect(await list.getByRole('article').count()).toBeLessThan(30);
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
  });
  await flow.click();
  await expect(list.getByRole('article')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const summary = page.getByRole('region', {
    name: 'Transaction summary',
  });
  expect((await summary.boundingBox())!.height).toBeLessThan(170);
  const search = page.getByRole('search', {
    name: 'Filter transactions',
  });
  expect((await search.boundingBox())!.height).toBeLessThan(110);
  await page
    .getByRole('button', { name: 'Filters', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Apply filters', exact: true }),
  ).toBeVisible();
  await search.screenshot({
    path: testInfo.outputPath('compact-filters-mobile.png'),
  });
  await expect
    .poll(() =>
      search.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('compact-trace-mobile.png'),
    fullPage: true,
  });
});
