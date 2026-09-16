import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';

test('migrations create all tables (no segment)', () => {
  const db = openDb(':memory:');
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  for (const t of ['user','client','task','tag','session','session_tag','settings']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
  assert.ok(!names.includes('segment'), 'segment table should be gone');
});

test('settings row seeded with defaults', () => {
  const db = openDb(':memory:');
  const s = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  assert.equal(s.rounding_minutes, 0);
});

test('only one active session allowed', () => {
  const db = openDb(':memory:');
  const ins = db.prepare('INSERT INTO session (created_at, start_utc, end_utc) VALUES (?, ?, NULL)');
  ins.run(1, 1);
  assert.throws(() => ins.run(2, 2));
});
