import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';

test('migrations create all tables', () => {
  const db = openDb(':memory:');
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'"
  ).all().map(r => r.name);
  for (const t of ['user','client','task','tag','session','segment','session_tag','settings']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
});

test('settings row seeded with defaults', () => {
  const db = openDb(':memory:');
  const s = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  assert.equal(s.rounding_minutes, 0);
  assert.equal(s.currency, 'USD');
});

test('only one open segment allowed', () => {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO session (created_at) VALUES (?)').run(1);
  const sid = db.prepare('SELECT id FROM session').get().id;
  db.prepare('INSERT INTO segment (session_id, start_utc) VALUES (?, ?)').run(sid, 10);
  assert.throws(() =>
    db.prepare('INSERT INTO segment (session_id, start_utc) VALUES (?, ?)').run(sid, 20)
  );
});
