import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { getSettings, updateSettings } from '../src/settings.js';

test('defaults then update rounding', () => {
  const db = openDb(':memory:');
  assert.equal(getSettings(db).rounding_minutes, 0);
  updateSettings(db, { roundingMinutes: 30 });
  assert.equal(getSettings(db).rounding_minutes, 30);
});

test('rejects invalid rounding', () => {
  const db = openDb(':memory:');
  assert.throws(() => updateSettings(db, { roundingMinutes: 7 }), /invalid rounding/);
});
