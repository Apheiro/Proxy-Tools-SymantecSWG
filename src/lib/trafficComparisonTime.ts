/** Calendar windows are converted to UTC spans before querying SQLite. All ends are exclusive. */
export type ComparisonPeriod = {
  id: string;
  label: string;
  start: number;
  end: number;
  ranges: { start: number; end: number }[];
};
export type ComparisonTimeOptions = {
  mode: 'hourly' | 'daily' | 'weekly';
  timeZone: string;
  from: string;
  to: string;
  dateFrom?: string;
  dateTo?: string;
};
const DAY = 86400000;
const dateText = (epoch: number) =>
  new Date(epoch).toISOString().slice(0, 10);
function calendarDate(value: string) {
  const epoch = Date.parse(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(epoch) ||
    dateText(epoch) !== value
  )
    throw new Error('Choose a valid calendar date.');
  return epoch;
}
function clock(value: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new Error('Choose a time in 24-hour HH:mm format.');
  const [hour, minute] = value.split(':').map(Number);
  return (hour * 60 + minute) * 60000;
}
function localClock(timeZone: string) {
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return (epoch: number) => {
    const parts = Object.fromEntries(
      format.formatToParts(epoch).map((p) => [p.type, p.value]),
    );
    return Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second,
    );
  };
}
/** Handles repeated and skipped local times by intersecting each constant-offset segment.
 * IANA offset transitions are isolated using six-hour samples, then located to the second.
 * Repeated hours may yield two separate query spans; skipped hours contribute no invented time.
 */
function utcRanges(
  localStart: number,
  localEnd: number,
  local: (epoch: number) => number,
) {
  const scanStart = localStart - 2 * DAY;
  const scanEnd = localEnd + 2 * DAY;
  const offset = (epoch: number) =>
    local(epoch) - Math.floor(epoch / 1000) * 1000;
  const segments: { start: number; end: number; offset: number }[] =
    [];
  let segmentStart = scanStart;
  let previous = scanStart;
  let currentOffset = offset(scanStart);
  for (
    let sample = scanStart + 6 * 3600000;
    previous < scanEnd;
    sample += 6 * 3600000
  ) {
    const next = Math.min(sample, scanEnd);
    const nextOffset = offset(next);
    if (nextOffset !== currentOffset) {
      let low = previous,
        high = next;
      while (high - low > 1000) {
        const middle = Math.floor((low + high) / 2000) * 1000;
        if (offset(middle) === currentOffset) low = middle;
        else high = middle;
      }
      segments.push({
        start: segmentStart,
        end: high,
        offset: currentOffset,
      });
      segmentStart = high;
      currentOffset = nextOffset;
    }
    previous = next;
  }
  segments.push({
    start: segmentStart,
    end: scanEnd,
    offset: currentOffset,
  });
  const ranges: { start: number; end: number }[] = [];
  for (const segment of segments) {
    const start = Math.max(
      segment.start,
      localStart - segment.offset,
    );
    const end = Math.min(segment.end, localEnd - segment.offset);
    if (end <= start) continue;
    const last = ranges.at(-1);
    if (last && last.end === start) last.end = end;
    else ranges.push({ start, end });
  }
  return ranges;
}

/** Only dates represented by actual event timestamps become candidates; missing days are never filled. */
export function buildComparisonPeriods(
  epochs: number[],
  options: ComparisonTimeOptions,
): ComparisonPeriod[] {
  const local = localClock(options.timeZone); // Throws for an invalid/unsupported timezone.
  const from = options.mode === 'hourly' ? clock(options.from) : 0;
  const to = options.mode === 'hourly' ? clock(options.to) : DAY;
  if (to <= from)
    throw new Error(
      'The end time must be after the start time on the same day.',
    );
  const lower = options.dateFrom
    ? calendarDate(options.dateFrom)
    : -Infinity;
  const upper = options.dateTo
    ? calendarDate(options.dateTo) + DAY
    : Infinity;
  if (lower >= upper)
    throw new Error(
      'The end date must be on or after the start date.',
    );
  const days = [
    ...new Set(
      epochs
        .filter(Number.isFinite)
        .map((epoch) => Math.floor(local(epoch) / DAY) * DAY),
    ),
  ]
    .filter((day) => day >= lower && day < upper)
    .sort((a, b) => a - b);
  const units = new Map<number, number>();
  for (const day of days) {
    const start =
      options.mode === 'weekly'
        ? day - ((new Date(day).getUTCDay() + 6) % 7) * DAY
        : day;
    units.set(
      start,
      options.mode === 'weekly' ? start + 7 * DAY : start + DAY,
    );
  }
  return [...units].flatMap(([day, next]) => {
    const localStart = Math.max(day + from, lower);
    const localEnd = Math.min(
      options.mode === 'weekly' ? next : day + to,
      upper,
    );
    const ranges = utcRanges(localStart, localEnd, local);
    if (!ranges.length) return []; // Entire requested local interval was skipped by a clock transition.
    const label =
      options.mode === 'weekly'
        ? `${dateText(day)} – ${dateText(next - DAY)}`
        : dateText(day);
    return [
      {
        id: `${options.mode}:${dateText(day)}`,
        label,
        start: ranges[0].start,
        end: ranges.at(-1)!.end,
        ranges,
      },
    ];
  });
}
