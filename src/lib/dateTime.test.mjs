import assert from 'node:assert/strict';
import test from 'node:test';
import { dateTimeToISO, isoToDateTime } from './dateTime.ts';

test('UTC capture ranges preserve inclusive seconds and never acquire a local offset', () => {
  const value = '2026-10-06T00:32:59';
  assert.equal(
    dateTimeToISO(value, 'UTC'),
    '2026-10-06T00:32:59.000Z',
  );
  assert.equal(
    isoToDateTime(dateTimeToISO(value, 'UTC'), 'UTC', 'second'),
    value,
  );
});

test('local Trace ranges round-trip at minute precision', () => {
  const value = '2026-10-06T15:32';
  const expected = new Date(value).toISOString();
  assert.equal(dateTimeToISO(value), expected);
  assert.equal(isoToDateTime(expected), value);
});

test('empty bounds clear and invalid calendar values do not roll into another day', () => {
  for (const value of [
    '',
    'bad',
    '2026-02-29T12:00',
    '2026-04-31T12:00',
    '2026-10-06T24:00',
    '2026-10-06T12:61',
  ]) {
    assert.equal(dateTimeToISO(value, 'UTC'), null, value);
  }
  assert.equal(
    dateTimeToISO('2024-02-29T12:00', 'UTC'),
    '2024-02-29T12:00:00.000Z',
  );
  assert.equal(isoToDateTime(null), '');
  assert.equal(isoToDateTime('bad'), '');
});

test('IANA display zones shift the displayed date without changing the instant', () => {
  const instant = '2026-10-06T00:32:59.000Z';
  assert.equal(
    isoToDateTime(instant, 'America/Argentina/Salta', 'second'),
    '2026-10-05T21:32:59',
  );
  assert.equal(isoToDateTime(instant, 'UTC'), '2026-10-06T00:32');
});
