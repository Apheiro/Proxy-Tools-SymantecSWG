import type { TrafficCaptureScope } from './trafficCaptureScope';
import type { ReportMetric } from './trafficReport';
export type ComparisonRange = { start: number; end: number };
export type ComparisonPeriodInput = ComparisonRange & {
  id: string;
  label: string;
  ranges: ComparisonRange[];
};
export type ComparisonEntry = {
  name: string;
  requests: number;
  bytes: number;
};
export type ComparisonSource = {
  id: string;
  source: string;
  scope: TrafficCaptureScope | null;
  first: number | null;
  last: number | null;
  records: number;
  untimedRecords: number;
  diagnosticsTotal?: number;
  unassignedDiagnostics?: number;
  fieldAvailability?: {
    name: string;
    status: string;
    populated: number;
    total: number;
  }[];
};
export type ComparisonPeriod = ComparisonPeriodInput & {
  first: number;
  last: number;
  requests: number;
  bytes: number;
  http4xx: number;
  http5xx: number;
  parseFailures?: number;
  denied: number;
  issues: number;
  clients: number;
  hosts: number;
  activeMinutes: number;
  observedDurationMs?: number;
  maxEventGapMs?: number;
  timeline: { epoch: number; requests: number; bytes: number }[];
  rankings: Record<string, ComparisonEntry[]>;
};
export type ComparisonResult = {
  periods: ComparisonPeriod[];
  excluded: number;
  sources: ComparisonSource[];
  changes?: Record<
    string,
    {
      fromPeriod: string;
      toPeriod: string;
      emerged: ComparisonEntry[];
      disappeared: ComparisonEntry[];
    }[]
  >;
  common: Record<
    string,
    {
      name: string;
      values: { periodId: string; requests: number; bytes: number }[];
    }[]
  >;
};
export type ComparisonSnapshot = {
  result: ComparisonResult;
  original?: ComparisonResult;
  metric: ReportMetric;
  topN: number;
  timeZone: string;
  mode: string;
  from: string;
  to: string;
  dateFrom: string;
  dateTo: string;
  commonInterval: boolean;
  proxy: string;
  profile: string;
  generatedAt: string;
};
export const comparisonNumber = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
    n,
  );
export const observedSeconds = (p: ComparisonPeriod) =>
  Math.max(0, (p.observedDurationMs ?? p.last - p.first) / 1000);
export const comparisonRate = (
  p: ComparisonPeriod,
  metric: ReportMetric,
) => (observedSeconds(p) > 0 ? p[metric] / observedSeconds(p) : null);
export const comparisonCoverage = (p: ComparisonPeriod) =>
  Math.min(
    100,
    (Math.max(0, p.observedDurationMs ?? p.last - p.first) /
      Math.max(
        1,
        p.ranges.reduce((n, r) => n + r.end - r.start, 0),
      )) *
      100,
  );
export const COMPARISON_NOTE =
  'Event timestamps establish an observed interval, not complete log coverage. Gaps may reflect silence or missing logs. Rates use elapsed observed time; single-timestamp periods have no duration rate. HTTP errors, policy denials and record issues are separate and may overlap. Untimed ingestion diagnostics cannot be assigned to a period.';
