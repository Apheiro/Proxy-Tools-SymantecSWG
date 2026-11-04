import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Page } from '@playwright/test';

/** Serve a production export through Playwright interception, without opening a TCP port. */
export async function installStaticTrafficSite(page: Page) {
  if (process.env.TRAFFIC_STATIC_E2E !== '1') return;
  const root = resolve('dist');
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.txt': 'text/x-component',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
  };
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://localhost:3100') return route.abort();
    const relative = decodeURIComponent(url.pathname);
    const file = resolve(
      root,
      `.${relative === '/' ? '/index.html' : relative}`,
    );
    if (!file.startsWith(root + sep)) return route.abort();
    const candidates = extname(file)
      ? [file]
      : [file + '.html', resolve(file, 'index.html')];
    for (const candidate of candidates) {
      try {
        const body = await readFile(candidate);
        return route.fulfill({
          status: 200,
          body,
          contentType:
            types[extname(candidate)] ?? 'application/octet-stream',
        });
      } catch {
        /* Try the export's alternate HTML path. */
      }
    }
    return route.fulfill({
      status: 404,
      body: 'Missing static fixture asset',
    });
  });
}
