import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('data-source-mode', JSON.stringify('mock'));
    localStorage.setItem('home-workspace', 'proxy');
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          if (command === 'get_html_data')
            return { filesLink: [], traces: [] };
          if (
            command === 'get_traffic_access_logs' ||
            command === 'list_traffic_analyses'
          )
            return [];
          return null;
        },
      },
    });
  });
});

const screens = [
  { route: '/', title: 'Proxy workspace', label: 'Proxy management' },
  {
    route: '/Diagnostics',
    title: 'No proxy selected',
    label: 'Proxy diagnostics',
  },
  {
    route: '/Diagnostics/Trace',
    title: 'Live transactions',
    label: 'Trace analysis',
  },
  {
    route: '/Diagnostics/TrafficAnalysis',
    title: 'Traffic Analysis',
    label: 'Proxy diagnostics',
  },
  {
    route: '/Diagnostics/BackupManager',
    title: 'Backup Manager',
    label: 'Appliance backups',
  },
  {
    route: '/pac?new=1',
    title: 'PAC Source Editor',
    label: 'PAC File Manager / Source editor',
  },
];

for (const section of ['TrafficAnalysis', 'BackupManager', 'Trace']) {
  test(`Diagnostics breadcrumb preserves the selected proxy from ${section}`, async ({
    page,
  }) => {
    const proxy = 'swg-test.example:8082';
    await page.goto(
      `/Diagnostics/${section}?${new URLSearchParams({ proxy, unrelated: 'ignored' })}`,
    );
    const navbar = page.getByRole('navigation');
    const diagnostics = navbar.getByRole('link', {
      name: 'Diagnostics',
      exact: true,
    });
    await expect(diagnostics).toHaveAttribute(
      'href',
      `/Diagnostics?${new URLSearchParams({ proxy })}`,
    );
    await expect(
      navbar.getByRole('link', { name: 'Home', exact: true }),
    ).toHaveAttribute('href', '/');
    await diagnostics.click();
    await expect(page).toHaveURL(
      `/Diagnostics?${new URLSearchParams({ proxy })}`,
    );
    await expect(
      page.getByRole('heading', {
        name: proxy,
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'No proxy selected',
        exact: true,
      }),
    ).toHaveCount(0);
  });
}

test('Diagnostics breadcrumb works without a selected proxy', async ({
  page,
}) => {
  await page.goto('/Diagnostics/TrafficAnalysis');
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Diagnostics', exact: true })
    .click();
  await expect(page).toHaveURL('/Diagnostics');
  await expect(
    page.getByRole('heading', {
      name: 'No proxy selected',
      exact: true,
    }),
  ).toBeVisible();
});

for (const mobile of [false, true]) {
  for (const screen of screens) {
    test(`${mobile ? 'mobile' : 'desktop'} workspace header: ${screen.title}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(
        mobile
          ? { width: 390, height: 844 }
          : { width: 1280, height: 800 },
      );
      await page.goto(screen.route);
      const header = page.locator('[data-slot="page-header"]');
      await expect(header).toHaveCount(1);
      await expect(
        header.getByRole('heading', {
          level: 1,
          name: screen.title,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        header.locator('[data-slot="page-header-eyebrow"]'),
      ).toHaveText(screen.label);
      await expect(header.locator('h1')).toHaveCSS(
        'font-size',
        mobile ? '24px' : '30px',
      );
      const bounds = await header.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
        mobile ? 390 : 1280,
      );
      expect(
        await header.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
      if (screen.title === 'Traffic Analysis') {
        await expect(
          header.getByRole('button', {
            name: 'Static Log',
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          header.getByRole('button', {
            name: 'Live Session',
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          header.getByRole('link', {
            name: 'Proxy diagnostics',
            exact: true,
          }),
        ).toHaveCount(0);
      }
      if (screen.title === 'Backup Manager')
        await page.screenshot({
          path: testInfo.outputPath('backup-header.png'),
        });
      if (screen.title === 'Proxy workspace') {
        await page
          .getByRole('button', {
            name: 'PAC File Manager',
            exact: true,
          })
          .click();
        await expect(
          header.getByRole('heading', {
            level: 1,
            name: 'PAC File Manager Workspace',
            exact: true,
          }),
        ).toBeVisible();
      }
    });
  }
}
