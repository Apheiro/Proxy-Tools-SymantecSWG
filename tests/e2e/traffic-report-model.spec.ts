import { expect, test } from '@playwright/test';
import {
  collectTrafficReport,
  concentratedTrafficPeaks,
  type TrafficReportQuery,
} from '../../src/lib/trafficReport';
import {
  fixtureReportQuery,
  reportInput,
  reportStart,
  reportTimeline,
} from '../fixtures/trafficReport';

test('peak detector handles regular traffic, single timestamps, quiet gaps and adjacent burst minutes', () => {
  expect(
    concentratedTrafficPeaks(
      [{ epoch: reportStart, requests: 100, bytes: 2000 }],
      'requests',
    ),
  ).toEqual([]);
  expect(
    concentratedTrafficPeaks(
      reportTimeline.map((b) => ({ ...b, requests: 10 })),
      'requests',
    ),
  ).toEqual([]);
  const peaks = concentratedTrafficPeaks(reportTimeline, 'requests');
  expect(peaks).toHaveLength(1);
  expect(peaks[0].start).toBe(reportStart + 7 * 60000);
  expect(peaks[0].requests).toBe(600);
  expect(peaks[0].ratio).toBe(60);
  expect(peaks[0].share).toBeCloseTo((600 / 740) * 100);
  const adjacent = reportTimeline.map((b, i) => ({
    ...b,
    requests: i === 8 ? 600 : b.requests,
  }));
  const grouped = concentratedTrafficPeaks(adjacent, 'requests');
  expect(grouped[0].minutes).toBe(2);
  expect(grouped[0].requests).toBe(1200);
  const sparse = [
    { epoch: reportStart, requests: 30, bytes: 3000 },
    { epoch: reportStart + 120 * 60000, requests: 3, bytes: 300 },
  ];
  expect(
    concentratedTrafficPeaks(sparse, 'requests')[0].ratio,
  ).toBeGreaterThan(100);
});
test('report queries complete aggregates and exact peak windows, never the current page of records', async () => {
  const calls: TrafficReportQuery[] = [];
  const report = await collectTrafficReport(
    reportInput,
    async (query) => {
      calls.push(query);
      return fixtureReportQuery(query);
    },
    new AbortController().signal,
    () => {},
  );
  expect(report.overall.summary.requests).toBe(740);
  expect(report.peaks).toHaveLength(1);
  expect(report.peaks[0].analysis.summary.requests).toBe(600);
  expect(report.peaks[0].analysis.rankings['cs-host'][0].name).toBe(
    'peak-client.example',
  );
  expect(
    calls.some(
      (q) =>
        q.start === reportStart + 7 * 60000 &&
        q.end === reportStart + 8 * 60000 - 1,
    ),
  ).toBe(true);
  expect(
    calls.every(
      (q) => q.page === 1 && q.pageSize === 1 && !q.errorsOnly,
    ),
  ).toBe(true);
  expect('records' in report.overall).toBe(false);
});
test('selected filters and partial boundaries are retained on all peak detail requests', async () => {
  const calls: TrafficReportQuery[] = [];
  const input = {
    ...reportInput,
    filters: { ...reportInput.filters, client: '192.0.2.10' },
    range: {
      start: reportStart + 7 * 60000 + 1000,
      end: reportStart + 8 * 60000 + 59999,
    },
  };
  const report = await collectTrafficReport(
    input,
    async (q) => {
      calls.push(q);
      return fixtureReportQuery(q);
    },
    new AbortController().signal,
    () => {},
  );
  expect(report.selected).toBe(true);
  expect(report.peaks[0].window.start).toBe(input.range.start);
  expect(
    calls
      .filter((q) => q.start !== null)
      .every((q) => q.client === '192.0.2.10'),
  ).toBe(true);
});
test('changed captures and cancellation cannot produce an apparently consistent report', async () => {
  let calls = 0;
  await expect(
    collectTrafficReport(
      reportInput,
      async (q) => {
        const r = fixtureReportQuery(q);
        if (++calls > 4) r.summary.requests++;
        return r;
      },
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow('capture changed');
  const controller = new AbortController();
  controller.abort();
  await expect(
    collectTrafficReport(
      reportInput,
      async (q) => fixtureReportQuery(q),
      controller.signal,
      () => {},
    ),
  ).rejects.toThrow('cancelled');
});

test('PDF renderer creates readable paginated report fixtures in both themes', async () => {
  const { renderToBuffer } = await import('@react-pdf/renderer');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const { registerTrafficReportFonts, TrafficReportDocument } =
    await import('../../src/components/pdf/trafficReportDocument');
  registerTrafficReportFonts(`${resolve('public/fonts/report')}/`);
  const report = await collectTrafficReport(
    reportInput,
    async (q) => fixtureReportQuery(q),
    new AbortController().signal,
    () => {},
  );
  await mkdir('/tmp/traffic-report-pdf', { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    const themed = {
      ...report,
      theme,
      palette:
        theme === 'light'
          ? report.palette
          : {
              ...report.palette,
              background: '#171717',
              foreground: '#fafafa',
              card: '#242424',
              cardForeground: '#fafafa',
              muted: '#404040',
              mutedForeground: '#b4b4b4',
              border: '#404040',
              primary: '#fafafa',
            },
    };
    const buffer = await renderToBuffer(
      TrafficReportDocument({ report: themed }),
    );
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.byteLength).toBeGreaterThan(20000);
    await writeFile(
      `/tmp/traffic-report-pdf/traffic-${theme}.pdf`,
      buffer,
    );
  }
});
