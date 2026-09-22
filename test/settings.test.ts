import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { getSettings, updateSettings } from '../src/settings.js';

test('defaults then update rounding', () => {
  const db = openDb(':memory:');
  assert.equal(getSettings(db, 1).rounding_minutes, 0);
  updateSettings(db, 1, { roundingMinutes: 30 });
  assert.equal(getSettings(db, 1).rounding_minutes, 30);
});

test('rejects invalid rounding', () => {
  const db = openDb(':memory:');
  assert.throws(() => updateSettings(db, 1, { roundingMinutes: 7 }), /invalid rounding/);
});

test('defaults then update grouping and week start', () => {
  const db = openDb(':memory:');
  assert.equal(getSettings(db, 1).session_grouping, 'day');
  assert.equal(getSettings(db, 1).week_start, 1);
  updateSettings(db, 1, { sessionGrouping: 'week', weekStart: 0 });
  assert.equal(getSettings(db, 1).session_grouping, 'week');
  assert.equal(getSettings(db, 1).week_start, 0);
});

test('rejects invalid grouping and week start', () => {
  const db = openDb(':memory:');
  assert.throws(() => updateSettings(db, 1, { sessionGrouping: 'yearly' }), /invalid grouping/);
  assert.throws(() => updateSettings(db, 1, { weekStart: 9 }), /invalid week start/);
});

test('biweek is a valid session grouping', () => {
  const db = openDb(':memory:');
  updateSettings(db, 1, { sessionGrouping: 'biweek' });
  assert.equal(getSettings(db, 1).session_grouping, 'biweek');
});