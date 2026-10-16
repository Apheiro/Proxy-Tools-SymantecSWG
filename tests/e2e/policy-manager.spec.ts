import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('data-source-mode', JSON.stringify('mock'));
    localStorage.setItem(
      'mock-management-credentials',
      JSON.stringify({
        username: 'fixture',
        password: 'fixture-only',
      }),
    );
    localStorage.setItem(
      'proxies',
      JSON.stringify(
        ['a', 'b', 'c'].map((id) => ({
          hostname: `proxy-${id}`,
          registered_address: `${id}.example`,
          primary_address: `${id}.example`,
          hostinfo: { hostname: `proxy-${id}`, ip: `${id}.example` },
        })),
      ),
    );
    const settings = {
      centralEnabled: false,
      directEnabled: true,
      hasPassword: false,
      central: {
        host: 'central.example',
        port: 22,
        path: '/srv/local.cpl',
        username: 'fixture',
        shell: 'posix',
      },
    };
    const original =
      '; preserve comment\n<Proxy>\nurl.domain=example.com allow\n';
    const other =
      '; manual change\n<Proxy>\nurl.domain=example.org deny\n';
    const health = {
      healthy: true,
      issues: [],
      warnings: ['Structural checks only.'],
    };
    let progress = null;
    const calls = [];
    Object.assign(window, {
      policyCalls: calls,
      __TAURI_INTERNALS__: {
        invoke: async (command, args) => {
          calls.push({ command, args });
          if (command === 'get_policy_settings')
            return structuredClone(settings);
          if (command === 'save_policy_settings') {
            Object.assign(settings, args.settings);
            return;
          }
          if (command === 'get_policy_progress') return progress;
          if (command === 'inspect_policies')
            return {
              id: 'scan',
              mocked: true,
              inspectedAt: '2026-10-16T12:00:00Z',
              majority: 'same',
              rows: args.targets.map((target, i) => ({
                target,
                fingerprint: i === 2 ? 'different' : 'same',
                health,
                error: null,
              })),
            };
          if (
            command === 'read_policy_snapshot' &&
            localStorage.getItem('policy-many-rules')
          )
            return (
              '<Proxy>\n' +
              Array.from(
                { length: 20000 },
                (_, i) => `url.domain=sample-${i}.example allow\n`,
              ).join('')
            );
          if (
            command === 'read_policy_snapshot' &&
            localStorage.getItem('policy-many-objects')
          )
            return (
              '<Proxy>\ncondition=Clients allow\ndefine condition Clients\n' +
              Array.from(
                { length: 20000 },
                (_, i) => `url.domain=object-${i}.example\n`,
              ).join('') +
              'end\n'
            );
          if (command === 'read_policy_snapshot')
            return args.targetId === 'c.example' ? other : original;
          if (
            command === 'compare_policy_text' &&
            localStorage.getItem('policy-large-diff')
          )
            return Array.from({ length: 20000 }, (_, i) => ({
              kind: 'equal',
              oldLine: i + 1,
              newLine: i + 1,
              text: `; fixture-line-${i + 1}`,
            }));
          if (command === 'compare_policy_text')
            return [
              {
                kind: 'equal',
                oldLine: 1,
                newLine: 1,
                text: '; preserve comment',
              },
              {
                kind: 'delete',
                oldLine: 3,
                newLine: null,
                text: args.old,
              },
              {
                kind: 'insert',
                oldLine: null,
                newLine: 3,
                text: args.new,
              },
            ];
          if (command === 'read_central_policy')
            return {
              id: 'central-document',
              content: original.replace(/\n/g, '\r\n'),
              health,
            };
          if (command === 'save_central_policy') {
            if (localStorage.getItem('simulate-policy-conflict'))
              throw 'Remote file changed. Reload and compare before saving.';
            return {
              id: 'central-document',
              content: args.draft,
              health,
            };
          }
          if (command === 'distribute_policy')
            return (progress = {
              id: 'job',
              mocked: true,
              running: true,
              rows: args.request.targetIds.map((id) => ({
                id,
                name: id,
                status: 'pending',
                message: 'Waiting for all-proxy preflight.',
              })),
            });
          return null;
        },
      },
    });
  });
});

