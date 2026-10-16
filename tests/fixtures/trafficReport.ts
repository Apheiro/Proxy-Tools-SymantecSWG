import {
  emptyCaptureFilters,
  type CaptureResult,
} from '../../src/lib/trafficCapture';
import type {
  ReportPalette,
  TrafficReportQuery,
} from '../../src/lib/trafficReport';
export const reportStart = Date.UTC(2026, 9, 16, 12);
export const reportTimeline = Array.from({ length: 15 }, (_, i) => ({
  epoch: reportStart + i * 60000,
  requests: i === 7 ? 600 : 10,
  bytes: (i === 7 ? 600 : 10) * 2048,
}));
export function fixtureReportQuery(
  query: TrafficReportQuery,
): CaptureResult {
  const bins = reportTimeline.filter(
    (b) =>
      (query.start === null || b.epoch + 59999 >= query.start) &&
      (query.end === null || b.epoch <= query.end),
  );
  const requests = bins.reduce((s, b) => s + b.requests, 0),
    bytes = bins.reduce((s, b) => s + b.bytes, 0);
  const peaked =
    bins.length === 1 && bins[0].epoch === reportStart + 7 * 60000;
  const row = {
    name: peaked ? 'peak-client.example' : 'general.example',
    value: query.metric === 'bytes' ? bytes : requests,
    requests,
    bytes,
    percentage: 100,
  };
  return {
    summary: {
      requests,
      bytes,
      issues: peaked ? 14 : 20,
      denied: peaked ? 4 : 6,
      uniqueUsers: 2,
      uniqueClients: 3,
      uniqueDestinations: 4,
      first: bins[0]?.epoch ?? null,
      last: bins.at(-1)?.epoch ?? null,
      requestsPerSecond: requests / (Math.max(1, bins.length) * 60),
      bytesPerSecond: bytes / (Math.max(1, bins.length) * 60),
    },
    timeline: bins,
    records: [],
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
      ].map((f) => [f, [row]]),
    ),
    page: 1,
    pageSize: 1,
    totalPages: requests,
    totalRecords: requests,
    diagnostics: [],
    diagnosticsTotal: 0,
    options: {},
  };
}
export const reportPalette: ReportPalette = {
  background: '#ffffff',
  foreground: '#171717',
  card: '#ffffff',
  cardForeground: '#171717',
  muted: '#f5f5f5',
  mutedForeground: '#737373',
  border: '#e5e5e5',
  primary: '#262626',
  destructive: '#dc2626',
};
export const reportInput = {
  proxy: 'swg-fixture.example',
  source: 'synthetic-access.log',
  captureId: 'report-fixture',
  generatedAt: '2026-10-16T15:00:00Z',
  timeZone: 'America/Argentina/Salta',
  theme: 'light' as const,
  palette: reportPalette,
  filters: { ...emptyCaptureFilters },
  range: { start: null, end: null },
  metric: 'requests' as const,
  availability: [
    'cs-bytes',
    'sc-bytes',
    'c-ip',
    'cs-host',
    'cs-username',
  ].map((name) => ({
    name,
    status: 'available',
    populated: 740,
    total: 740,
  })),
  receivedLines: 741,
  processedRecords: 740,
};
