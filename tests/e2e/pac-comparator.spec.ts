import { expect, test, type Page } from '@playwright/test';
import { comparePacText, rawLines } from '../../src/lib/pacTextDiff';
import {
  editsOverlap,
  locatedBlocks,
  mergeResult,
} from '../../src/lib/pacMerge';

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
      if (!localStorage.getItem('pac-sources'))
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
    .getByRole('button', { name: 'WPAD Comparator', exact: true })
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
        name: 'WPAD Comparator',
        exact: true,
      })
      .getByRole('alert'),
  ).toContainText('Original text is unavailable');
});

test('one file and zero files do not require entering the add flow', async ({
  page,
}) => {
  await seed(page, 1);
  await expect(
    page.getByText('Only one file', { exact: false }),
  ).toBeVisible();
});

test('no downloads show an actionable empty state', async ({
  page,
}) => {
  await seed(page, 0);
  await expect(
    page.getByText('No original text is available', { exact: false }),
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
        name: 'WPAD Comparator',
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
    name: 'WPAD Comparator',
    exact: true,
  });
  await expect(comparator.getByRole('status')).toContainText(
    '0 of 3 reviewed',
  );
  await page.getByRole('button', { name: 'Next difference' }).click();
  await expect(
    comparator.getByRole('button', { name: 'Go to difference 2' }),
  ).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('[data-difference="1"]')).toBeFocused();
  await page
    .getByRole('button', { name: 'Copy reference fragment' })
    .click();
  expect(
    await page.evaluate(() => navigator.clipboard.readText()),
  ).toBe('old\n');
  await page
    .getByRole('button', { name: 'Copy compared fragment' })
    .click();
  expect(
    await page.evaluate(() => navigator.clipboard.readText()),
  ).toBe('new\n');
  await page
    .getByRole('button', { name: 'Previous difference' })
    .click();
  await expect(
    comparator.getByRole('button', { name: 'Go to difference 1' }),
  ).toHaveAttribute('aria-current', 'step');
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
    page.getByRole('alert').filter({
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
      .getByRole('button', {
        name: `File actions for ${name}`,
        exact: true,
      })
      .click();
    await page
      .getByRole('menuitem', { name: 'Sync', exact: true })
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
    .getByRole('button', { name: 'WPAD Comparator', exact: true })
    .click();
  await choose(page, 'Reference file', 'File 0');
  await choose(page, 'Compared file', 'File 1');
  await expect(page.getByLabel('Raw PAC text diff')).toContainText(
    'untouched custom PAC',
  );
});

async function seedRawFiles(page: Page, texts: string[]) {
  await seed(
    page,
    0,
    texts.map((downloadedContent, index) => ({
      id: `raw-${index}`,
      name: `Raw ${index}`,
      url: '',
      rules: [],
      baseRules: [],
      status: 'synced',
      downloadedContent,
    })),
  );
  await choose(page, 'Reference file', 'Raw 0');
  await choose(page, 'Compared file', 'Raw 1');
}

async function copiedResult(page: Page) {
  await page
    .getByRole('button', { name: 'Copy result', exact: true })
    .click();
  return page.evaluate(() => navigator.clipboard.readText());
}

test('raw merge coordinates retain BOM, mixed terminators, insertions and the missing final newline', () => {
  const base = '\uFEFFone\r\ntwo\rthree';
  const incoming = '\uFEFFone\r\nnew\nthree!';
  const blocks = locatedBlocks(comparePacText(base, incoming));
  const edits = blocks
    .filter((block) => block.changed)
    .map((block, index) => ({
      id: String(index),
      start: block.start,
      end: block.end,
      text: block.right.join(''),
      origin: 'test',
    }));
  expect(mergeResult(base, edits)).toBe(incoming);
  expect(
    mergeResult('', [
      { id: 'empty', start: 0, end: 0, text: '\r\n', origin: 'test' },
    ]),
  ).toBe('\r\n');
  expect(mergeResult(base, [])).toBe(base);
  const insertion = {
    id: 'insert',
    start: 2,
    end: 2,
    text: 'x',
    origin: 'test',
  };
  expect(
    editsOverlap(insertion, { ...insertion, start: 2, end: 5 }),
  ).toBe(true);
  expect(
    editsOverlap(
      { ...insertion, start: 0, end: 2 },
      { ...insertion, start: 2, end: 5 },
    ),
  ).toBe(false);
});

