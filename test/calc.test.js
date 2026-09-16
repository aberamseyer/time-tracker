import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundUpDurationMs, sessionDurationMs, earningsCents } from '../src/calc.js';

const MIN = 60000;

test('rounding off returns raw ms', () => {
  assert.equal(roundUpDurationMs(7 * MIN, 0), 7 * MIN);
});

test('ceil: 0 stays 0, exact multiple stays, else rounds up', () => {
  assert.equal(roundUpDurationMs(0, 15), 0);
  assert.equal(roundUpDurationMs(1 * MIN, 15), 15 * MIN);
  assert.equal(roundUpDurationMs(15 * MIN, 15), 15 * MIN);
  assert.equal(roundUpDurationMs(16 * MIN, 15), 30 * MIN);
  assert.equal(roundUpDurationMs(31 * MIN, 30), 60 * MIN);
  assert.equal(roundUpDurationMs(61 * MIN, 60), 120 * MIN);
});

test('duration without pause is end-start', () => {
  assert.equal(sessionDurationMs({ start_utc: 0, end_utc: 10 * MIN, paused_ms: 0, pause_started_at: null }, 999), 10 * MIN);
});

test('running session counts to now', () => {
  assert.equal(sessionDurationMs({ start_utc: 0, end_utc: null, paused_ms: 0, pause_started_at: null }, 5 * MIN), 5 * MIN);
});

test('paused_ms subtracts from duration', () => {
  assert.equal(sessionDurationMs({ start_utc: 0, end_utc: 30 * MIN, paused_ms: 10 * MIN, pause_started_at: null }, 999), 20 * MIN);
});

test('currently paused freezes elapsed', () => {
  // started at 0, paused at 10min, now 25min -> elapsed frozen at 10min
  assert.equal(sessionDurationMs({ start_utc: 0, end_utc: null, paused_ms: 0, pause_started_at: 10 * MIN }, 25 * MIN), 10 * MIN);
});

test('earnings from duration and rate', () => {
  assert.equal(earningsCents(3600000, 4000), 4000);
});
