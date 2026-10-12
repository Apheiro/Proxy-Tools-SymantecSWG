import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findSelectMatch,
  nextSelectIndex,
} from './selectNavigation.ts';

const options = [
  { text: 'All' },
  { text: 'Africa/Abidjan', disabled: true },
  { text: 'America/New York' },
  { text: 'America/Sao Paulo' },
  { text: 'Asia/Tokyo' },
  { text: 'Europe/London', disabled: true },
];

test('arrows skip disabled options, Home/End use enabled endpoints and boundaries do not wrap', () => {
  assert.equal(nextSelectIndex(options, 0, 'ArrowDown'), 2);
  assert.equal(nextSelectIndex(options, 2, 'ArrowUp'), 0);
  assert.equal(nextSelectIndex(options, 4, 'ArrowDown'), 4);
  assert.equal(nextSelectIndex(options, 0, 'ArrowUp'), 0);
  assert.equal(nextSelectIndex(options, 3, 'Home'), 0);
  assert.equal(nextSelectIndex(options, 0, 'End'), 4);
  assert.equal(nextSelectIndex([], -1, 'Home'), -1);
});

test('typeahead searches the complete list, ignores disabled items and supports spaces and casing', () => {
  assert.equal(findSelectMatch(options, 0, 'asia/to'), 4);
  assert.equal(findSelectMatch(options, 0, 'America/New Y'), 2);
  assert.equal(findSelectMatch(options, 2, 'America/New'), 2);
  assert.equal(findSelectMatch(options, 0, 'Africa'), -1);
  assert.equal(findSelectMatch(options, 0, 'unknown'), -1);
});

test('repeated characters cycle matching options and wrap to the first enabled match', () => {
  assert.equal(findSelectMatch(options, 0, 'a'), 2);
  assert.equal(findSelectMatch(options, 2, 'aa'), 3);
  assert.equal(findSelectMatch(options, 3, 'aaa'), 4);
  assert.equal(findSelectMatch(options, 4, 'aaaa'), 0);
});
