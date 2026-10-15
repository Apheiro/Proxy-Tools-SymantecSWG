import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ]);
  await page.addInitScript(() => {
    localStorage.setItem('data-source-mode', JSON.stringify('mock'));
    localStorage.setItem('home-workspace', 'proxy');
    localStorage.setItem(
      'mock-management-credentials',
      JSON.stringify({
        username: 'test',
        password: 'synthetic-fixture-password',
      }),
    );
    const saved = sessionStorage.getItem('ssh-test-session');
    let session = saved ? JSON.parse(saved) : null;
    const output: Record<string, string> = JSON.parse(
      sessionStorage.getItem('ssh-test-output') ?? '{}',
    );
    let connects = Number(
      sessionStorage.getItem('ssh-test-connects') ?? 0,
    );
    const calls: string[] = [];
    Object.assign(window, {
      isTauri: true,
      sshCalls: calls,
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: 'main' },
          currentWebview: { label: 'main' },
        },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (
          command: string,
          args: {
            id?: string;
            value?: string;
            offset?: number;
            block?: number;
            sensitive?: boolean;
            request?: { mocked: boolean };
          } = {},
        ) => {
          calls.push(command);
          const persist = () => {
            sessionStorage.setItem(
              'ssh-test-session',
              JSON.stringify(session),
            );
            sessionStorage.setItem(
              'ssh-test-output',
              JSON.stringify(output),
            );
          };
          if (command === 'list_ssh_sessions')
            return session
              ? [
                  {
                    ...session,
                    blockCount: session.blocks.length,
                    blocks: session.blocks.slice(-1),
                  },
                ]
              : [];
          if (command === 'get_ssh_session') return session;
          if (command === 'connect_ssh_console') {
            connects++;
            sessionStorage.setItem(
              'ssh-test-connects',
              String(connects),
            );
            session = {
              id: `session-${connects}`,
              appliance: 'test',
              address: '192.0.2.10',
              mocked: args.request?.mocked,
              createdAt: new Date().toISOString(),
              phase: 'Connected',
              connected: true,
              busy: false,
              inputMode: 'command',
              prompt: 'Blue Coat>',
              error: null,
              blocks: [
                {
                  id: 0,
                  command: 'Session started',
                  createdAt: new Date().toISOString(),
                  bytes: 12,
                  complete: true,
                },
              ],
            };
            output[0] = 'Blue Coat> ';
            persist();
            return session.id;
          }
          if (command === 'send_ssh_input') {
            if (session.inputMode === 'secret') {
              output[1] += '\nPrivileged mode enabled.\nBlue Coat# ';
              session.busy = false;
              session.inputMode = 'command';
              session.prompt = 'Blue Coat#';
              session.blocks[1].complete = true;
              session.blocks[1].bytes = output[1].length;
            } else if (!session.busy) {
              const id = session.blocks.length;
              output[id] =
                args.value === 'show large'
                  ? 'configuration entry\n'.repeat(10000)
                  : args.value === 'enable'
                    ? 'Password:'
                    : `Output for ${args.value}\nBlue Coat# `;
              session.blocks.push({
                id,
                command: args.value,
                createdAt: new Date().toISOString(),
                bytes: output[id].length,
                complete: args.value !== 'enable',
              });
              session.busy = args.value === 'enable';
              session.inputMode = session.busy ? 'secret' : 'command';
            }
            persist();
            return null;
          }
          if (command === 'read_ssh_output') {
            const text = output[args.block ?? 0] ?? '';
            const offset = args.offset ?? 0;
            return {
              text: text.slice(offset, offset + 32768),
              nextOffset: Math.min(offset + 32768, text.length),
              total: text.length,
            };
          }
          if (
            command === 'disconnect_ssh_console' ||
            command === 'interrupt_ssh_console'
          ) {
            session.busy = false;
            session.inputMode = command.startsWith('disconnect')
              ? 'closed'
              : 'command';
            if (command.startsWith('disconnect')) {
              session.connected = false;
              session.phase = 'Disconnected';
            }
            persist();
            return;
          }
          if (command === 'remove_ssh_session') {
            session = null;
            sessionStorage.removeItem('ssh-test-session');
            return;
          }
          return null;
        },
      },
    });
  });
});

async function connect(page: import('@playwright/test').Page) {
  await page.goto('/Diagnostics/SSH?proxy=192.0.2.10');
  await page
    .getByRole('button', { name: 'Connect SSH', exact: true })
    .click();
  await expect(
    page.getByLabel('SSH command or response'),
  ).toBeEnabled();
}
async function send(
  page: import('@playwright/test').Page,
  command: string,
) {
  await page.getByLabel('SSH command or response').fill(command);
  await page
    .getByRole('button', { name: 'Send', exact: true })
    .click();
}

