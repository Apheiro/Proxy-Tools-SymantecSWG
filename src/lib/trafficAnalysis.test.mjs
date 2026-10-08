import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTrafficTimeFormatter,
  trafficTimeBins,
  trafficTimelineBins,
  utcTrafficEpoch,
} from './trafficAnalysis.ts';

const record = (timestamp) => ({ timestamp, rawFields: {} });

test('preliminary eight-row sample keeps distinct minutes and hours, the peak and quiet intervals', () => {
  const timestamps = [
    '06:00:00',
    '06:05:00',
    '06:05:30',
    '08:30:00',
    '08:30:10',
    '08:30:20',
    '08:30:30',
    '12:45:00',
  ];
  const formatter = createTrafficTimeFormatter('UTC');
  const bins = trafficTimeBins(
    timestamps.map((time) => record(`2026-10-08 ${time}`)),
    'requests',
    formatter,
  );
  assert.deepEqual(
    bins.map(([, count]) => count),
    [1, 2, 4, 1],
  );
  const timeline = bins.map(([label, requests]) => ({
    epoch: utcTrafficEpoch(label.replace(' UTC', '')),
    requests,
    bytes: requests * 100,
  }));
  const chart = trafficTimelineBins(timeline, 'requests', formatter);
  assert.equal(
    chart.reduce((sum, [, value]) => sum + value, 0),
    8,
  );
  assert.equal(Math.max(...chart.map(([, count]) => count)), 4);
  assert.ok(chart.some(([, count]) => count === 0));
  assert.ok(chart.length <= 60);
  assert.ok(chart.at(-1)[0].includes('12:'));
});

test('the full-file chart includes early traffic outside the retained record window', () => {
  const bins = trafficTimelineBins(
    [
      {
        epoch: Date.parse('2026-10-08T06:00:00Z'),
        requests: 10000,
        bytes: 1000000,
      },
      {
        epoch: Date.parse('2026-10-08T12:00:00Z'),
        requests: 5000,
        bytes: 500000,
      },
    ],
    'requests',
    createTrafficTimeFormatter('UTC'),
  );
  assert.equal(
    bins.reduce((sum, [, count]) => sum + count, 0),
    15000,
  );
  assert.equal(bins[0][1], 10000);
  assert.equal(bins.at(-1)[1], 5000);
});

test('UTC source timestamps display in a selected zone across a date boundary', () => {
  const timestamp = '2026-10-08 01:15:00';
  assert.equal(
    utcTrafficEpoch(timestamp),
    Date.parse('2026-10-08T01:15:00Z'),
  );
  assert.equal(
    createTrafficTimeFormatter('UTC')(timestamp),
    '2026-10-08 01:15:00 UTC',
  );
  assert.equal(
    createTrafficTimeFormatter('America/Argentina/Buenos_Aires')(
      timestamp,
    ),
    '2026-10-07 22:15:00 GMT-3',
  );
  assert.equal(
    createTrafficTimeFormatter('Asia/Kolkata')(timestamp),
    '2026-10-08 06:45:00 GMT+5:30',
  );
});

test('DST repeated local hours retain distinct chronological buckets and offsets', () => {
  const bins = trafficTimeBins(
    [record('2026-11-01 06:30:00'), record('2026-11-01 05:30:00')],
    'requests',
    createTrafficTimeFormatter('America/New_York'),
  );
  assert.deepEqual(bins, [
    ['2026-11-01 01:30:00 GMT-4', 1],
    ['2026-11-01 01:30:00 GMT-5', 1],
  ]);
});

test('same clock time on different dates never merges and unknown times remain visible', () => {
  const bins = trafficTimeBins(
    [
      record('2026-10-08 01:00:00'),
      record('2026-10-07 01:00:00'),
      record(null),
    ],
    'requests',
    createTrafficTimeFormatter('UTC'),
  );
  assert.deepEqual(bins, [
    ['2026-10-07 01:00:00 UTC', 1],
    ['2026-10-08 01:00:00 UTC', 1],
    ['Unknown time', 1],
  ]);
  assert.ok(Number.isNaN(utcTrafficEpoch('unavailable')));
});
