export type DateTimePrecision = 'minute' | 'second';
export type DateTimeZone = 'local' | 'UTC';

/** Convert a civil input to an instant without implicitly interpreting UTC as local time. */
export function dateTimeToISO(
  value: string,
  zone: DateTimeZone = 'local',
): string | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
      value,
    );
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00'] = match;
  const civil = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const date = new Date(`${civil}${zone === 'UTC' ? 'Z' : ''}`);
  if (!Number.isFinite(date.getTime())) return null;
  // Reject rolled-over calendar dates and nonexistent local times.
  if (isoToDateTime(date.toISOString(), zone, 'second') !== civil)
    return null;
  return date.toISOString();
}

/** Civil values are for display only; stored/picker values remain ISO UTC instants. */
export function isoToDateTime(
  value: string | null,
  zone: string = 'local',
  precision: DateTimePrecision = 'minute',
): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    ...(zone === 'local' ? {} : { timeZone: zone }),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === name)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}${precision === 'second' ? `:${part('second')}` : ''}`;
}