test('third workspace inspects all proxies, excludes discrepancies and requires review', async ({
  page,
}) => {
  await page.goto('/policy');
  await expect(
    page.getByRole('link', {
      name: 'Local Policy Manager',
      exact: true,
    }),
  ).toHaveAttribute('aria-current', 'page');
  await page
    .getByRole('button', { name: 'Inspect all', exact: true })
    .click();
  await expect(
    page.getByText('2 in majority · 1 excluded'),
  ).toBeVisible();
  await expect(
    page.getByLabel('Distribute to proxy-c'),
  ).toBeDisabled();
  await expect(
    page.getByLabel('Distribute to proxy-a'),
  ).toBeChecked();
  await page
    .getByRole('combobox', { name: 'Reference source' })
    .click();
  await page
    .getByRole('option', { name: 'proxy-a · majority' })
    .click();
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  await page
    .getByRole('textbox', { name: 'CPL source' })
    .fill(
      '; preserve comment\n<Proxy>\nurl.domain=example.com deny\n',
    );
  await page.screenshot({
    path: test.info().outputPath('policy-workspace.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Review & distribute (2)' })
    .click();
  const modal = page.getByRole('dialog');
  await expect(modal).toContainText('proxy-a, proxy-b');
  await expect(
    modal.getByRole('button', {
      name: 'Apply complete Local Policy',
    }),
  ).toBeDisabled();
  await modal.getByRole('checkbox').check();
  await modal
    .getByRole('button', { name: 'Apply complete Local Policy' })
    .click();
  await expect(
    page.getByText('Distribution in progress'),
  ).toBeVisible();
  const request = await page.evaluate(
    () =>
      (window as any).policyCalls.find(
        (c) => c.command === 'distribute_policy',
      ).args.request,
  );
  expect(request.targetIds).toEqual(['a.example', 'b.example']);
  expect(request.draft).toContain('\n<Proxy>\n');
  expect(request.mocked).toBe(true);
  expect(request.repair).toBe(false);
});

test('central mode is opt-in, saves separate mock credentials and keeps a conflicting draft', async ({
  page,
}) => {
  await page.goto('/policy');
  await expect(
    page.getByRole('button', { name: 'Central file · disabled' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page
    .getByRole('switch', { name: 'Central SSH file editing' })
    .check();
  await page
    .getByLabel('Central SSH password', { exact: true })
    .fill('mock-central-only');
  await page
    .getByRole('button', { name: 'Save policy settings' })
    .click();
  await expect(
    page.getByLabel('Central SSH password', { exact: true }),
  ).toHaveValue('');
  await page
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Central file', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Read remote file' })
    .click();
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  await expect(
    page.getByRole('textbox', { name: 'CPL source' }),
  ).toHaveValue(
    '; preserve comment\n<Proxy>\nurl.domain=example.com allow\n',
  );
  await page
    .getByRole('textbox', { name: 'CPL source' })
    .fill(
      '; preserve comment\n<Proxy>\nurl.domain=example.net deny\n',
    );
  await page.evaluate(() =>
    localStorage.setItem('simulate-policy-conflict', 'yes'),
  );
  await page.getByRole('button', { name: 'Review & save' }).click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page
    .getByRole('button', { name: 'Save remote CPL', exact: true })
    .click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Remote file changed' }),
  ).toContainText('Remote file changed');
  await expect(
    page.getByRole('textbox', { name: 'CPL source' }),
  ).toHaveValue(
    '; preserve comment\n<Proxy>\nurl.domain=example.net deny\n',
  );
  const calls = await page.evaluate(
    () => (window as any).policyCalls,
  );
  const settingsCall = calls.find(
    (c) => c.command === 'save_policy_settings',
  );
  expect(settingsCall.args.password).toBeNull();
  const saveCall = calls.find(
    (c) => c.command === 'save_central_policy',
  );
  expect(saveCall.args.mockPassword).toBe('mock-central-only');
  expect(calls.some((c) => c.command === 'distribute_policy')).toBe(
    false,
  );
  await page
    .getByRole('button', { name: 'Compare remote & draft' })
    .click();
  await page
    .getByRole('button', { name: 'Use latest baseline · keep draft' })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'CPL source' }),
  ).toHaveValue(
    '; preserve comment\n<Proxy>\nurl.domain=example.net deny\n',
  );
});