export function comparisonCsv(s: ComparisonSnapshot) {
  const rows: (string | number)[][] = [
    ['ProxyTools Comparative Reports', s.generatedAt],
    [
      'proxy',
      s.proxy,
      'profile',
      s.profile,
      'timezone',
      s.timeZone,
      'mode',
      s.mode,
      'metric',
      s.metric,
      'topN',
      s.topN,
      'commonInterval',
      String(s.commonInterval),
    ],
    [
      'dateFrom',
      s.dateFrom,
      'dateTo',
      s.dateTo,
      'from',
      s.from,
      'to',
      s.to,
    ],
    ['note', COMPARISON_NOTE],
    [
      'table',
      'period',
      'entity',
      'requests',
      'bytes',
      'requested_start_utc',
      'requested_end_exclusive_utc',
      'observed_start_utc',
      'observed_end_utc',
      'observed_span_percent',
      'active_minutes',
      'requests_per_second',
      'bytes_per_second',
      'http4xx',
      'http5xx',
      'policy_denials',
      'record_issues',
      'parse_failures',
      'unique_clients',
      'unique_destinations',
    ],
  ];
  for (const p of s.result.periods) {
    rows.push([
      'summary',
      p.label,
      '',
      p.requests,
      p.bytes,
      new Date(p.start).toISOString(),
      new Date(p.end).toISOString(),
      new Date(p.first).toISOString(),
      new Date(p.last).toISOString(),
      comparisonCoverage(p),
      p.activeMinutes,
      comparisonRate(p, 'requests') ?? '',
      comparisonRate(p, 'bytes') ?? '',
      p.http4xx,
      p.http5xx,
      p.denied,
      p.issues,
      p.parseFailures ?? '',
      p.clients,
      p.hosts,
    ]);
    for (const range of p.ranges)
      rows.push([
        'requested_utc_span',
        p.label,
        '',
        '',
        '',
        new Date(range.start).toISOString(),
        new Date(range.end).toISOString(),
      ]);
    for (const [field, entries] of Object.entries(p.rankings))
      for (const e of entries)
        rows.push([field, p.label, e.name, e.requests, e.bytes]);
  }
  for (const [field, entries] of Object.entries(s.result.common))
    for (const e of entries)
      for (const v of e.values)
        rows.push([
          `common_${field}`,
          v.periodId,
          e.name,
          v.requests,
          v.bytes,
        ]);
  for (const [field, changes] of Object.entries(
    s.result.changes ?? {},
  ))
    for (const change of changes)
      for (const kind of ['emerged', 'disappeared'] as const)
        for (const e of change[kind])
          rows.push([
            `${kind}_${field}`,
            `${change.fromPeriod} -> ${change.toPeriod}`,
            e.name,
            e.requests,
            e.bytes,
          ]);
  for (const source of s.result.sources)
    rows.push([
      'source',
      source.id,
      source.source,
      source.records,
      'scope',
      source.scope
        ? `${source.scope.profile}/${source.scope.proxyIdentity}`
        : 'Unassigned',
      'untimed',
      source.untimedRecords,
      'diagnostics',
      source.diagnosticsTotal ?? '',
      'unassigned_diagnostics',
      source.unassignedDiagnostics ?? '',
    ]);
  for (let i = 1; i < s.result.periods.length; i++) {
    const before = s.result.periods[i - 1],
      after = s.result.periods[i];
    rows.push([
      'absolute_delta',
      `${before.label} -> ${after.label}`,
      '',
      after.requests - before.requests,
      after.bytes - before.bytes,
    ]);
    rows.push([
      'percentage_delta',
      `${before.label} -> ${after.label}`,
      '',
      before.requests
        ? (after.requests / before.requests - 1) * 100
        : 'no baseline',
      before.bytes
        ? (after.bytes / before.bytes - 1) * 100
        : 'no baseline',
    ]);
  }
  for (const source of s.result.sources)
    for (const f of source.fieldAvailability ?? [])
      rows.push([
        'field_availability',
        source.id,
        f.name,
        f.populated,
        f.total,
        f.status,
      ]);
  if (s.original)
    for (const p of s.original.periods)
      rows.push([
        'original_summary',
        p.label,
        '',
        p.requests,
        p.bytes,
        new Date(p.start).toISOString(),
        new Date(p.end).toISOString(),
        new Date(p.first).toISOString(),
        new Date(p.last).toISOString(),
      ]);
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            const text = String(value);
            return `"${(typeof value === 'string' && /^(?:\s*[=+@-]|[\t\r])/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
          })
          .join(','),
      )
      .join('\r\n')
  );
}
