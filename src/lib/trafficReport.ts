import type { TrafficDataset } from './trafficAnalysis';
import type {
  CaptureFilters,
  CaptureRange,
  CaptureResult,
} from './trafficCapture';
import { emptyCaptureFilters } from './trafficCapture';
export type ReportMetric = 'requests' | 'bytes';
export type ReportPalette = Record<
  | 'background'
  | 'foreground'
  | 'card'
  | 'cardForeground'
  | 'muted'
  | 'mutedForeground'
  | 'border'
  | 'primary'
  | 'destructive',
  string
>;
export type TrafficPeak = {
  start: number;
  end: number;
  requests: number;
  bytes: number;
  share: number;
  ratio: number | null;
  minutes: number;
};
export type ReportAnalysis = Omit<
  CaptureResult,
  'records' | 'options'
>;
export type TrafficReport = {
  proxy: string;
  source: string;
  captureId: string;
  generatedAt: string;
  timeZone: string;
  theme: 'light' | 'dark';
  palette: ReportPalette;
  filters: CaptureFilters;
  range: CaptureRange;
  metric: ReportMetric;
  selected: boolean;
  availability: TrafficDataset['fieldAvailability'];
  receivedLines: number;
  processedRecords: number;
  overall: ReportAnalysis;
  selection: ReportAnalysis;
  volume: ReportAnalysis;
  peaksFound: number;
  peaks: {
    window: TrafficPeak;
    analysis: ReportAnalysis;
    volume: ReportAnalysis;
  }[];
};
export type TrafficReportQuery = CaptureFilters &
  CaptureRange & {
    page: number;
    pageSize: number;
    errorsOnly: boolean;
    limit: number;
    metric: ReportMetric;
  };
/** Compare minute buckets with the average of the other observed minutes, including silent gaps.
 * This is a descriptive concentration heuristic, not an anomaly/security classification. */
