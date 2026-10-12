import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/Diagnostics/TrafficAnalysis');
  await page
    .getByRole('button', {
      name: 'Continue without saved credentials',
    })
    .click();
  await expect(
    page.getByRole('combobox', { name: 'Display time zone' }),
  ).toHaveText('UTC');
});

test('time zones mount only a window of options and allow mouse selection after scrolling', async ({
  page,
}) => {
  const trigger = page.getByRole('combobox', {
    name: 'Display time zone',
  });
  await trigger.click();
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();
  expect((await list.boundingBox())?.height).toBeLessThanOrEqual(320);
  const total = await list
    .getByRole('option')
    .first()
    .getAttribute('aria-setsize');
  expect(Number(total)).toBeGreaterThan(300);
  expect(await list.getByRole('option').count()).toBeLessThan(60);
  const last = await page.evaluate(() =>
    Intl.supportedValuesOf('timeZone').at(-1)!.replaceAll('_', ' '),
  );
  await list
    .locator('[data-radix-select-viewport]')
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  await expect(
    list.getByRole('option', { name: last, exact: true }),
  ).toBeVisible();
  expect(await list.getByRole('option').count()).toBeLessThan(60);
  await list.getByRole('option', { name: last, exact: true }).click();
  await expect(trigger).toHaveText(last);
  await expect(list).toBeHidden();
  await trigger.click();
  await expect(
    list.getByRole('option', { name: last, exact: true }),
  ).toBeFocused();
  await expect(
    list.getByRole('option', { name: last, exact: true }),
  ).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText(last);
});

test('keyboard navigation and typeahead reach options outside the mounted window', async ({
  page,
}) => {
  const trigger = page.getByRole('combobox', {
    name: 'Display time zone',
  });
  await trigger.focus();
  await page.keyboard.type('Asia/Tokyo');
  await expect(trigger).toHaveText('Asia/Tokyo');
  await page.keyboard.press('ArrowDown');
  const list = page.getByRole('listbox');
  await expect(
    list.getByRole('option', { name: 'Asia/Tokyo', exact: true }),
  ).toBeFocused();
  await page.keyboard.type('Europe/London');
  await expect(
    list.getByRole('option', { name: 'Europe/London', exact: true }),
  ).toBeFocused();
  await expect(
    list.getByRole('option', { name: 'Europe/London', exact: true }),
  ).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveText('Europe/London');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  const last = await page.evaluate(() =>
    Intl.supportedValuesOf('timeZone').at(-1)!.replaceAll('_', ' '),
  );
  await expect(
    list.getByRole('option', { name: last, exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Home');
  await expect(
    list.getByRole('option', { name: 'UTC', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    list.locator('[role="option"][aria-posinset="2"]'),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveText('Europe/London');
});