test('accept, discard, undo and save build a third independent file', async ({
  page,
  context,
}) => {
  await context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ]);
  const base = '// base\r\nold\r\n// end';
  const incoming = '// base\r\nnew\r\n// end';
  await seedRawFiles(page, [base, incoming]);
  const originals = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('pac-sources')!),
  );
  await page
    .getByRole('button', { name: 'Accept compared', exact: true })
    .click();
  expect(await copiedResult(page)).toBe(incoming);
  await page
    .getByRole('button', { name: 'Discard change', exact: true })
    .click();
  expect(await copiedResult(page)).toBe(base);
  await page
    .getByRole('button', { name: 'Undo last decision', exact: true })
    .click();
  expect(await copiedResult(page)).toBe(incoming);
  await page
    .getByLabel('New filename', { exact: true })
    .fill('independent-wpad.dat');
  await page
    .getByRole('button', { name: 'Save as new file', exact: true })
    .click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('pac-sources')!),
  );
  expect(saved).toHaveLength(3);
  expect(saved.slice(0, 2)).toEqual(originals);
  expect(saved[2].id).not.toBe(saved[0].id);
  expect(saved[2].localContent).toBe(incoming);
  expect(saved[2].url).toBe('');
  expect(saved[2].name).toBe('independent-wpad.dat');
});

test('manual fragment merging preserves selected original lines without normalizing terminators', async ({
  page,
  context,
}) => {
  await context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ]);
  await seedRawFiles(page, [
    'old-a\r\nold-b\r\n// end',
    'new-a\nnew-b\n// end',
  ]);
  await page
    .getByRole('button', { name: 'Merge fragments', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Merge selected fragments',
    exact: true,
  });
  await dialog
    .getByLabel('Include reference line 2', { exact: true })
    .uncheck();
  await dialog
    .getByLabel('Include compared line 1', { exact: true })
    .uncheck();
  await dialog
    .getByRole('button', { name: 'Use merged fragment', exact: true })
    .click();
  expect(await copiedResult(page)).toBe('old-a\r\nnew-b\n// end');
});

test('sequential comparisons accumulate decisions and overlapping replacements can be cancelled or undone', async ({
  page,
  context,
}) => {
  await context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ]);
  await seedRawFiles(page, [
    'a\r\nb\r\nc\r\n',
    'A\r\nb\r\nc\r\n',
    'a\r\nb\r\nC\r\n',
    'Z\r\nb\r\nc\r\n',
  ]);
  await page
    .getByRole('button', { name: 'Accept compared', exact: true })
    .click();
  await choose(page, 'Compared file', 'Raw 2');
  await page
    .getByRole('button', { name: 'Accept compared', exact: true })
    .click();
  expect(await copiedResult(page)).toBe('A\r\nb\r\nC\r\n');
  await choose(page, 'Compared file', 'Raw 3');
  await page
    .getByRole('button', { name: 'Accept compared', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Resolve overlapping changes',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', {
      name: 'Keep existing result',
      exact: true,
    })
    .click();
  expect(await copiedResult(page)).toBe('A\r\nb\r\nC\r\n');
  await page
    .getByRole('button', { name: 'Accept compared', exact: true })
    .click();
  await dialog
    .getByRole('button', {
      name: 'Replace overlapping changes',
      exact: true,
    })
    .click();
  expect(await copiedResult(page)).toBe('Z\r\nb\r\nC\r\n');
  await page
    .getByRole('button', { name: 'Undo last decision', exact: true })
    .click();
  expect(await copiedResult(page)).toBe('A\r\nb\r\nC\r\n');
  await page
    .getByRole('button', { name: 'PAC sources', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'WPAD Comparator', exact: true })
    .click();
  expect(await copiedResult(page)).toBe('A\r\nb\r\nC\r\n');
  await expect(
    page.getByLabel('Reference file', { exact: true }),
  ).toContainText('Raw 0');
});

test('file cards share context and overflow actions, with persisted tags and grouping', async ({
  page,
}) => {
  await seedRawFiles(page, ['one', 'two']);
  await page
    .getByRole('button', { name: 'PAC sources', exact: true })
    .click();
  const card = page.locator('[data-slot="card"]').filter({
    has: page.getByRole('heading', { name: 'Raw 0', exact: true }),
  });
  await card.click({ button: 'right' });
  const contextActions = await page
    .getByRole('menuitem')
    .allTextContents();
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', {
      name: 'File actions for Raw 0',
      exact: true,
    })
    .click();
  expect(await page.getByRole('menuitem').allTextContents()).toEqual(
    contextActions,
  );
  await page
    .getByRole('menuitem', { name: 'Edit tags', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'File tags',
    exact: true,
  });
  await dialog
    .getByLabel('New tag', { exact: true })
    .fill('  Lab  Norte  ');
  await dialog
    .getByRole('button', { name: 'Add', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await choose(page, 'Group by', 'Tags');
  await choose(page, 'Show tag', 'Lab Norte');
  await expect(
    page.getByRole('region', { name: 'Lab Norte', exact: true }),
  ).toContainText('Raw 0');
  await page.reload();
  await expect(
    page.getByLabel('Group by', { exact: true }),
  ).toHaveText('Tags');
  await expect(
    page.getByLabel('Show tag', { exact: true }),
  ).toHaveText('Lab Norte');
  await expect(
    page.getByRole('region', { name: 'Lab Norte', exact: true }),
  ).toContainText('Raw 0');
  await expect(
    page.getByRole('heading', { name: 'Raw 1', exact: true }),
  ).toHaveCount(0);
});