export function concentratedTrafficPeaks(
  timeline: TrafficDataset['timeline'],
  metric: ReportMetric,
  range: CaptureRange = { start: null, end: null },
) {
  const merged = new Map<
    number,
    { epoch: number; requests: number; bytes: number }
  >();
  for (const bucket of timeline) {
    if (!Number.isFinite(bucket.epoch)) continue;
    const epoch = Math.floor(bucket.epoch / 60000) * 60000;
    const current = merged.get(epoch) || {
      epoch,
      requests: 0,
      bytes: 0,
    };
    current.requests += Number.isFinite(bucket.requests)
      ? Math.max(0, bucket.requests)
      : 0;
    current.bytes += Number.isFinite(bucket.bytes)
      ? Math.max(0, bucket.bytes)
      : 0;
    merged.set(epoch, current);
  }
  const buckets = [...merged.values()].sort(
    (a, b) => a.epoch - b.epoch,
  );
  if (!buckets.length) return [];
  const first = Math.max(buckets[0].epoch, range.start ?? -Infinity);
  const last = Math.min(
    buckets.at(-1)!.epoch + 59999,
    range.end ?? Infinity,
  );
  const minutes =
    Math.floor(last / 60000) - Math.floor(first / 60000) + 1;
  const total = buckets.reduce((n, b) => n + b[metric], 0);
  if (minutes < 2 || total <= 0) return [];
  const minimum = metric === 'requests' ? 3 : 1024;
  const candidates = buckets.filter(
    (b) =>
      b[metric] >= minimum &&
      b[metric] / total >= 0.05 &&
      b[metric] >= 3 * ((total - b[metric]) / (minutes - 1)),
  );
  const groups: (typeof buckets)[] = [];
  for (const b of candidates) {
    const group = groups.at(-1);
    if (group && b.epoch === group.at(-1)!.epoch + 60000)
      group.push(b);
    else groups.push([b]);
  }
  return groups
    .map((group) => {
      const requests = group.reduce((n, b) => n + b.requests, 0),
        bytes = group.reduce((n, b) => n + b.bytes, 0);
      const amount = metric === 'requests' ? requests : bytes;
      const baseline =
        (total - amount) / Math.max(1, minutes - group.length);
      return {
        start: Math.max(first, group[0].epoch),
        end: Math.min(last, group.at(-1)!.epoch + 59999),
        requests,
        bytes,
        share: (amount / total) * 100,
        ratio: baseline > 0 ? amount / group.length / baseline : null,
        minutes: group.length,
      };
    })
    .sort((a, b) => b[metric] - a[metric] || a.start - b.start);
}
export function reportAnalysis(
  result: CaptureResult,
): ReportAnalysis {
  const {
    records: _records,
    options: _options,
    ...aggregate
  } = result;
  return aggregate;
}
export async function collectTrafficReport(
  input: Omit<
    TrafficReport,
    | 'overall'
    | 'selection'
    | 'volume'
    | 'peaks'
    | 'peaksFound'
    | 'selected'
  >,
  query: (query: TrafficReportQuery) => Promise<CaptureResult>,
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<TrafficReport> {
  const check = () => {
    if (signal.aborted)
      throw new DOMException('Export cancelled.', 'AbortError');
  };
  const base = {
    ...emptyCaptureFilters,
    start: null,
    end: null,
    page: 1,
    pageSize: 1,
    errorsOnly: false,
    limit: 10,
    metric: 'requests' as const,
  };
  const read = async (q: TrafficReportQuery) => {
    check();
    const result = await query(q);
    check();
    return reportAnalysis(result);
  };
  progress('Collecting complete capture statistics…');
  const overall = await read(base);
  const selected =
    Object.values(input.filters).some(Boolean) ||
    input.range.start !== null ||
    input.range.end !== null;
  const scoped = { ...base, ...input.filters, ...input.range };
  const selection = selected ? await read(scoped) : overall;
  const volume = await read({ ...scoped, metric: 'bytes' });
  const windows = concentratedTrafficPeaks(
    selection.timeline,
    input.metric,
    input.range,
  );
  const peaks: TrafficReport['peaks'] = [];
  for (const [i, window] of windows.slice(0, 3).entries()) {
    progress(
      `Analyzing concentrated peak ${i + 1} of ${Math.min(3, windows.length)}…`,
    );
    const peakQuery = {
      ...scoped,
      start: window.start,
      end: window.end,
    };
    peaks.push({
      window,
      analysis: await read(peakQuery),
      volume: await read({ ...peakQuery, metric: 'bytes' }),
    });
  }
  const verified = await read(base);
  if (
    JSON.stringify(verified.summary) !==
      JSON.stringify(overall.summary) ||
    verified.diagnosticsTotal !== overall.diagnosticsTotal
  )
    throw new Error(
      'The capture changed during export. Stop ingestion and try again.',
    );
  return {
    ...input,
    selected,
    overall,
    selection,
    volume,
    peaks,
    peaksFound: windows.length,
  };
}
/** Resolve the actual app tokens to sRGB once, when export is requested. */
export function trafficReportPalette(): ReportPalette {
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.append(probe);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', {
    willReadFrequently: true,
  });
  if (!context) {
    probe.remove();
    throw new Error('Cannot read the application theme.');
  }
  const tokens = {
    background: 'background',
    foreground: 'foreground',
    card: 'card',
    cardForeground: 'card-foreground',
    muted: 'muted',
    mutedForeground: 'muted-foreground',
    border: 'border',
    primary: 'primary',
    destructive: 'destructive',
  };
  try {
    return Object.fromEntries(
      Object.entries(tokens).map(([key, token]) => {
        if (
          !getComputedStyle(document.documentElement)
            .getPropertyValue(`--${token}`)
            .trim()
        )
          throw new Error(`Missing theme token: ${token}`);
        probe.style.color = `var(--${token})`;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = getComputedStyle(probe).color;
        context.fillRect(0, 0, 1, 1);
        const pixel = context.getImageData(0, 0, 1, 1).data;
        return [
          key,
          `#${[...pixel]
            .slice(0, 3)
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('')}`,
        ];
      }),
    ) as ReportPalette;
  } finally {
    probe.remove();
  }
}
