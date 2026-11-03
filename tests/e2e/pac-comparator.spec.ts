import { expect, test, type Page } from '@playwright/test';
import { comparePacText, rawLines } from '../../src/lib/pacTextDiff';

const originals = [
  'function FindProxyForURL(url, host) {\r\n  return "DIRECT";\r\n}\r\n',
  'function FindProxyForURL(url, host) {\n  return "PROXY edge:8080";\n}\n',
  'function FindProxyForURL(url, host) {\r\n  return "DIRECT";\r\n}\r\n',
];

async function seed(page: Page, count = 3, extra: object[] = []) {
  await page.addInitScript(
    ({ texts, extra }) => {
      localStorage.setItem(
        'data-source-mode',
        JSON.stringify('mock'),
      );
      localStorage.setItem(
        'pac-sources',
        JSON.stringify([
          ...texts.map((downloadedContent, index) => ({
            id: `pac-${index}`,
            name: `File ${index}`,
            url: `http://pac-${index}.test/wpad.dat`,
            rules: [],
            baseRules: [],
            status: 'synced',
            downloadedContent,
            lastSyncedAt: '2026-11-03T00:00:00Z',
          })),
          ...extra,
        ]),
      );
    },
    { texts: originals.slice(0, count), extra },
  );
  await page.goto('/pac');
  await page
    .getByRole('button', { name: 'Comparador de WPAD', exact: true })
    .click();
}

async function choose(page: Page, label: string, name: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name, exact: false }).click();
}

test('literal diff preserves all text, whitespace, BOM, terminators and empty files', () => {
  for (const [left, right] of [
    ['a\r\nb\r\n', 'a\nb\n'],
    [' a\n', 'a\n'],
    ['a\n', 'a'],
    ['', '\n'],
    ['\uFEFFa\r', 'a\r'],
    ['a\tb\n', 'a b\n'],
    ['a\rb\r', 'a\rb'],
    ['one\ntwo\nthree', 'one\nnew\nthree\nlast'],
    ['', ''],
  ]) {
    const blocks = comparePacText(left, right);
    expect(blocks.flatMap((block) => block.left).join('')).toBe(left);
    expect(blocks.flatMap((block) => block.right).join('')).toBe(
      right,
    );
    expect(blocks.some((block) => block.changed)).toBe(
      left !== right,
    );
  }
  expect(rawLines('\n\r\n\r')).toEqual(['\n', '\r\n', '\r']);
});

test('reference stays fixed, all downloads are listed, raw differences can be copied without writes', async ({
  page,
  context,
}) => {
  await context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ]);
  await seed(page);
  const before = await page.evaluate(() =>
    localStorage.getItem('pac-sources'),
  );
  await choose(page, 'Reference file', 'File 0');
  await choose(page, 'Compared file', 'File 1');
  await expect(page.getByLabel('Raw PAC text diff')).toContainText(
    'PROXY edge:8080',
  );
  await expect(page.getByLabel('Raw PAC text diff')).toContainText(
    'CRLF',
  );
  await page
    .getByRole('button', {
      name: 'Copy original reference',
      exact: true,
    })
    .click();
  expect(
    await page.evaluate(() => navigator.clipboard.readText()),
  ).toBe(originals[0]);
  await page
    .getByRole('button', {
      name: 'Copy compared fragment',
      exact: true,
    })
    .first()
    .click();
  expect(
    await page.evaluate(() => navigator.clipboard.readText()),
  ).toBe(originals[1]);
  await page.getByRole('button', { name: 'Next difference' }).click();
  await page
    .getByRole('button', { name: 'Previous difference' })
    .click();
  await choose(page, 'Compared file', 'File 2');
  await expect(
    page.getByLabel('Reference file', { exact: true }),
  ).toContainText('File 0');
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Files are identical' }),
  ).toBeVisible();
  await choose(page, 'Compared file', 'File 0');
  await expect(
    page.getByText('The same file is selected', { exact: false }),
  ).toBeVisible();
  await choose(page, 'Reference file', 'File 1');
  await expect(
    page.getByLabel('Compared file', { exact: true }),
  ).toContainText('File 0');
  expect(
    await page.evaluate(() => localStorage.getItem('pac-sources')),
  ).toBe(before);
});

test('single download and unavailable legacy originals are explained', async ({
  page,
}) => {
  await seed(page, 1, [
    {
      id: 'legacy',
      name: 'Legacy',
      url: 'http://old.test/wpad.dat',
      rules: [],
      baseRules: [],
      lastSyncedAt: '2026-01-01',
      status: 'synced',
    },
  ]);
  await choose(page, 'Reference file', 'File 0');
  await choose(page, 'Compared file', 'Legacy');
  await expect(
    page
      .getByRole('region', {
        name: 'Comparador de WPAD',
        exact: true,
      })
      .getByRole('alert'),
  ).toContainText('Original downloaded text is unavailable');
});

test('one file and zero files do not require entering the add flow', async ({
  page,
}) => {
  await seed(page, 1);
  await expect(
    page.getByText('Only one downloaded file', { exact: false }),
  ).toBeVisible();
});

test('no downloads show an actionable empty state', async ({
  page,
}) => {
  await seed(page, 0);
  await expect(
    page.getByText('No downloaded PAC/WPAD files', { exact: false }),
  ).toBeVisible();
});

