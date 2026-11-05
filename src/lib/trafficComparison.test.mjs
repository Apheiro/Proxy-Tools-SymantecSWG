import assert from 'node:assert/strict';
import test from 'node:test';
import { buildComparisonPeriods } from './trafficComparisonTime.ts';
import {
  comparisonCoverage,
  comparisonRate,
  comparisonCsv,
} from './trafficComparison.ts';
const options = {
  mode: 'hourly',
  timeZone: 'UTC',
  from: '09:00',
  to: '10:00',
};
const epoch = (text) => Date.parse(text);

test('only actual discontinuous dates become recurring windows', () => {
  const days = ['2026-11-02', '2026-11-04', '2026-11-07'];
  const periods = buildComparisonPeriods(
    days.map((d) => epoch(`${d}T09:30:00Z`)),
    options,
  );
  assert.deepEqual(
    periods.map((p) => p.label),
    days,
  );
  assert.equal(periods[1].start, epoch('2026-11-04T09:00:00Z'));
});
test('daily ignores prior hour controls and weeks start Monday', () => {
  const events = [epoch('2026-11-04T09:30:00Z')];
  const [daily] = buildComparisonPeriods(events, {
    ...options,
    mode: 'daily',
    from: 'bad',
    to: 'bad',
  });
  assert.equal(daily.end - daily.start, 86400000);
  const [weekly] = buildComparisonPeriods(events, {
    ...options,
    mode: 'weekly',
  });
  assert.equal(weekly.start, epoch('2026-11-02T00:00:00Z'));
  assert.equal(weekly.end, epoch('2026-11-09T00:00:00Z'));
});
test('repeated clock hour has disjoint UTC windows; skipped hour is absent', () => {
  const repeated = buildComparisonPeriods(
    [epoch('2026-11-01T05:30:00Z')],
    {
      ...options,
      timeZone: 'America/New_York',
      from: '01:15',
      to: '01:45',
    },
  );
  assert.deepEqual(
    repeated[0].ranges.map((r) => [
      new Date(r.start).toISOString(),
      new Date(r.end).toISOString(),
    ]),
    [
      ['2026-11-01T05:15:00.000Z', '2026-11-01T05:45:00.000Z'],
      ['2026-11-01T06:15:00.000Z', '2026-11-01T06:45:00.000Z'],
    ],
  );
  assert.equal(
    buildComparisonPeriods([epoch('2026-03-08T07:30:00Z')], {
      ...options,
      timeZone: 'America/New_York',
      from: '02:15',
      to: '02:45',
    }).length,
    0,
  );
});
test('local daily boundaries respect a 23-hour DST day and date clipping', () => {
  const [day] = buildComparisonPeriods(
    [epoch('2026-03-08T12:00:00Z')],
    { ...options, mode: 'daily', timeZone: 'America/New_York' },
  );
  assert.equal(day.end - day.start, 23 * 3600000);
  const [week] = buildComparisonPeriods(
    [epoch('2026-11-04T12:00:00Z')],
    {
      ...options,
      mode: 'weekly',
      dateFrom: '2026-11-04',
      dateTo: '2026-11-05',
    },
  );
  assert.equal(week.end - week.start, 2 * 86400000);
});
test('invalid ascending time ranges explain the problem', () => {
  assert.throws(
    () =>
      buildComparisonPeriods([], {
        ...options,
        from: '10:00',
        to: '09:00',
      }),
    /after the start/,
  );
});
test('partial and disjoint observed durations do not invent time', () => {
  const partial = {
    first: 1800000,
    last: 3600000,
    requests: 60,
    bytes: 600,
    ranges: [{ start: 0, end: 3600000 }],
  };
  assert.equal(comparisonCoverage(partial), 50);
  assert.equal(comparisonRate(partial, 'requests'), 60 / 1800);
  assert.equal(
    comparisonRate({ ...partial, last: partial.first }, 'requests'),
    null,
  );
  assert.equal(
    comparisonCoverage({ ...partial, observedDurationMs: 900000 }),
    25,
  );
});
test('CSV preserves selected context and escapes spreadsheet entity formulas', () => {
  const csv = comparisonCsv({
    generatedAt: '2026-11-05',
    proxy: 'test',
    profile: 'mock',
    metric: 'bytes',
    timeZone: 'UTC',
    topN: 5,
    mode: 'daily',
    from: '09:00',
    to: '10:00',
    dateFrom: '',
    dateTo: '',
    commonInterval: false,
    result: {
      periods: [],
      common: {
        host: [
          {
            name: '=1+1',
            values: [{ periodId: 'day', requests: 7, bytes: 42 }],
          },
        ],
      },
      sources: [],
      excluded: 0,
    },
  });
  assert.ok(csv.includes('"metric","bytes"'));
  assert.ok(csv.includes('"\'=1+1","7","42"'));
});
