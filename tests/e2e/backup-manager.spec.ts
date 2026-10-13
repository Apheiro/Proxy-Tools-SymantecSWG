import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<string, number>();
    let callbackId = 0;
    let running = false;
    const records = [
      {
        id: 'backup-DUMMY-1',
        appliance: 'DUMMY-SWG-001',
        address: '127.0.0.1',
        createdAt: '2026-10-13T12:00:00Z',
        mode: 'unencrypted',
        mocked: true,
        bytes: 2_000_000,
        warning: null,
      },
      {
        id: 'backup-DUMMY-2',
        appliance: 'OTHER-SWG',
        address: '127.0.0.1',
        createdAt: '2026-10-13T11:00:00Z',
        mode: 'encrypted',
        mocked: true,
        bytes: 30,
        warning: null,
      },
    ];
    const status = () => ({
      running,
      id: running ? 'backup-running' : '',
      destination: '127.0.0.1:2222',
      phase: running ? 'Capturing configuration' : 'Disconnected',
      actions: running
        ? [
            'Connect SSH to 127.0.0.1:2222',
            'enable',
            'show configuration expanded noprompts',
          ]
        : [],
      bytes: 0,
      error: null,
      warning: null,
    });
    localStorage.setItem('data-source-mode', JSON.stringify('mock'));
    localStorage.setItem(
      'mock-management-credentials',
      JSON.stringify({
        username: 'test-user',
        password: 'test!\\*&$\'" ñ password',
      }),
    );
    localStorage.setItem(
      'proxies',
      JSON.stringify([
        {
          hostname: 'DUMMY-SWG-001',
          primary_address: '192.0.2.10',
          hostinfo: { ip: '192.0.2.10', hostname: 'DUMMY-SWG-001' },
        },
      ]),
    );
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: 'main' },
          currentWebview: { label: 'main' },
        },
        transformCallback: (callback: (event: unknown) => void) => {
          callbacks.set(++callbackId, callback);
          return callbackId;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (
          command: string,
          args: Record<string, unknown> = {},
        ) => {
          switch (command) {
            case 'read_management_credentials':
              return {
                username: 'test-user',
                password: 'test!\\*&$\'" ñ password',
              };
            case 'plugin:window|is_maximized':
              return false;
            case 'plugin:event|listen':
              listeners.set(
                args.event as string,
                args.handler as number,
              );
              return callbackId;
            case 'plugin:event|unlisten':
              return;
            case 'list_backups':
              return records.map((record) => ({ ...record }));
            case 'delete_backup': {
              const index = records.findIndex(
                (record) => record.id === args.id,
              );
              if (index < 0) throw new Error('Backup not found.');
              records.splice(index, 1);
              Object.assign(window, { deletedBackup: args.id });
              return;
            }
            case 'open_backup_folder':
              Object.assign(window, { backupFolderOpened: true });
              return;
            case 'get_backup_status':
              return status();
            case 'read_backup':
              return args.id === 'backup-DUMMY-1'
                ? 'FIRST-LINE\n' +
                    'configuration entry\n'.repeat(50_000) +
                    'LAST-LINE-PRIVATE-KEY'
                : 'SECOND-BACKUP-CONTENT';
            case 'start_backup': {
              Object.assign(window, { backupRequest: args.request });
              running = true;
              callbacks.get(listeners.get('backup:status')!)?.({
                event: 'backup:status',
                id: 1,
                payload: status(),
              });
              return 'backup-running';
            }
            default:
              return;
          }
        },
      },
    });
  });
  await page.goto('/Diagnostics/BackupManager?proxy=192.0.2.10');
  await expect(
    page.getByRole('heading', { name: 'Backup Manager' }),
  ).toBeVisible({ timeout: 15_000 });
});

test('large preview is virtualized, reaches the final line and switches backups', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: /DUMMY-SWG-001.*Unencrypted/ })
    .click();
  const preview = page.getByRole('region', {
    name: 'Complete backup content',
  });
  await expect(
    preview.getByText('FIRST-LINE', { exact: true }),
  ).toBeVisible();
  expect(await preview.locator('div.absolute').count()).toBeLessThan(
    100,
  );
  await preview.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    preview.getByText('LAST-LINE-PRIVATE-KEY', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: /OTHER-SWG.*Encrypted/ })
    .click();
  await expect(
    preview.getByText('SECOND-BACKUP-CONTENT', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Unencrypted private keys'),
  ).toHaveCount(1);
});

test('uses stored credentials and mock mode without prompting and shows process state', async ({
  page,
}) => {
  const button = page.getByRole('button', { name: 'Create backup' });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(
    page.getByText('Capturing configuration', { exact: true }),
  ).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(
    page.getByText('show configuration expanded noprompts', {
      exact: true,
    }),
  ).toBeVisible();
  const request = await page.evaluate(
    () =>
      (window as unknown as { backupRequest: unknown }).backupRequest,
  );
  expect(request).toMatchObject({
    appliance: 'DUMMY-SWG-001',
    address: '192.0.2.10',
    username: 'test-user',
    password: 'test!\\*&$\'" ñ password',
    mocked: true,
    mode: 'encrypted',
  });
});

test('opens the backup folder and confirms deletion before updating list and preview', async ({
  page,
}) => {
  await expect(
    page
      .getByRole('region', { name: 'Complete backup content' })
      .getByText('FIRST-LINE', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('backup-manager-desktop.png'),
  });
  await page
    .getByRole('button', { name: 'Open backup folder' })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { backupFolderOpened: boolean })
            .backupFolderOpened,
      ),
    )
    .toBe(true);
  const remove = page.getByRole('button', {
    name: /^Delete backup DUMMY-SWG-001/,
  });
  await remove.click();
  const dialog = page.getByRole('alertdialog');
  await expect(
    dialog.getByText('Delete backup?', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(remove).toBeVisible();
  await remove.click();
  await dialog
    .getByRole('button', { name: 'Delete backup', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(remove).toHaveCount(0);
  await expect(
    page
      .getByRole('region', { name: 'Complete backup content' })
      .getByText('SECOND-BACKUP-CONTENT', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { deletedBackup: string })
          .deletedBackup,
    ),
  ).toBe('backup-DUMMY-1');
  await page
    .getByRole('button', { name: /^Delete backup OTHER-SWG/ })
    .click();
  await dialog
    .getByRole('button', { name: 'Delete backup', exact: true })
    .click();
  await expect(
    page.getByText('No backups yet', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('No backup selected', { exact: true }),
  ).toBeVisible();
});
