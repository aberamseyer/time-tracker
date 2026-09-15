import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundDurationMs, segmentsDurationMs, earningsCents } from '../src/calc.js';

const MIN = 60000;

test('rounding off returns raw ms', () => {
  assert.equal(roundDurationMs(7 * MIN, 0), 7 * MIN);
});

test('rounds to nearest 15 minutes', () => {
  assert.equal(roundDurationMs(7 * MIN, 15), 0);
  assert.equal(roundDurationMs(8 * MIN, 15), 15 * MIN);
  assert.equal(roundDurationMs(23 * MIN, 15), 30 * MIN);
});

test('rounds to nearest 30 and 60', () => {
  assert.equal(roundDurationMs(20 * MIN, 30), 30 * MIN);
  assert.equal(roundDurationMs(31 * MIN, 60), 60 * MIN);
});

test('sums closed segments', () => {
  const segs = [{ start_utc: 0, end_utc: 10 * MIN }, { start_utc: 20 * MIN, end_utc: 25 * MIN }];
  assert.equal(segmentsDurationMs(segs, 999), 15 * MIN);
});

test('open segment counts to now', () => {
  const segs = [{ start_utc: 0, end_utc: null }];
  assert.equal(segmentsDurationMs(segs, 5 * MIN), 5 * MIN);
});

test('earnings from duration and rate', () => {
  assert.equal(earningsCents(3600000, 4000), 4000);
  assert.equal(earningsCents(1800000, 4000), 2000);
});
