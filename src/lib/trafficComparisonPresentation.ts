import type {
  ComparisonPeriod,
  ComparisonSnapshot,
} from './trafficComparison';
import type { ReportMetric } from './trafficReport';
import { comparisonNumber } from './trafficComparison';
import { formatBytes } from './trafficAnalysis';

export const periodColor = (index: number) =>
  `hsl(${(215 + index * 137.508) % 360} 62% 48%)`;
export function trafficDelta(
  value: number,
  before: number,
  metric: ReportMetric,
) {
  if (!Number.isFinite(value) || !Number.isFinite(before))
    return { text: 'Unavailable', tone: 'text-muted-foreground' };
  const difference = value - before;
  const percentage = before > 0 ? (difference / before) * 100 : null;
  const amount =
    metric === 'bytes'
      ? formatBytes(Math.abs(difference))
      : comparisonNumber(Math.abs(difference));
  return {
    text: `${difference > 0 ? '+' : difference < 0 ? '−' : ''}${amount} (${percentage !== null && Number.isFinite(percentage) ? `${percentage > 0 ? '+' : ''}${comparisonNumber(percentage)}%` : 'no baseline'})`,
    tone:
      before <= 0 || difference === 0
        ? 'text-muted-foreground'
        : difference > 0
          ? 'text-emerald-800 dark:text-emerald-300'
          : 'text-rose-800 dark:text-rose-300',
  };
}
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const clock = (minute: number) => {
  const rounded = Math.round(minute);
  if (rounded === 1440) return '24:00';
  return `${String(Math.floor(rounded / 60) % 24).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
};
export function activityAxis(
  snapshot: Pick<ComparisonSnapshot, 'mode' | 'from' | 'to'>,
) {
  const minute = (text: string) => {
    const [h, m] = text.split(':').map(Number);
    return h * 60 + m;
  };
  return {
    min: snapshot.mode === 'hourly' ? minute(snapshot.from) : 0,
    max:
      snapshot.mode === 'hourly'
        ? minute(snapshot.to)
        : snapshot.mode === 'weekly'
          ? 10080
          : 1440,
    label: (value: number) =>
      snapshot.mode === 'weekly'
        ? value >= 10080
          ? 'Sun 24:00'
          : `${WEEK[Math.floor(value / 1440)]} ${clock(value % 1440)}`
        : clock(value),
  };
}
/** Local clock positions intentionally align days. Repeated clock occurrences retain
 * separate UTC-stamped points; neither their volume nor their coordinates are merged. */
export function activityPoints(
  period: ComparisonPeriod,
  snapshot: Pick<ComparisonSnapshot, 'timeZone' | 'mode' | 'metric'>,
) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: snapshot.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const detail = new Intl.DateTimeFormat('en-GB', {
    timeZone: snapshot.timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  });
  const width = snapshot.mode === 'hourly' ? 60000 : 900000;
  let previous: { epoch: number; x: number } | undefined;
  return period.timeline.flatMap((bucket) => {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(bucket.epoch)
        .map((p) => [p.type, p.value]),
    );
    const x =
      Number(parts.hour) * 60 +
      Number(parts.minute) +
      (snapshot.mode === 'weekly'
        ? WEEK.indexOf(parts.weekday) * 1440
        : 0);
    const separator =
      previous &&
      (x <= previous.x ||
        bucket.epoch - previous.epoch > width ||
        x - previous.x > width / 60000)
        ? [{ value: [x, null], observedAt: '' }]
        : [];
    previous = { epoch: bucket.epoch, x };
    return [
      ...separator,
      {
        value: [x, bucket[snapshot.metric]],
        observedAt: `${detail.format(bucket.epoch)} · ${new Date(bucket.epoch).toISOString()}`,
      },
    ];
  });
}
