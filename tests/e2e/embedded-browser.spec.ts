import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('data-source-mode', JSON.stringify('mock'));
    localStorage.setItem(
      'proxies',
      JSON.stringify([
        {
          hostname: 'SWG',
          registered_address: 'swg.example.test',
          primary_address: '192.0.2.10',
          active: true,
          pinglog: '',
          nslookup: '',
          last_check: '',
          hostinfo: {
            hostname: 'swg.example.test',
            ip: '192.0.2.10',
            dnsname: 'unknown',
            dnsip: 'unknown',
          },
          tags: [],
        },
      ]),
    );
    const callbacks = new Map<number, (event: any) => void>();
    let callbackId = 0,
      serial = 0,
      revision = 0;
    const handlers = new Map<string, number[]>();
    const calls: { command: string; args: any }[] = [];
    let entries: any[] = [];
    const emit = (name: string, payload: unknown) => {
      for (const id of handlers.get(name) ?? [])
        callbacks.get(id)?.({ event: name, id, payload });
    };
    Object.assign(window, {
      isTauri: true,
      embeddedCalls: calls,
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener: () => {},
      },
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: 'main' },
          currentWebview: { label: 'main' },
        },
        transformCallback: (fn: (event: any) => void) => {
          const id = ++callbackId;
          callbacks.set(id, fn);
          return id;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (command: string, args: any = {}) => {
          calls.push({ command, args });
          if (command === 'plugin:event|listen') {
            handlers.set(args.event, [
              ...(handlers.get(args.event) ?? []),
              args.handler,
            ]);
            return args.handler;
          }
          if (command === 'embedded_list')
            return { revision, pages: entries };
          if (command === 'embedded_open') {
            const existing = entries.find(
              (p) => p.sourceUrl === args.url || p.url === args.url,
            );
            if (existing) {
              emit('embedded:restore', existing);
              return existing;
            }
            const id = `embedded-${++serial}`;
            const value = {
              id,
              title: args.title,
              url: args.url,
              sourceUrl: args.url,
              parentId: null,
              groupId: id,
              loading: false,
              loaded: true,
            };
            entries = [...entries, value];
            emit('embedded:changed', {
              revision: ++revision,
              pages: entries,
            });
            emit('embedded:opened', value);
            if ((window as any).delayEmbeddedOpen)
              await new Promise((resolve) =>
                setTimeout(resolve, 400),
              );
            Object.assign(window, { embeddedOpenResolved: true });
            return value;
          }
          if (command === 'embedded_close') {
            entries = entries.filter((p) => p.id !== args.id);
            emit('embedded:changed', {
              revision: ++revision,
              pages: entries,
            });
            return;
          }
          if (command === 'get_traffic_processing_config')
            return {
              logicalCpus: 4,
              recommendedWorkers: 2,
              maxWorkers: 4,
              chunkBytes: 4096,
            };
          if (
            command === 'list_traffic_analyses' ||
            command === 'get_traffic_access_logs'
          )
            return [];
          return null;
        },
      },
      embeddedPopup: (parentId: string, sameOrigin = true) => {
        const parent = entries.find((p) => p.id === parentId);
        const id = `embedded-${++serial}`;
        const value = {
          id,
          title: 'Popup layer',
          url: sameOrigin
            ? `${parent.url}?popup=${id}`
            : 'https://example.org/',
          parentId,
          groupId: parent.groupId,
          loading: false,
          loaded: true,
        };
        entries = [...entries, value];
        emit('embedded:changed', {
          revision: ++revision,
          pages: entries,
        });
        emit('embedded:opened', value);
      },
      embeddedDismiss: (id: string) => {
        entries = entries.filter((p) => p.id !== id);
        emit('embedded:changed', {
          revision: ++revision,
          pages: entries,
        });
      },
      embeddedShortcut: (id: string, action: string) =>
        emit('embedded:shortcut', { id, action }),
    });
  });
  await page.goto('/proxies');
  await expect(
    page.getByRole('heading', {
      name: 'Proxy workspace',
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
}
async function open(page: Page, name = 'Open admin console') {
  await page
    .getByRole('button', { name: 'Proxy actions for SWG' })
    .click();
  await page.getByRole('menuitem', { name, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function calls(page: Page, name: string) {
  return page.evaluate(
    (name) =>
      (window as any).embeddedCalls.filter(
        (c: any) => c.command === name,
      ),
    name,
  );
}

test('mock pages use public destinations without credentials; minimize/restore retains the same native view and fits its slot', async ({
  page,
}) => {
  await setup(page);
  await open(page);
  const opened = await calls(page, 'embedded_open');
  expect(opened).toHaveLength(1);
  expect(opened[0].args.url).toBe('https://httpbin.org/forms/post');
  expect(opened[0].args.authentication).toBeNull();
  await expect
    .poll(async () => (await calls(page, 'embedded_present')).length)
    .toBeGreaterThan(0);
  const slot = await page
    .locator('[data-embedded-slot]')
    .boundingBox();
  const bounds = (await calls(page, 'embedded_present')).at(-1).args
    .bounds;
  expect(bounds.x).toBeGreaterThanOrEqual(slot!.x - 1);
  expect(bounds.y).toBeCloseTo(slot!.y, 0);
  expect(bounds.width).toBeLessThanOrEqual(slot!.width + 1);
  expect(await page.locator('iframe').count()).toBe(0);
  await page
    .getByRole('button', { name: 'Minimize page', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Minimized pages' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Restore Demo/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await calls(page, 'embedded_open')).toHaveLength(1);
  expect(await calls(page, 'embedded_close')).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Close page', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Minimized pages' }),
  ).toHaveCount(0);
});
test('independent pages survive route navigation and shortcuts cycle without recreation or repeated loading', async ({
  page,
}) => {
  await setup(page);
  await open(page);
  await page
    .getByRole('button', { name: 'Minimize page', exact: true })
    .click();
  await open(page, 'Open VPM');
  expect(await calls(page, 'embedded_open')).toHaveLength(2);
  await expect
    .poll(
      async () =>
        (await calls(page, 'embedded_present')).at(-1)?.args.id,
    )
    .toBe('embedded-2');
  const before = (await calls(page, 'embedded_present')).length;
  await page
    .getByRole('button', { name: 'Minimize page', exact: true })
    .focus();
  await page.keyboard.press('Control+ArrowLeft');
  await expect
    .poll(
      async () =>
        (await calls(page, 'embedded_present')).at(-1)?.args.id,
    )
    .toBe('embedded-1');
  await expect(
    page.getByText('Opening page…', { exact: true }),
  ).toHaveCount(0);
  expect(
    (await calls(page, 'embedded_present')).length,
  ).toBeGreaterThan(before);
  await page.keyboard.press('Control+ArrowLeft');
  await expect
    .poll(
      async () =>
        (await calls(page, 'embedded_present')).at(-1)?.args.id,
    )
    .toBe('embedded-2');
  await page
    .locator('[data-embedded-overlay]')
    .click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page
    .getByRole('link', { name: 'PAC File Manager', exact: true })
    .first()
    .click();
  await expect(page).toHaveURL('/pac');
  await expect(
    page
      .getByRole('navigation', { name: 'Minimized pages' })
      .getByRole('button'),
  ).toHaveCount(2);
  await page
    .getByRole('button', { name: /Restore Demo/ })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await calls(page, 'embedded_open')).toHaveLength(2);
});
test('same-origin popup layers peek above the active page; native content shortcuts navigate vertically and close only one layer', async ({
  page,
}, testInfo) => {
  await setup(page);
  await open(page, 'Open VPM');
  await page.evaluate(() =>
    (window as any).embeddedPopup('embedded-1'),
  );
  await expect(
    page
      .getByRole('dialog')
      .getByRole('heading', { name: 'Popup layer', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Previous related page' }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('related-pages.png'),
  });
  await page.evaluate(() =>
    (window as any).embeddedShortcut('embedded-2', 'up'),
  );
  await expect
    .poll(
      async () =>
        (await calls(page, 'embedded_present')).at(-1)?.args.id,
    )
    .toBe('embedded-1');
  await page.evaluate(() =>
    (window as any).embeddedShortcut('embedded-1', 'down'),
  );
  await expect
    .poll(
      async () =>
        (await calls(page, 'embedded_present')).at(-1)?.args.id,
    )
    .toBe('embedded-2');
  await page
    .getByRole('button', { name: 'Close page', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await calls(page, 'embedded_present')).at(-1)?.args.id,
    )
    .toBe('embedded-1');
  expect(await calls(page, 'embedded_close')).toHaveLength(1);
  await expect(
    page.getByRole('heading', {
      name: 'Demo · Web navigation',
      exact: true,
    }),
  ).toBeVisible();
});
test('cross-origin popup stays grouped with its opener; reduced motion keeps navigation functional', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  await open(page);
  await page.evaluate(() =>
    (window as any).embeddedPopup('embedded-1', false),
  );
  await expect(
    page.getByRole('heading', { name: 'Popup layer', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Previous related page' }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Previous related page',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Demo · Form state',
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Minimize page', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('a page-initiated close restores its parent and final close releases the application', async ({
  page,
}) => {
  await setup(page);
  await open(page);
  await page.evaluate(() =>
    (window as any).embeddedPopup('embedded-1'),
  );
  await expect(
    page.getByRole('heading', { name: 'Popup layer', exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).embeddedDismiss('embedded-2'),
  );
  await expect(
    page.getByRole('heading', {
      name: 'Demo · Form state',
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).embeddedDismiss('embedded-1'),
  );
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Proxy actions for SWG' }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Proxy actions for SWG' })
    .click();
  await expect(
    page.getByRole('menuitem', { name: 'Open VPM', exact: true }),
  ).toBeVisible();
});

test('minimizing during native creation is not undone by a late open response', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() =>
    Object.assign(window, { delayEmbeddedOpen: true }),
  );
  await open(page);
  await page
    .getByRole('button', { name: 'Minimize page', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).embeddedOpenResolved),
    )
    .toBe(true);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Minimized pages' }),
  ).toBeVisible();
});

test('opening an existing URL restores one retained instance', async ({
  page,
}) => {
  await setup(page);
  await open(page);
  await page
    .getByRole('button', { name: 'Minimize page', exact: true })
    .click();
  await open(page);
  await expect
    .poll(
      async () =>
        (await calls(page, 'embedded_present')).at(-1)?.args.id,
    )
    .toBe('embedded-1');
  await page
    .getByRole('button', { name: 'Minimize page', exact: true })
    .click();
  await expect(
    page
      .getByRole('navigation', { name: 'Minimized pages' })
      .getByRole('button'),
  ).toHaveCount(1);
});
