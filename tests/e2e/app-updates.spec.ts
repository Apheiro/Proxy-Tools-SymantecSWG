import { expect, test, type Page } from '@playwright/test';

async function settings(page: Page) {
  await page
    .getByRole('navigation')
    .getByRole('button')
    .last()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible();
  return page.getByRole('region', { name: 'Application updates' });
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('data-source-mode'))
      localStorage.setItem(
        'data-source-mode',
        JSON.stringify('mock'),
      );
    let id = 0;
    let token: string | null = null;
    const calls: {
      command: string;
      args: Record<string, unknown>;
    }[] = [];
    Object.assign(window, {
      isTauri: true,
      updateCalls: calls,
      failDownload: false,
      noUpdate: false,
      privateRelease: false,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: 'main' },
          currentWebview: { label: 'main' },
        },
        transformCallback: () => ++id,
        unregisterCallback: () => {},
        invoke: async (
          command: string,
          args: Record<string, unknown> = {},
        ) => {
          calls.push({ command, args });
          const fixture = window as unknown as {
            failDownload: boolean;
            noUpdate: boolean;
            privateRelease: boolean;
          };
          switch (command) {
            case 'read_management_credentials':
              return null;
            case 'plugin:window|is_maximized':
              return false;
            case 'plugin:event|listen':
              return ++id;
            case 'has_update_token':
              return token !== null;
            case 'save_update_token':
              token = args.token as string;
              return;
            case 'delete_update_token':
              token = null;
              return;
            case 'check_app_update':
              if (
                fixture.privateRelease &&
                !(args.mocked ? args.mockToken : token)
              )
                throw new Error(
                  'Private repositories require a GitHub token with Contents: Read.',
                );
              return fixture.noUpdate
                ? null
                : {
                    id: 9,
                    version: '0.2.0',
                    currentVersion: '0.1.0',
                    notes:
                      '## Release changes\n- Improved SSH automation\n<script>never execute notes</script>',
                    filename: 'proxytools-v0.2.0-windows-x64.exe',
                    bytes: 1_000_000,
                  };
            case 'download_app_update':
              if (fixture.failDownload)
                throw new Error(
                  'Downloaded executable failed SHA-256 verification.',
                );
              return {
                filename: 'proxytools-v0.2.0-windows-x64.exe',
                path: 'C:\\Users\\Test\\AppData\\Local\\com.apheiros.proxytools\\updates\\proxytools-v0.2.0-windows-x64.exe',
                currentExecutable: 'C:\\ProxyTools\\proxytools.exe',
              };
            case 'open_update_folder':
              Object.assign(window, { updateFolderOpened: true });
              return;
            default:
              return;
          }
        },
      },
    });
  });
  await page.goto('/Diagnostics');
});

test('startup toast opens release notes and verified download instructions', async ({
  page,
}) => {
  const notice = page.getByRole('button', {
    name: /Proxy Tools 0.2.0 is available/,
  });
  await expect(notice).toBeVisible();
  const toaster = notice.locator('xpath=ancestor::ol');
  await expect(toaster).toHaveAttribute('data-y-position', 'bottom');
  await expect(toaster).toHaveAttribute('data-x-position', 'right');
  await notice.click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText(/Improved SSH automation/),
  ).toBeVisible();
  await expect(
    dialog.getByText(/<script>never execute notes<\/script>/),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Download update', exact: true })
    .click();
  await expect(
    dialog.getByRole('heading', { name: 'New executable ready' }),
  ).toBeVisible();
  await expect(
    dialog.getByText('C:\\ProxyTools\\proxytools.exe', {
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Open download folder' })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { updateFolderOpened: boolean })
            .updateFolderOpened,
      ),
    )
    .toBe(true);
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          updateCalls: {
            command: string;
            args: Record<string, unknown>;
          }[];
        }
      ).updateCalls,
  );
  expect(
    calls.find((call) => call.command === 'download_app_update')
      ?.args,
  ).toEqual({ mocked: true, mockToken: null, releaseId: 9 });
  expect(
    calls.some((call) => call.command === 'plugin:window|close'),
  ).toBe(false);
});

test('failed verification leaves a retry button and never shows ready', async ({
  page,
}) => {
  await page.evaluate(() =>
    Object.assign(window, { failDownload: true }),
  );
  await page
    .getByRole('button', { name: /Proxy Tools 0.2.0 is available/ })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('button', { name: 'Download update', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toContainText(
    'SHA-256 verification',
  );
  await expect(
    dialog.getByRole('button', { name: 'Open download folder' }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    Object.assign(window, { failDownload: false }),
  );
  await dialog
    .getByRole('button', { name: 'Download update', exact: true })
    .click();
  await expect(
    dialog.getByRole('heading', { name: 'New executable ready' }),
  ).toBeVisible();
});

test('token profiles remain isolated, persist mocked token and query anonymously after removal', async ({
  page,
}) => {
  const section = await settings(page);
  await expect(
    section.getByText('No token saved for this profile.'),
  ).toBeVisible();
  await section
    .getByLabel('GitHub token (optional)')
    .fill('mock_fixture_token');
  await section
    .getByRole('button', { name: 'Save token', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('mock-github-release-token'),
      ),
    )
    .toBe(JSON.stringify('mock_fixture_token'));
  await expect(
    section.getByLabel('GitHub token (optional)'),
  ).toHaveValue('');
  await page.locator('#data-source-mode').click();
  await expect(
    section.getByText('No token saved for this profile.'),
  ).toBeVisible();
  await section
    .getByLabel('GitHub token (optional)')
    .fill('live_fixture_token');
  await section
    .getByRole('button', { name: 'Save token', exact: true })
    .click();
  await expect(
    section.getByText('A token is saved for this profile.'),
  ).toBeVisible();
  await page.locator('#data-source-mode').click();
  await expect(
    section.getByText('A token is saved for this profile.'),
  ).toBeVisible();
  await page.reload();
  const reloaded = await settings(page);
  await expect(
    reloaded.getByText('A token is saved for this profile.'),
  ).toBeVisible();
  await reloaded
    .getByRole('button', { name: 'Remove token' })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('mock-github-release-token'),
      ),
    )
    .toBeNull();
  await reloaded
    .getByRole('button', { name: 'Check for updates' })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              updateCalls: {
                command: string;
                args: Record<string, unknown>;
              }[];
            }
          ).updateCalls
            .filter((call) => call.command === 'check_app_update')
            .at(-1)?.args,
      ),
    )
    .toEqual({ mocked: true, mockToken: null });
  const calls = await page.evaluate(
    () =>
      (window as unknown as { updateCalls: { command: string }[] })
        .updateCalls,
  );
  expect(
    calls.filter((call) => call.command.endsWith('update_token')),
  ).toEqual([]);
});

test('private access failures and up-to-date status are visible on manual checks', async ({
  page,
}) => {
  await page.evaluate(() =>
    Object.assign(window, { privateRelease: true }),
  );
  const section = await settings(page);
  await section
    .getByRole('button', { name: 'Check for updates' })
    .click();
  await expect(
    page.getByText(/Private repositories require a GitHub token/),
  ).toBeVisible();
  await page.evaluate(() =>
    Object.assign(window, { privateRelease: false, noUpdate: true }),
  );
  await section
    .getByRole('button', { name: 'Check for updates' })
    .click();
  await expect(
    page.getByText('No newer Windows release is ready to download.'),
  ).toBeVisible();
});
