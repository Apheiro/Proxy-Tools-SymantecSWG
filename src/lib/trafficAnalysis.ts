export type LogValue = {
  raw: string;
  value: string | null;
  availability: string;
};
export type TrafficRecord = {
  issues?: string[];
  id: string;
  source: string;
  schema: string[];
  rawLine: string;
  rawFields: Record<string, LogValue>;
  normalized: Record<string, LogValue>;
  timestamp: string | null;
  malformed: boolean;
};
export type TrafficDataset = {
  captureId?: string | null;
  source: string;
  timeline: { epoch: number; requests: number; bytes: number }[];
  fields: string[];
  records: TrafficRecord[];
  diagnostics: {
    expectedFields: number;
    receivedValues: number;
    source: string;
    rawLine: string;
    errorType: string;
  }[];
  fieldAvailability: {
    name: string;
    status: string;
    populated: number;
    total: number;
  }[];
  receivedLines: number;
  recordsProcessed: number;
  bytesProcessed: number;
  diagnosticsTotal: number;
};

export const fieldValue = (record: TrafficRecord, name: string) =>
  record.rawFields[name]?.value ?? '';
export const usable = (record: TrafficRecord, name: string) =>
  fieldValue(record, name).trim() !== '';
export const bytesOf = (record: TrafficRecord) =>
  ['cs-bytes', 'sc-bytes'].reduce(
    (sum, key) => sum + (Number(fieldValue(record, key)) || 0),
    0,
  );
export const destinationOf = (record: TrafficRecord) =>
  fieldValue(record, 'cs-host') || 'Unknown destination';
export const totalBytes = (records: TrafficRecord[]) =>
  records.reduce((sum, record) => sum + bytesOf(record), 0);
export const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = value / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
};

export type TrafficProcessingConfig = {
  logicalCpus: number;
  recommendedWorkers: number;
  maxWorkers: number;
  chunkBytes: number;
};

export function utcTrafficEpoch(timestamp: string | null): number {
  if (!timestamp) return NaN;
  const iso = timestamp.replace(' ', 'T');
  return Date.parse(
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`,
  );
}

export function trafficTimeZones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  const fallback = [
    'America/Argentina/Buenos_Aires',
    'America/Sao_Paulo',
    'America/Los_Angeles',
    'America/New_York',
    'Europe/London',
    'Europe/Madrid',
    'Asia/Tokyo',
    'Asia/Kolkata',
    'Australia/Sydney',
  ];
  return [
    ...new Set([
      'UTC',
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(intl.supportedValuesOf?.('timeZone') ?? fallback),
    ]),
  ];
}

export function createTrafficTimeFormatter(timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  });
  return (timestamp: string | null | number) => {
    const epoch =
      typeof timestamp === 'number'
        ? timestamp
        : utcTrafficEpoch(timestamp);
    if (!Number.isFinite(epoch))
      return typeof timestamp === 'string'
        ? timestamp
        : 'Unknown time';
    const parts = Object.fromEntries(
      formatter
        .formatToParts(epoch)
        .map((part) => [part.type, part.value]),
    );
    const offset = /^GMT(?:[+-]0(?::00)?)?$/.test(parts.timeZoneName)
      ? 'UTC'
      : parts.timeZoneName;
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${offset}`;
  };
}

export function trafficTimeBins(
  records: TrafficRecord[],
  metric: 'requests' | 'bytes',
  formatTime: ReturnType<typeof createTrafficTimeFormatter>,
): [string, number][] {
  const bins = new Map<number, number>();
  let untimed = 0;
  for (const record of records) {
    const epoch = utcTrafficEpoch(record.timestamp);
    const value = metric === 'bytes' ? bytesOf(record) : 1;
    if (!Number.isFinite(epoch)) {
      untimed += value;
      continue;
    }
    const bucket = Math.floor(epoch / 60000) * 60000;
    bins.set(bucket, (bins.get(bucket) ?? 0) + value);
  }
  const ordered: [string, number][] = [...bins]
    .sort(([a], [b]) => a - b)
    .map(([epoch, count]) => [formatTime(epoch), count]);
  if (untimed) ordered.push(['Unknown time', untimed]);
  return ordered;
}

