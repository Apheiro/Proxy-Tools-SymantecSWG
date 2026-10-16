import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('data-source-mode', JSON.stringify('mock'));
    Object.assign(window, {
      __TAURI_INTERNALS__: { invoke: async () => null },
    });
  });
});

test('workspace links share their layout, update URLs and respect browser history', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL('/proxies');
  const selector = page.getByRole('navigation', {
    name: 'Select workspace',
  });
  await expect(
    selector.getByRole('link', {
      name: 'Proxy Workspace',
      exact: true,
    }),
  ).toHaveAttribute('aria-current', 'page');
  await selector.evaluate((element) =>
    element.setAttribute('data-test-instance', 'shared'),
  );
  await selector
    .getByRole('link', { name: 'PAC File Manager', exact: true })
    .click();
  await expect(page).toHaveURL('/pac');
  await expect(
    page.getByRole('heading', {
      name: 'PAC File Manager Workspace',
      exact: true,
    }),
  ).toBeVisible();
  await expect(selector).toHaveAttribute(
    'data-test-instance',
    'shared',
  );
  await expect(
    selector.getByRole('link', {
      name: 'PAC File Manager',
      exact: true,
    }),
  ).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page).toHaveURL('/proxies');
  await expect(
    page.getByRole('heading', {
      name: 'Proxy workspace',
      exact: true,
    }),
  ).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL('/pac');
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'PAC File Manager Workspace',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page).toHaveURL('/pac');
});

test('Home restores the saved workspace and ignores unknown preference values', async ({
  page,
}) => {
  await page.goto('/pac');
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('home-workspace')),
    )
    .toBe('pac');
  await page.goto('/');
  await expect(page).toHaveURL('/pac');
  await page.evaluate(() =>
    localStorage.setItem('home-workspace', 'https://example.test'),
  );
  await page.goto('/');
  await expect(page).toHaveURL('/proxies');
});

test('PAC sources use their own editor route and return to the source list', async ({
  page,
}) => {
  await page.goto('/pac');
  await page
    .getByRole('button', {
      name: 'Create PAC from scratch',
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/pac\/editor\?sourceId=/);
  await expect(
    page.getByRole('heading', {
      name: 'PAC Source Editor',
      exact: true,
    }),
  ).toBeVisible();
  const sources = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('pac-sources') ?? '[]')
          .length,
    );
  await expect.poll(sources).toBe(1);
  const editorUrl = page.url();
  await expect(
    page
      .getByRole('navigation', { name: 'Select workspace' })
      .getByRole('link', { name: 'PAC File Manager', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page
    .getByRole('link', { name: 'Back to PAC sources', exact: true })
    .click();
  await expect(page).toHaveURL('/pac');
  await page
    .getByRole('button', { name: 'Edit source', exact: true })
    .click();
  await expect(page).toHaveURL(editorUrl);
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'PAC Source Editor',
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(sources).toBe(1);
});

test('legacy PAC editor links redirect while preserving the selected source', async ({
  page,
}) => {
  await page.goto('/pac?new=1');
  await expect(page).toHaveURL(/\/pac\/editor\?sourceId=/);
  const editorUrl = new URL(page.url());
  await page.goto(
    `/pac?sourceId=${editorUrl.searchParams.get('sourceId')}`,
  );
  await expect(page).toHaveURL(editorUrl.toString());
  await expect(
    page.getByRole('heading', {
      name: 'PAC Source Editor',
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('pac-sources') ?? '[]')
          .length,
    ),
  ).toBe(1);
});
