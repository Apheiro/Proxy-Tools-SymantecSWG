import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
for (const native of [false, true]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`traffic PDF exports all aggregates and peak details using the ${theme} app theme (${native ? 'Tauri' : 'browser'})`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript(
        ({ theme, native }) => {
          localStorage.setItem('theme', theme);
          localStorage.setItem(
            'dark_mode',
            JSON.stringify(theme === 'dark'),
          );
          localStorage.setItem(
            'data-source-mode',
            JSON.stringify('mock'),
          );
          const start = Date.UTC(2026, 9, 16, 12);
          const timeline = Array.from({ length: 15 }, (_, i) => ({
            epoch: start + i * 60000,
            requests: i === 7 ? 600 : 10,
            bytes: (i === 7 ? 600 : 10) * 2048,
          }));
          const fields = [
            'cs-bytes',
            'sc-bytes',
            'cs-host',
            'c-ip',
            'cs-username',
          ];
          const dataset = {
            captureId: 'capture-report',
            source: 'browser-fixture.log',
            timeline,
            records: [],
            fields,
            diagnostics: [],
            fieldAvailability: fields.map((name) => ({
              name,
              status: 'available',
              populated: 740,
              total: 740,
            })),
            receivedLines: 741,
            recordsProcessed: 740,
            bytesProcessed: 4096,
            diagnosticsTotal: 0,
          };
          const calls: {
            command: string;
            query?: Record<string, unknown>;
          }[] = [];
          Object.assign(window, {
            reportCalls: calls,
            isTauri: false,
            __TAURI_INTERNALS__: {
              invoke: async (
                command: string,
                args: Record<string, any> = {},
              ) => {
                calls.push({ command, query: args.query });
                if (command === 'save_traffic_pdf') {
                  Object.assign(window, { savedReport: args });
                  return `/mock/cache/traffic-analysis/${args.filename}`;
                }
                if (command === 'open_traffic_pdf') {
                  Object.assign(window, { openedReport: args });
                  return null;
                }
                if (
                  command === 'list_traffic_analyses' ||
                  command === 'get_traffic_access_logs'
                )
                  return [];
                if (command === 'get_traffic_processing_config')
                  return {
                    logicalCpus: 4,
                    recommendedWorkers: 2,
                    maxWorkers: 4,
                    chunkBytes: 4096,
                  };
                if (command === 'get_mock_access_log')
                  return '# synthetic fixture';
                if (command === 'start_access_log_parse')
                  return 'capture-report';
                if (command === 'append_access_log_parse_chunk')
                  return dataset;
                if (command === 'query_traffic_capture') {
                  const q = args.query;
                  const bins = timeline.filter(
                    (b) =>
                      (q.start == null ||
                        b.epoch + 59999 >= q.start) &&
                      (q.end == null || b.epoch <= q.end),
                  );
                  const requests = bins.reduce(
                      (s, b) => s + b.requests,
                      0,
                    ),
                    bytes = bins.reduce((s, b) => s + b.bytes, 0);
                  const peak = bins.length === 1;
                  const ranking = {
                    name: peak
                      ? 'focused-peak.example'
                      : 'general-traffic.example',
                    value: q.metric === 'bytes' ? bytes : requests,
                    requests,
                    bytes,
                    percentage: 100,
                  };
                  return {
                    summary: {
                      requests,
                      bytes,
                      issues: 20,
                      denied: 6,
                      uniqueClients: 3,
                      uniqueUsers: 2,
                      uniqueDestinations: 4,
                      first: bins[0]?.epoch ?? null,
                      last: bins.at(-1)?.epoch ?? null,
                      requestsPerSecond: requests / 900,
                      bytesPerSecond: bytes / 900,
                    },
                    timeline: bins,
                    rankings: Object.fromEntries(
                      [
                        'cs-host',
                        'c-ip',
                        'cs-username',
                        'cs-method',
                        'sc-status',
                        's-action',
                        'cs-categories',
                        'x-bluecoat-application-name',
                        'sc-filter-result',
                        'x-issue',
                        'cs-threat-risk',
                        'x-bluecoat-access-security-policy-action',
                      ].map((f) => [f, [ranking]]),
                    ),
                    records: [],
                    page: 1,
                    pageSize: q.pageSize,
                    totalRecords: requests,
                    totalPages: 1,
                    diagnostics: [],
                    diagnosticsTotal: 0,
                    options: {},
                  };
                }
                return null;
              },
            },
          });
        },
        { theme, native },
      );
      await page.goto(
        '/Diagnostics/TrafficAnalysis?proxy=swg-fixture',
      );
      const button = page.getByRole('button', {
        name: 'Export PDF',
        exact: true,
      });
      await expect(button).toBeDisabled();
      await page
        .getByRole('button', { name: 'Explore demo data' })
        .click();
      await expect(button).toBeEnabled();
      const path = testInfo.outputPath(`traffic-${theme}.pdf`);
      if (native) {
        await page.evaluate(() => {
          Object.assign(window, { isTauri: true });
        });
        await button.click();
        await expect(
          page.getByText('PDF saved.', { exact: true }),
        ).toBeVisible();
        const saved = await page.evaluate(
          () => (window as any).savedReport,
        );
        expect(saved.filename).toMatch(
          new RegExp(`traffic-analysis-.*-${theme}\\.pdf$`),
        );
        await writeFile(path, Buffer.from(saved.bytes));
        await expect
          .poll(() =>
            page.evaluate(() => (window as any).openedReport),
          )
          .toEqual({ filename: saved.filename, folder: false });
        await page
          .getByRole('button', { name: 'Open folder', exact: true })
          .click();
        await expect
          .poll(() =>
            page.evaluate(() => (window as any).openedReport),
          )
          .toEqual({ filename: saved.filename, folder: true });
      } else {
        const downloadPromise = page.waitForEvent('download');
        await button.click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(
          new RegExp(`traffic-analysis-.*-${theme}\\.pdf$`),
        );
        await download.saveAs(path);
      }
      expect((await readFile(path)).subarray(0, 5).toString()).toBe(
        '%PDF-',
      );
      const text = execFileSync('pdftotext', ['-layout', path, '-'], {
        encoding: 'utf8',
      });
      expect(text).toMatch(/1\s*\/\s*\d+/);
      expect(text).toContain('740');
      expect(text).toContain('focused-peak.example');
      expect(text).toContain('Peak 1:');
      expect(text).toContain(`${theme.toUpperCase()} REPORT`);
      await expect(button).toBeEnabled();
      const calls = await page.evaluate(() =>
        (window as any).reportCalls.filter(
          (c: any) => c.command === 'query_traffic_capture',
        ),
      );
      expect(
        calls.some(
          (c: any) =>
            c.query.pageSize === 1 &&
            c.query.start !== null &&
            c.query.end !== null,
        ),
      ).toBe(true);
    });
  }
}