/** Equal-duration buckets across the complete UTC range, including quiet intervals. */
export function trafficTimelineBins(
  timeline: TrafficDataset['timeline'],
  metric: 'requests' | 'bytes',
  formatTime: ReturnType<typeof createTrafficTimeFormatter>,
): [string, number][] {
  if (!timeline.length) return [];
  const ordered = [...timeline].sort((a, b) => a.epoch - b.epoch);
  const first = ordered[0].epoch;
  const last = ordered.at(-1)!.epoch;
  const width = Math.max(
    60000,
    Math.ceil((last - first + 60000) / (60 * 60000)) * 60000,
  );
  const values = Array.from(
    { length: Math.floor((last - first) / width) + 1 },
    () => 0,
  );
  for (const item of ordered)
    values[Math.floor((item.epoch - first) / width)] += item[metric];
  return values.map((count, index) => [
    `${formatTime(first + index * width)} — ${formatTime(first + (index + 1) * width)}`,
    count,
  ]);
}

export function timelineOf(
  records: TrafficRecord[],
): TrafficDataset['timeline'] {
  const bins = new Map<number, TrafficDataset['timeline'][number]>();
  for (const record of records) {
    const time = utcTrafficEpoch(record.timestamp);
    if (!Number.isFinite(time)) continue;
    const epoch = Math.floor(time / 60000) * 60000;
    const bucket = bins.get(epoch) ?? {
      epoch,
      requests: 0,
      bytes: 0,
    };
    bucket.requests++;
    bucket.bytes += bytesOf(record);
    bins.set(epoch, bucket);
  }
  return [...bins.values()];
}

export function mergeDataset(
  current: TrafficDataset | null,
  incoming: TrafficDataset,
): TrafficDataset {
  if (!current || current.source !== incoming.source)
    return {
      ...incoming,
      records: incoming.records.slice(-5000),
      diagnostics: incoming.diagnostics.slice(-200),
    };
  const records = [...current.records, ...incoming.records].slice(
    -5000,
  );
  const fields = [
    ...new Set([...current.fields, ...incoming.fields]),
  ];
  return {
    ...incoming,
    // Rust owns cumulative counters and timeline for both file and HTTP sources.
    timeline: incoming.timeline,
    fields,
    records,
    diagnostics: [
      ...current.diagnostics,
      ...incoming.diagnostics,
    ].slice(-200),
    fieldAvailability: incoming.fieldAvailability,
    receivedLines: incoming.receivedLines,
    recordsProcessed: incoming.recordsProcessed,
    bytesProcessed: incoming.bytesProcessed,
    diagnosticsTotal: incoming.diagnosticsTotal,
  };
}

export function evaluateRecord(record: TrafficRecord) {
  // Native ingestion classifies issues once; informative filter results are not errors.
  return record.issues ?? [];
}

export function ranked(
  records: TrafficRecord[],
  key: string,
  limit: number,
  metric: 'requests' | 'bytes',
) {
  const buckets = new Map<
    string,
    { requests: number; bytes: number }
  >();
  for (const record of records) {
    const rawName =
      fieldValue(record, key) ||
      (key === 'cs-host' ? destinationOf(record) : 'Unknown');
    const names = [
      'cs-categories',
      'x-bluecoat-application-groups',
    ].includes(key)
      ? rawName
          .split(';')
          .map((value) => value.trim())
          .filter(Boolean)
      : [rawName];
    for (const name of names) {
      const item = buckets.get(name) ?? { requests: 0, bytes: 0 };
      item.requests++;
      item.bytes += bytesOf(record);
      buckets.set(name, item);
    }
  }
  return [...buckets]
    .map(([name, value]) => ({ name, value: value[metric] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}