test('WPAD uses the shared registration form and retains the exact successful download', async ({
  page,
}) => {
  await page.addInitScript((text) => {
    localStorage.setItem('data-source-mode', JSON.stringify('mock'));
    localStorage.setItem('pac-sources', '[]');
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: { url: string }) => {
          if (command === 'fetch_pac_source')
            return { content: text, finalUrl: args.url, status: 200 };
          return null;
        },
      },
    });
  }, originals[0]);
  await page.goto('/pac');
  const form = page.getByRole('region', {
    name: 'Add a WPAD',
    exact: true,
  });
  await form.getByRole('button', { name: 'Add and load' }).click();
  await expect(
    form.locator('[data-slot="form-message"]'),
  ).toBeVisible();
  await form
    .getByLabel('WPAD or PAC URL')
    .fill('http://wpad.test/wpad.dat');
  await form.getByLabel('Source name').fill('Imported');
  await form.getByLabel('WPAD or PAC URL').press('Enter');
  await expect(page).toHaveURL(/\/pac\/editor\?sourceId=/);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('pac-sources')!)[0]
            ?.downloadedContent,
      ),
    )
    .toBe(originals[0]);
});

test('corrupt downloaded content produces a read error', async ({
  page,
}) => {
  await seed(page, 1, [
    {
      id: 'bad',
      name: 'Unreadable',
      url: 'http://bad.test',
      downloadedContent: 42,
      rules: [],
      baseRules: [],
      status: 'synced',
    },
  ]);
  await choose(page, 'Reference file', 'File 0');
  await choose(page, 'Compared file', 'Unreadable');
  await expect(
    page
      .getByRole('region', {
        name: 'Comparador de WPAD',
        exact: true,
      })
      .getByRole('alert'),
  ).toContainText('Could not read downloaded text');
});

test('multiple differences navigate and fragments preserve literal text', async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ]);
  const left = 'first\nunchanged\nold\nlast\n';
  const right = 'added\nfirst\nunchanged\nnew\nlast\nextra';
  await seed(
    page,
    0,
    [left, right].map((downloadedContent, index) => ({
      id: `diff-${index}`,
      name: `Diff ${index}`,
      url: '',
      rules: [],
      baseRules: [],
      status: 'synced',
      downloadedContent,
    })),
  );
  await choose(page, 'Reference file', 'Diff 0');
  await choose(page, 'Compared file', 'Diff 1');
  const comparator = page.getByRole('region', {
    name: 'Comparador de WPAD',
    exact: true,
  });
  await expect(comparator.getByRole('status')).toContainText(
    '3 differences · 1 / 3',
  );
  await page.getByRole('button', { name: 'Next difference' }).click();
  await expect(comparator.getByRole('status')).toContainText('2 / 3');
  await expect(page.locator('[data-difference="1"]')).toBeFocused();
  await page
    .getByRole('button', { name: 'Copy reference fragment' })
    .click();
  expect(
    await page.evaluate(() => navigator.clipboard.readText()),
  ).toBe('old\n');
  await page
    .getByRole('button', { name: 'Copy compared fragment' })
    .nth(1)
    .click();
  expect(
    await page.evaluate(() => navigator.clipboard.readText()),
  ).toBe('new\n');
  await page
    .getByRole('button', { name: 'Previous difference' })
    .click();
  await expect(comparator.getByRole('status')).toContainText('1 / 3');
  await page.screenshot({
    path: testInfo.outputPath('pac-comparator.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'PAC sources', exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  const form = page.getByRole('region', {
    name: 'Add a WPAD',
    exact: true,
  });
  const bounds = await form.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath('wpad-registration-mobile.png'),
    fullPage: true,
  });
});

test('storage read failures are visible and do not overwrite the corrupt inventory', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('data-source-mode', JSON.stringify('mock'));
    localStorage.setItem('pac-sources', '{broken json');
  });
  await page.goto('/pac');
  await expect(
    page
      .getByRole('alert')
      .filter({
        hasText: 'Could not read PAC files from local storage',
      }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add and load' }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => localStorage.getItem('pac-sources')),
  ).toBe('{broken json');
});

test('sync keeps exact new raw text and failed downloads retain the cached original', async ({
  page,
}) => {
  const newText =
    '\uFEFF// untouched custom PAC\r\n\treturn anything;  \r\n';
  await seed(page, 2);
  await page.evaluate((content) => {
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: { url: string }) => {
          if (command === 'fetch_pac_source') {
            if (args.url.includes('pac-1'))
              throw new Error('download failed');
            return { content, status: 200, finalUrl: args.url };
          }
          return null;
        },
      },
    });
  }, newText);
  await page
    .getByRole('button', { name: 'PAC sources', exact: true })
    .click();
  for (const name of ['File 0', 'File 1']) {
    await page
      .locator('[data-slot="card"]')
      .filter({
        has: page.getByRole('heading', { name, exact: true }),
      })
      .getByRole('button', { name: 'Sync', exact: true })
      .click();
  }
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('pac-sources')!)[1].status,
      ),
    )
    .toBe('offline');
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('pac-sources')!),
  );
  expect(saved[0].downloadedContent).toBe(newText);
  expect(saved[1].downloadedContent).toBe(originals[1]);
  await page
    .getByRole('button', { name: 'Comparador de WPAD', exact: true })
    .click();
  await choose(page, 'Reference file', 'File 0');
  await choose(page, 'Compared file', 'File 1');
  await expect(page.getByLabel('Raw PAC text diff')).toContainText(
    'untouched custom PAC',
  );
});
