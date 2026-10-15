import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('data-source-mode', JSON.stringify('mock'));
    localStorage.setItem('home-workspace', 'proxy');
    const inventory = [1, 2, 3].map((id) => ({
      hostname: `EDGE-${id}`,
      registered_address: `edge-${id}`,
      primary_address: `192.0.2.${id}`,
      active: true,
      pinglog: '',
      nslookup: '',
      last_check: '2026-10-15T12:00:00Z',
      hostinfo: {
        hostname: `EDGE-${id}`,
        ip: `192.0.2.${id}`,
        dnsname: '',
        dnsip: '',
      },
    }));
    if (!localStorage.getItem('proxies'))
      localStorage.setItem('proxies', JSON.stringify(inventory));
    Object.assign(window, {
      proxyChecks: [] as string[],
      __TAURI_INTERNALS__: {
        invoke: async (
          command: string,
          args: { hostname?: string } = {},
        ) => {
          if (command === 'getproxystatus') {
            (
              window as unknown as { proxyChecks: string[] }
            ).proxyChecks.push(args.hostname!);
            await new Promise((resolve) => setTimeout(resolve, 800));
            return (
              inventory.find(
                (proxy) => proxy.primary_address === args.hostname,
              ) ?? {
                ...inventory[0],
                hostname: args.hostname,
                registered_address: args.hostname,
                primary_address: args.hostname,
              }
            );
          }
          return null;
        },
      },
    });
  });
  await page.goto('/');
  await expect(
    page.getByText('EDGE-3', { exact: true }),
  ).toBeVisible();
});

function proxyCard(page: Page, name: string) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText(name, { exact: true }) });
}

async function editTags(page: Page, proxy: string) {
  await proxyCard(page, proxy)
    .getByRole('button', { name: `Proxy actions for ${proxy}` })
    .click();
  await page
    .getByRole('menuitem', { name: 'Edit tags', exact: true })
    .click();
}

async function addTag(page: Page, proxy: string, tag: string) {
  await editTags(page, proxy);
  const editor = page.getByRole('dialog', {
    name: 'Proxy tags',
  });
  await editor.getByLabel('New tag').fill(tag);
  await editor
    .getByRole('button', { name: 'Add', exact: true })
    .click();
  await page.keyboard.press('Escape');
}

async function groupByTags(page: Page) {
  await page.getByLabel('Group by', { exact: true }).click();
  await page
    .getByRole('option', { name: 'Tags', exact: true })
    .click();
}

test('custom tags create sections and selected grouping persists across reloads', async ({
  page,
}, testInfo) => {
  await addTag(page, 'EDGE-1', '  Lab    Norte  ');
  await addTag(page, 'EDGE-2', 'lab norte');
  await addTag(page, 'EDGE-2', 'Producción');
  await groupByTags(page);
  const lab = page.getByRole('region', {
    name: 'Lab Norte',
    exact: true,
  });
  await expect(
    lab.getByText('EDGE-1', { exact: true }),
  ).toBeVisible();
  await expect(
    lab.getByText('EDGE-2', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Producción', exact: true })
      .getByText('EDGE-2', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Untagged', exact: true })
      .getByText('EDGE-3', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Show tag', { exact: true }).click();
  await page
    .getByRole('option', { name: 'Lab Norte', exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByLabel('Group by', { exact: true }),
  ).toHaveText('Tags');
  await expect(
    page.getByLabel('Show tag', { exact: true }),
  ).toHaveText('Lab Norte');
  await expect(
    lab.getByText('EDGE-1', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('EDGE-3', { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: testInfo.outputPath('grouped-inventory.png'),
    fullPage: true,
  });
  await proxyCard(page, 'EDGE-1').screenshot({
    path: testInfo.outputPath('proxy-card-desktop.png'),
  });
});

test('tag edits during status checks survive and existing tags can be removed', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Re-check proxies' })
    .click();
  await addTag(page, 'EDGE-1', 'QA');
  await expect(
    page.getByRole('button', { name: 'Re-check proxies' }),
  ).toBeEnabled();
  await expect(
    proxyCard(page, 'EDGE-1').getByText('QA', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    proxyCard(page, 'EDGE-1').getByText('QA', { exact: true }),
  ).toBeVisible();
  await editTags(page, 'EDGE-2');
  await page
    .getByRole('dialog', { name: 'Proxy tags' })
    .getByRole('button', { name: 'QA', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await expect(
    proxyCard(page, 'EDGE-2').getByText('QA', { exact: true }),
  ).toBeVisible();
  await editTags(page, 'EDGE-1');
  await page
    .getByRole('dialog', { name: 'Proxy tags' })
    .getByRole('button', { name: 'QA', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await expect(
    proxyCard(page, 'EDGE-1').getByText('QA', { exact: true }),
  ).toHaveCount(0);
  await expect(
    proxyCard(page, 'EDGE-2').getByText('QA', { exact: true }),
  ).toBeVisible();
});

test('mobile add proxy form uses one explicit action and keeps existing inventory', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Hostname or IP').fill('192.0.2.4');
  await page
    .getByRole('button', { name: 'Add proxy', exact: true })
    .click();
  await expect(
    page
      .locator('[data-slot="card-title"]')
      .getByText('192.0.2.4', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('EDGE-1', { exact: true }),
  ).toBeVisible();
  const form = page.getByRole('region', {
    name: 'Add a proxy',
    exact: true,
  });
  await expect(form.getByRole('button')).toHaveCount(1);
  const bounds = await form.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath('mobile-add-proxy.png'),
    fullPage: true,
  });
  await proxyCard(page, 'EDGE-1').screenshot({
    path: testInfo.outputPath('proxy-card-mobile.png'),
  });
});