test('individual discrepancy replacement is explicitly separate from bulk distribution', async ({
  page,
}) => {
  await page.goto('/policy');
  await page
    .getByRole('button', { name: 'Inspect all', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Reference source' })
    .click();
  await page
    .getByRole('option', { name: 'proxy-a · majority' })
    .click();
  await page
    .getByRole('button', { name: 'Review individual replacement' })
    .click();
  const modal = page.getByRole('dialog');
  await expect(modal).toContainText('proxy-c');
  await expect(modal).toContainText('outside the bulk selection');
  await modal.getByRole('checkbox').check();
  await modal
    .getByRole('button', { name: 'Apply complete Local Policy' })
    .click();
  await expect(
    page.getByText('Distribution in progress'),
  ).toBeVisible();
  const request = await page.evaluate(
    () =>
      (window as any).policyCalls.find(
        (c) => c.command === 'distribute_policy',
      ).args.request,
  );
  expect(request.targetIds).toEqual(['c.example']);
  expect(request.repair).toBe(true);
});

test('reference override previews destination differences and virtualizes long diffs', async ({
  page,
}) => {
  await page.goto('/policy');
  await page
    .getByRole('button', { name: 'Inspect all', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Reference source' })
    .click();
  await page
    .getByRole('option', { name: 'proxy-c · differs / review' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Review & distribute (2)' }),
  ).toBeDisabled();
  await page
    .getByRole('checkbox', { name: /Explicitly use this proxy/ })
    .check();
  await page
    .getByRole('button', { name: 'Review & distribute (2)' })
    .click();
  await expect(page.getByRole('dialog')).toContainText(
    'Explicit reference override enabled.',
  );
  const comparison = await page.evaluate(
    () =>
      (window as any).policyCalls
        .filter((c) => c.command === 'compare_policy_text')
        .at(-1).args,
  );
  expect(comparison.old).toContain('url.domain=example.com allow');
  expect(comparison.new).toContain('url.domain=example.org deny');
  await page
    .getByRole('button', { name: 'Close replacement preview' })
    .click();
  await page.evaluate(() =>
    localStorage.setItem('policy-large-diff', 'yes'),
  );
  await page
    .getByRole('button', { name: 'Review & distribute (2)' })
    .click();
  const region = page.getByRole('region', {
    name: 'Policy comparison',
    exact: true,
  });
  await expect(
    region.getByText('; fixture-line-1', { exact: true }),
  ).toBeVisible();
  expect(await region.locator('.absolute').count()).toBeLessThan(100);
  await region.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    region.getByText('; fixture-line-20000', { exact: false }),
  ).toBeVisible();
});

test('visual mode is default, inspection is above it, and editing preserves the same source draft', async ({
  page,
}) => {
  await page.goto('/policy');
  await expect(
    page.getByRole('switch', { name: 'Edit CPL source' }),
  ).not.toBeChecked();
  await page
    .getByRole('button', { name: 'Inspect all', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Reference source' })
    .click();
  await page
    .getByRole('option', { name: 'proxy-a · majority' })
    .click();
  const inspection = await page
    .getByRole('heading', { name: 'Proxy inspection', exact: true })
    .boundingBox();
  const visual = await page
    .getByRole('heading', {
      name: 'Visual policy editor',
      exact: true,
    })
    .boundingBox();
  expect(visual!.y).toBeGreaterThan(inspection!.y);
  await page
    .getByRole('button', { name: 'Edit rule at line 3', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByText('Advanced CPL expressions', { exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'allow', exact: true })
    .click();
  await dialog
    .getByRole('textbox', { name: 'CPL gesture name', exact: true })
    .fill('deny');
  await dialog
    .getByRole('button', { name: 'Apply expression', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Save to draft', exact: true })
    .click();
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  const source = page.getByRole('textbox', { name: 'CPL source' });
  await expect(source).toHaveValue(
    '; preserve comment\n<Proxy>\nurl.domain=example.com deny\n',
  );
  await expect(page.getByRole('note')).toContainText(
    'Manual changes can diverge',
  );
  await source.fill(
    '; preserve comment\n<Proxy>\nurl.domain=example.net deny\n',
  );
  await page
    .getByRole('switch', { name: 'Edit CPL source' })
    .uncheck();
  await expect(page.getByRole('note')).toContainText(
    'contains manual source edits',
  );
  await expect(
    page.getByRole('button', {
      name: 'Edit rule at line 3',
      exact: true,
    }),
  ).toContainText('example.net');
  await page
    .getByRole('heading', {
      name: 'Visual policy editor',
      exact: true,
    })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath('visual-editor.png'),
  });
  await page
    .getByRole('button', {
      name: 'Disable rule at line 3',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Enable rule at line 3',
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Enable rule at line 3',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', { name: 'Undo', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Enable rule at line 3',
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Redo', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Disable rule at line 3',
      exact: true,
    }),
  ).toBeVisible();
});

test('condition objects are composed visually and their references are available in rules', async ({
  page,
}) => {
  await page.goto('/policy');
  await page
    .getByRole('button', { name: 'Inspect all', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Reference source' })
    .click();
  await page
    .getByRole('option', { name: 'proxy-a · majority' })
    .click();
  await page
    .getByRole('button', { name: 'Add object', exact: true })
    .click();
  let dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Object name', exact: true })
    .fill('OfficeClients');
  await dialog
    .getByRole('textbox', {
      name: 'Client IP / subnet',
      exact: true,
    })
    .fill('192.0.2.0/24');
  await dialog
    .getByRole('button', { name: 'Add criterion', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Add alternative row', exact: true })
    .click();
  await dialog
    .getByRole('textbox', {
      name: 'Client IP / subnet',
      exact: true,
    })
    .fill('198.51.100.0/24');
  await dialog
    .getByRole('button', { name: 'Add criterion', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Save to draft', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Objects (1)', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'OfficeClients', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Rules', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add rule', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Object type', exact: true })
    .click();
  await page
    .getByRole('option', {
      name: 'Existing condition object',
      exact: true,
    })
    .click();
  await dialog
    .getByRole('combobox', { name: 'Reusable object', exact: true })
    .click();
  await page
    .getByRole('option', { name: /OfficeClients · 2 alternatives/ })
    .click();
  await dialog
    .getByRole('button', { name: 'Add criterion', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Save to draft', exact: true })
    .click();
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  await expect(
    page.getByRole('textbox', { name: 'CPL source' }),
  ).toHaveValue(
    '; preserve comment\n<Proxy>\nurl.domain=example.com allow\n    condition=OfficeClients\n\ndefine condition OfficeClients\n    client.address=192.0.2.0/24\n    client.address=198.51.100.0/24\nend\n',
  );
});

test('large visual rule tables and condition object bodies render only a scroll window', async ({
  page,
}) => {
  await page.goto('/policy');
  await page.evaluate(() =>
    localStorage.setItem('policy-many-rules', 'yes'),
  );
  await page
    .getByRole('button', { name: 'Inspect all', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Reference source' })
    .click();
  await page
    .getByRole('option', { name: 'proxy-a · majority' })
    .click();
  const rules = page.getByRole('region', {
    name: 'Policy rules',
    exact: true,
  });
  await expect(
    rules.getByRole('button', {
      name: 'Edit rule at line 2',
      exact: true,
    }),
  ).toBeVisible();
  expect(await rules.getByRole('listitem').count()).toBeLessThan(100);
  await rules.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    rules.getByRole('button', {
      name: 'Edit rule at line 20001',
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(() => {
    localStorage.removeItem('policy-many-rules');
    localStorage.setItem('policy-many-objects', 'yes');
  });
  await page
    .getByRole('button', { name: 'Inspect all', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Reference source' })
    .click();
  await page
    .getByRole('option', { name: 'proxy-a · majority' })
    .click();
  await page
    .getByRole('button', { name: 'Objects (1)', exact: true })
    .click();
  const objects = page.getByRole('region', {
    name: 'Reusable policy objects',
    exact: true,
  });
  await expect(
    objects.getByRole('heading', { name: 'Clients', exact: true }),
  ).toBeVisible();
  expect(await objects.getByRole('listitem').count()).toBeLessThan(
    100,
  );
  await objects.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    objects.getByRole('button', {
      name: 'url.domain=object-19999.example',
      exact: true,
    }),
  ).toBeVisible();
});

test('new policy starts empty without SSH, supports visual creation and exports CPL', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem('mock-management-credentials');
    localStorage.setItem('proxies', '[]');
  });
  await page.goto('/policy');
  await page
    .getByRole('button', { name: 'New policy', exact: true })
    .click();
  await expect(
    page.getByRole('switch', { name: 'Edit CPL source' }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Export CPL' }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Add layer', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save to draft' })
    .click();
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  const source = page.getByRole('textbox', { name: 'CPL source' });
  await expect(source).toHaveValue(/<Proxy>/);
  const content = await source.inputValue();
  expect(content).not.toMatch(/\ballow\b|\bdeny\b/);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CPL' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('local-policy.cpl');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe(content);
  const commands = await page.evaluate(() =>
    (window as any).policyCalls.map((c) => c.command),
  );
  expect(commands).not.toContain('inspect_policies');
  expect(commands).not.toContain('read_policy_snapshot');
  expect(commands).not.toContain('read_central_policy');
  expect(commands).not.toContain('distribute_policy');
});

test('inspection preserves a new draft and distribution still excludes minority proxies', async ({
  page,
}) => {
  const text = '<Proxy>\nurl.domain=new.example deny\n';
  await page.goto('/policy');
  await page
    .getByRole('button', { name: 'New policy', exact: true })
    .click();
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  const source = page.getByRole('textbox', { name: 'CPL source' });
  await source.fill(text);
  await page
    .getByRole('button', { name: 'Inspect all', exact: true })
    .click();
  await expect(source).toHaveValue(text);
  await expect(
    page.getByLabel('Distribute to proxy-c'),
  ).toBeDisabled();
  await page
    .getByRole('combobox', { name: 'Validation baseline' })
    .click();
  await page
    .getByRole('option', { name: 'proxy-b · majority' })
    .click();
  await expect(source).toHaveValue(text);
  await page
    .getByRole('button', { name: 'Review & distribute (2)' })
    .click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page
    .getByRole('button', { name: 'Apply complete Local Policy' })
    .click();
  await expect(
    page.getByText('Distribution in progress'),
  ).toBeVisible();
  const request = await page.evaluate(
    () =>
      (window as any).policyCalls.find(
        (c) => c.command === 'distribute_policy',
      ).args.request,
  );
  expect(request.draft).toBe(text);
  expect(request.sourceId).toBe('b.example');
  expect(request.targetIds).toEqual(['a.example', 'b.example']);
  expect(request.forceSource).toBe(false);
});

test('creating another policy requires explicit confirmation before discarding edits', async ({
  page,
}) => {
  await page.goto('/policy');
  await page
    .getByRole('button', { name: 'New policy', exact: true })
    .click();
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  await page
    .getByRole('textbox', { name: 'CPL source' })
    .fill('<Proxy>\ndeny\n');
  await page
    .getByRole('button', { name: 'New policy', exact: true })
    .click();
  await page.getByRole('button', { name: 'Keep draft' }).click();
  await expect(
    page.getByRole('textbox', { name: 'CPL source' }),
  ).toHaveValue('<Proxy>\ndeny\n');
  await page
    .getByRole('button', { name: 'New policy', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Discard & create' })
    .click();
  await expect(
    page.getByRole('switch', { name: 'Edit CPL source' }),
  ).not.toBeChecked();
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  await expect(
    page.getByRole('textbox', { name: 'CPL source' }),
  ).toHaveValue('');
  await expect(
    page.getByRole('button', { name: /Review & distribute/ }),
  ).toBeDisabled();
});

test('new central policy obtains a remote baseline at review without importing its rules', async ({
  page,
}) => {
  await page.goto('/policy');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page
    .getByRole('switch', { name: 'Central SSH file editing' })
    .check();
  await page
    .getByLabel('Central SSH password', { exact: true })
    .fill('mock-central-only');
  await page
    .getByRole('button', { name: 'Save policy settings' })
    .click();
  await page
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Central file', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'New policy', exact: true })
    .click();
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  const text = '<Proxy>\nurl.domain=new.example deny\n';
  await page.getByRole('textbox', { name: 'CPL source' }).fill(text);
  expect(
    await page.evaluate(() =>
      (window as any).policyCalls.some(
        (c) => c.command === 'read_central_policy',
      ),
    ),
  ).toBe(false);
  await page.getByRole('button', { name: 'Review & save' }).click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page
    .getByRole('button', { name: 'Save remote CPL', exact: true })
    .click();
  await expect(
    page.getByText('Remote CPL saved and verified.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('switch', { name: 'Edit CPL source' }),
  ).not.toBeChecked();
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  await expect(
    page.getByRole('textbox', { name: 'CPL source' }),
  ).toHaveValue(text);
  const calls = await page.evaluate(
    () => (window as any).policyCalls,
  );
  const diff = calls.find(
    (c) => c.command === 'compare_policy_text',
  ).args;
  expect(diff.old).toContain('url.domain=example.com allow');
  expect(diff.new).toBe(text);
  const save = calls.find(
    (c) => c.command === 'save_central_policy',
  ).args;
  expect(save.documentId).toBe('central-document');
  expect(save.draft).toBe(text);
});

test('typed rule editor builds client destination decision without CPL gestures', async ({
  page,
}) => {
  await page.goto('/policy');
  await page
    .getByRole('button', { name: 'New policy', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add layer', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Save to draft', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add rule', exact: true })
    .click();
  let dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Client IP / subnet', exact: true })
    .fill('192.0.2.10');
  await dialog
    .getByRole('button', { name: 'Add criterion', exact: true })
    .click();
  await dialog
    .getByRole('button', {
      name: 'Destination criteria',
      exact: true,
    })
    .click();
  await dialog
    .getByRole('textbox', { name: 'Domain', exact: true })
    .fill('example.com');
  await dialog
    .getByRole('button', { name: 'Add criterion', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Action criteria', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Add criterion', exact: true })
    .click();
  await page.screenshot({
    path: test.info().outputPath('typed-rule-builder.png'),
    fullPage: true,
  });
  await dialog
    .getByRole('button', { name: 'Save to draft', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('typed-policy-table.png'),
    fullPage: true,
  });
  await expect(
    page.getByRole('button', { name: /Edit Source at line/ }),
  ).toContainText('192.0.2.10');
  await expect(
    page.getByRole('button', { name: /Edit Destination at line/ }),
  ).toContainText('example.com');
  await page
    .getByRole('button', { name: /Edit Destination at line/ })
    .click();
  dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', {
      name: 'Destination criteria',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await dialog
    .getByRole('button', { name: 'Close visual editor dialog' })
    .click();
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  await expect(
    page.getByRole('textbox', { name: 'CPL source' }),
  ).toHaveValue(
    /client.address=192.0.2.10 url.domain=example.com allow/,
  );
});

test('shared JSON import and export keep CPL intact without connecting to an appliance', async ({
  page,
}) => {
  await page.goto('/policy');
  const text = '; shared\n<Proxy>\nurl.domain=shared.example allow\n';
  await page.getByLabel('Import policy file').setInputFiles({
    name: 'team.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'proxytools-policy',
        version: 1,
        cpl: text,
      }),
    ),
  });
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  await expect(
    page.getByRole('textbox', { name: 'CPL source' }),
  ).toHaveValue(text);
  const waiting = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export shared JSON', exact: true })
    .click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe('local-policy.json');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString()).cpl).toBe(text);
  expect(
    await page.evaluate(() =>
      (window as any).policyCalls.some((c) =>
        [
          'inspect_policies',
          'read_central_policy',
          'distribute_policy',
        ].includes(c.command),
      ),
    ),
  ).toBe(false);
});

test('bulk object editor changes hundreds of entries with shared-use acknowledgement', async ({
  page,
}) => {
  await page.goto('/policy');
  const entries = Array.from(
    { length: 500 },
    (_, i) => `url.domain=host-${i}.example`,
  ).join('\n');
  const text = `<Proxy>\ncondition=Hosts allow\ndefine condition Hosts\n; original comment\n${entries}\nend condition Hosts\n`;
  await page.getByLabel('Import policy file').setInputFiles({
    name: 'list.cpl',
    mimeType: 'text/plain',
    buffer: Buffer.from(text),
  });
  await page
    .getByRole('button', { name: 'Objects (1)', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Edit list', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', { name: 'Save object draft' }),
  ).toBeDisabled();
  await dialog
    .getByRole('textbox', { name: 'Object entries' })
    .fill('replacement.example\nsecond.example');
  await dialog.getByRole('checkbox').check();
  await dialog
    .getByRole('button', { name: 'Save object draft' })
    .click();
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  const result = await page
    .getByRole('textbox', { name: 'CPL source' })
    .inputValue();
  expect(result).toContain(
    '; original comment\nurl.domain=replacement.example\nurl.domain=second.example\nend condition Hosts',
  );
  expect(result).not.toContain('host-499.example');
});

test('new large condition lists and nested object logic stay editable without raw CPL', async ({
  page,
}) => {
  await page.goto('/policy');
  await page
    .getByRole('button', { name: 'New policy', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add object', exact: true })
    .click();
  let dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Object name', exact: true })
    .fill('TeamDomains');
  await dialog
    .getByRole('checkbox', {
      name: 'Paste a list of values (one alternative per line)',
      exact: true,
    })
    .check();
  await dialog
    .getByRole('textbox', { name: 'Values', exact: true })
    .fill('one.example\ntwo.example\nthree.example');
  await dialog
    .getByRole('button', { name: 'Save to draft', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add layer', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Save to draft', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add rule', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Object type', exact: true })
    .click();
  await page
    .getByRole('option', {
      name: 'Existing condition object',
      exact: true,
    })
    .click();
  await dialog
    .getByRole('combobox', { name: 'Reusable object', exact: true })
    .click();
  await page
    .getByRole('option', {
      name: 'TeamDomains · 3 alternatives',
      exact: true,
    })
    .click();
  await expect(
    dialog.getByRole('region', {
      name: 'Condition logic for TeamDomains',
    }),
  ).toContainText('one.example');
  await dialog
    .getByRole('button', { name: 'Add criterion', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Save to draft', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /Edit Destination at line/ }),
  ).toContainText('TeamDomains');
});

test('object rename updates usages and its named terminator', async ({
  page,
}) => {
  await page.goto('/policy');
  const text =
    '<Proxy>\ncondition=Old allow\ndefine condition Old\nurl.domain=example.com\nend condition Old\n';
  await page.getByLabel('Import policy file').setInputFiles({
    name: 'rename.cpl',
    mimeType: 'text/plain',
    buffer: Buffer.from(text),
  });
  await page
    .getByRole('button', { name: 'Objects (1)', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Edit list', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Operation', exact: true })
    .click();
  await page
    .getByRole('option', {
      name: 'Rename and update active references',
      exact: true,
    })
    .click();
  await dialog
    .getByRole('textbox', { name: 'New object name', exact: true })
    .fill('Renamed');
  await dialog.getByRole('checkbox').check();
  await dialog
    .getByRole('button', { name: 'Save object draft', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Renamed', exact: true }),
  ).toBeVisible();
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  await expect(
    page.getByRole('textbox', { name: 'CPL source' }),
  ).toHaveValue(
    '<Proxy>\ncondition=Renamed allow\ndefine condition Renamed\nurl.domain=example.com\nend condition Renamed\n',
  );
});

test('shared source settings expose JSON over HTTPS and guard web saves', async ({
  page,
}) => {
  await page.goto('/policy');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page
    .getByRole('switch', { name: 'Central SSH file editing' })
    .check();
  await page
    .getByRole('combobox', {
      name: 'Shared source access',
      exact: true,
    })
    .click();
  await page
    .getByRole('option', {
      name: 'HTTPS · read-only direct download',
      exact: true,
    })
    .click();
  await page
    .getByRole('textbox', {
      name: 'Direct HTTPS file URL',
      exact: true,
    })
    .fill('https://files.example/policy.json');
  await page
    .getByRole('combobox', { name: 'File format', exact: true })
    .click();
  await page
    .getByRole('option', {
      name: 'Shared JSON · Proxy Tools version 1',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', { name: 'Save policy settings' })
    .click();
  await page
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Central file', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Read remote file', exact: true })
    .click();
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  await page
    .getByRole('textbox', { name: 'CPL source' })
    .fill('<Proxy>\ndeny\n');
  await expect(
    page.getByRole('button', { name: 'Review & save', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', {
      name: 'Use draft for direct distribution',
      exact: true,
    })
    .click();
  await page.getByRole('switch', { name: 'Edit CPL source' }).check();
  await expect(
    page.getByRole('textbox', { name: 'CPL source' }),
  ).toHaveValue('<Proxy>\ndeny\n');
  const calls = await page.evaluate(
    () => (window as any).policyCalls,
  );
  const saved = calls.find(
    (c) => c.command === 'save_policy_settings',
  ).args.settings;
  expect(saved.central.transport).toBe('https');
  expect(saved.central.format).toBe('project');
  expect(calls.some((c) => c.command === 'save_central_policy')).toBe(
    false,
  );
});