test('persistent session supports hidden enable response, history jumps, collapse and copy', async ({
  page,
}) => {
  await connect(page);
  await send(page, 'enable');
  await expect(
    page.getByLabel('SSH password response'),
  ).toHaveAttribute('type', 'password');
  await page
    .getByLabel('SSH password response')
    .fill('synthetic-fixture-password');
  await page
    .getByRole('button', { name: 'Send', exact: true })
    .click();
  await expect(
    page.getByLabel('SSH command or response'),
  ).toBeEnabled();
  await send(page, 'show version');
  await expect(
    page.getByLabel('Command history').getByRole('button'),
  ).toHaveCount(3);
  await expect(page.getByLabel('SSH transcript')).not.toContainText(
    'synthetic-fixture-password',
  );
  await page
    .getByLabel('Command history')
    .getByRole('button', { name: 'enable' })
    .click();
  await expect(page.getByLabel('Output of enable')).toContainText(
    'Privileged mode enabled.',
  );
  await page
    .getByRole('button', { name: 'Collapse enable', exact: true })
    .click();
  await expect(page.getByLabel('Output of enable')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Expand enable', exact: true })
    .click();
  const section = page
    .getByRole('button', { name: 'Collapse enable', exact: true })
    .locator('..');
  await section.getByRole('button', { name: 'Copy output' }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('Privileged mode enabled.');
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Home', exact: true })
    .click();
  await page.goto('/Diagnostics/SSH?proxy=192.0.2.10');
  await expect(
    page.getByLabel('Command history').getByRole('button'),
  ).toHaveCount(3);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('ssh-test-connects'),
    ),
  ).toBe('1');
  await page.screenshot({
    path: '/tmp/proxytools-ssh-desktop.png',
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Disconnect', exact: true })
    .click();
  await expect(
    page.getByLabel('SSH command or response'),
  ).toBeDisabled();
});

test('large output is paged and virtualized and works on narrow screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await connect(page);
  await send(page, 'show large');
  await page
    .getByLabel('Command history')
    .getByRole('button', { name: 'show large' })
    .click();
  const region = page.getByLabel('Output of show large');
  await expect(region).toContainText('configuration entry');
  expect(
    await region.locator('[style*="translateY"]').count(),
  ).toBeLessThan(50);
  const section = page
    .getByRole('button', { name: 'Collapse show large', exact: true })
    .locator('..');
  await section
    .getByRole('button', { name: 'Next', exact: true })
    .click();
  await expect(section).toContainText('Output segment 2');
  await section.getByRole('button', { name: 'Copy output' }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toHaveLength(200000);
  await page.screenshot({
    path: '/tmp/proxytools-ssh-mobile.png',
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('thousands of commands render a bounded history and transcript', async ({
  page,
}) => {
  await connect(page);
  await page.evaluate(() => {
    const session = JSON.parse(
      sessionStorage.getItem('ssh-test-session')!,
    );
    session.blocks = Array.from({ length: 3000 }, (_, id) => ({
      id,
      command: `show fixture-${id}`,
      createdAt: session.createdAt,
      bytes: 0,
      complete: true,
    }));
    sessionStorage.setItem(
      'ssh-test-session',
      JSON.stringify(session),
    );
  });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Command history' }),
  ).toBeVisible();
  expect(
    await page
      .getByLabel('Command history')
      .getByRole('button')
      .count(),
  ).toBeLessThan(25);
  expect(
    await page
      .getByLabel('SSH transcript')
      .getByRole('button', { name: /^Collapse / })
      .count(),
  ).toBeLessThan(10);
  await page
    .getByRole('button', { name: 'Latest', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Collapse show fixture-2999',
      exact: true,
    }),
  ).toBeVisible();
});

test('proxy card actions open the selected appliance SSH route', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'proxies',
      JSON.stringify([
        {
          hostname: 'EDGE-SSH',
          primary_address: '192.0.2.10',
          registered_address: '192.0.2.10',
          active: true,
          pinglog: '',
          nslookup: '',
          last_check: '2026-10-15T12:00:00Z',
          hostinfo: {
            hostname: 'EDGE-SSH',
            ip: '192.0.2.10',
            dnsname: '',
            dnsip: '',
          },
        },
      ]),
    ),
  );
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Proxy actions for EDGE-SSH' })
    .click();
  await page
    .getByRole('menuitem', { name: 'SSH connection' })
    .click();
  await expect(page).toHaveURL('/Diagnostics/SSH?proxy=192.0.2.10');
  await expect(
    page.getByRole('heading', { name: 'SSH console', exact: true }),
  ).toBeVisible();
});
