import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundUpDurationMs, sessionDurationMs, earningsCents } from '../src/calc.js';
import { MS_PER_MINUTE, MS_PER_HOUR } from '../src/constants.js';

test('rounding off returns raw ms', () => {
  assert.equal(roundUpDurationMs(7 * MS_PER_MINUTE, 0), 7 * MS_PER_MINUTE);
});

test('ceil: 0 stays 0, exact multiple stays, else rounds up', () => {
  assert.equal(roundUpDurationMs(0, 15), 0);
  assert.equal(roundUpDurationMs(1 * MS_PER_MINUTE, 15), 15 * MS_PER_MINUTE);
  assert.equal(roundUpDurationMs(15 * MS_PER_MINUTE, 15), 15 * MS_PER_MINUTE);
  assert.equal(roundUpDurationMs(16 * MS_PER_MINUTE, 15), 30 * MS_PER_MINUTE);
  assert.equal(roundUpDurationMs(31 * MS_PER_MINUTE, 30), 60 * MS_PER_MINUTE);
  assert.equal(roundUpDurationMs(61 * MS_PER_MINUTE, 60), 120 * MS_PER_MINUTE);
});

test('duration without pause is end-start', () => {
  assert.equal(sessionDurationMs({ start_utc: 0, end_utc: 10 * MS_PER_MINUTE, paused_ms: 0, pause_started_at: null }, 999), 10 * MS_PER_MINUTE);
});

test('running session counts to now', () => {
  assert.equal(sessionDurationMs({ start_utc: 0, end_utc: null, paused_ms: 0, pause_started_at: null }, 5 * MS_PER_MINUTE), 5 * MS_PER_MINUTE);
});

test('paused_ms subtracts from duration', () => {
  assert.equal(sessionDurationMs({ start_utc: 0, end_utc: 30 * MS_PER_MINUTE, paused_ms: 10 * MS_PER_MINUTE, pause_started_at: null }, 999), 20 * MS_PER_MINUTE);
});

test('currently paused freezes elapsed', () => {
  // started at 0, paused at 10min, now 25min -> elapsed frozen at 10min
  assert.equal(sessionDurationMs({ start_utc: 0, end_utc: null, paused_ms: 0, pause_started_at: 10 * MS_PER_MINUTE }, 25 * MS_PER_MINUTE), 10 * MS_PER_MINUTE);
});

test('earnings from duration and rate', () => {
  assert.equal(earningsCents(MS_PER_HOUR, 4000), 4000);
});
