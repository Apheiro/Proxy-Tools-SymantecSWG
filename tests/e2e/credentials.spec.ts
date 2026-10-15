import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('data-source-mode'))
      localStorage.setItem(
        'data-source-mode',
        JSON.stringify('mock'),
      );
    const calls: string[] = [];
    let vault: { username: string; password: string } | null = {
      username: 'live-user',
      password: 'live-password',
    };
    Object.assign(window, {
      credentialCalls: calls,
      __TAURI_INTERNALS__: {
        invoke: async (
          command: string,
          args: { credentials?: typeof vault } = {},
        ) => {
          calls.push(command);
          if (command === 'read_management_credentials') return vault;
          if (command === 'save_management_credentials')
            vault = args.credentials!;
          if (command === 'delete_management_credentials')
            vault = null;
        },
      },
    });
  });
  await page.goto('/Diagnostics/BackupManager?proxy=192.0.2.10');
  await expect(
    page.getByRole('heading', { name: 'Backup Manager' }),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole('navigation')
    .getByRole('button')
    .last()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible();
});

test('mock credentials save, reload and delete in localStorage without vault calls', async ({
  page,
}) => {
  await expect(
    page.getByText(
      'Mock credentials are saved in localStorage on this device.',
      { exact: false },
    ),
  ).toBeVisible();
  await page
    .getByLabel('Username', { exact: true })
    .fill('mock-user');
  await page
    .getByLabel('Password', { exact: true })
    .fill('mock-password');
  await page
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('mock-management-credentials'),
      ),
    )
    .toBe(
      JSON.stringify({
        username: 'mock-user',
        password: 'mock-password',
      }),
    );
  await page.reload();
  await page
    .getByRole('navigation')
    .getByRole('button')
    .last()
    .click();
  await expect(
    page.getByLabel('Username', { exact: true }),
  ).toHaveValue('mock-user');
  await page
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('mock-management-credentials'),
      ),
    )
    .toBeNull();
  const calls = await page.evaluate(
    () =>
      (window as unknown as { credentialCalls: string[] })
        .credentialCalls,
  );
  expect(
    calls.filter((command) =>
      command.endsWith('management_credentials'),
    ),
  ).toEqual([]);
});

test('settings modal adapts its columns, scrolls and restores focus on close', async ({
  page,
}, testInfo) => {
  const dialog = page.getByRole('dialog', {
    name: 'Settings',
    exact: true,
  });
  const data = await dialog
    .getByRole('heading', { name: 'Data source', exact: true })
    .boundingBox();
  const credentials = await dialog
    .getByRole('heading', { name: 'Proxy credentials', exact: true })
    .boundingBox();
  expect(credentials!.x).toBeGreaterThan(data!.x + 250);
  await expect(
    dialog.getByRole('button', { name: 'Done', exact: true }),
  ).toBeInViewport();
  await expect(dialog).toHaveCSS('opacity', '1');
  await page.screenshot({
    path: testInfo.outputPath('settings-desktop.png'),
  });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Open settings', exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 390, height: 740 });
  await page
    .getByRole('button', { name: 'Open settings', exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('button', {
      name: 'Close settings',
      exact: true,
    }),
  ).toBeInViewport();
  await expect(
    dialog.getByRole('button', { name: 'Done', exact: true }),
  ).toBeInViewport();
  const viewport = dialog
    .getByRole('region', {
      name: 'Settings preferences',
      exact: true,
    })
    .locator('[data-radix-scroll-area-viewport]');
  expect(
    await viewport.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  await dialog
    .getByLabel('GitHub token (optional)')
    .scrollIntoViewIfNeeded();
  await expect(
    dialog.getByLabel('GitHub token (optional)'),
  ).toBeInViewport();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await expect(dialog).toHaveCSS('opacity', '1');
  await page.screenshot({
    path: testInfo.outputPath('settings-mobile.png'),
  });
  await dialog
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
});

test('switching modes isolates credentials and live mode uses the vault', async ({
  page,
}) => {
  await page
    .getByLabel('Username', { exact: true })
    .fill('mock-user');
  await page
    .getByLabel('Password', { exact: true })
    .fill('mock-password');
  await page
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await page.locator('#data-source-mode').click();
  await expect(
    page.getByLabel('Username', { exact: true }),
  ).toHaveValue('live-user');
  await expect(
    page.getByText(
      'Saved credentials are protected by Windows Credential Manager.',
      { exact: false },
    ),
  ).toBeVisible();
  await page
    .getByLabel('Password', { exact: true })
    .fill('updated-live-password');
  await page
    .getByRole('button', { name: 'Update', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { credentialCalls: string[] })
            .credentialCalls,
      ),
    )
    .toContain('save_management_credentials');
  await page.locator('#data-source-mode').click();
  await expect(
    page.getByLabel('Username', { exact: true }),
  ).toHaveValue('mock-user');
  await expect(
    page.getByLabel('Password', { exact: true }),
  ).toHaveValue('mock-password');
  await page
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await page.locator('#data-source-mode').click();
  await expect(
    page.getByLabel('Username', { exact: true }),
  ).toHaveValue('live-user');
  await expect(
    page.getByLabel('Password', { exact: true }),
  ).toHaveValue('updated-live-password');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { credentialCalls: string[] })
          .credentialCalls,
    ),
  ).not.toContain('delete_management_credentials');
});
