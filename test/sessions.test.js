import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createTask } from '../src/catalog.js';
import { createSession, getSession, updateSession, setSessionTags,
  addSegment, deleteSession, listSessions, decorateSession } from '../src/sessions.js';

const MIN = 60000;

test('create with segments, read back', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { description: 'Work', segments: [{ start: 0, end: 10 * MIN }] });
  const s = getSession(db, id);
  assert.equal(s.description, 'Work');
  assert.equal(s.segments.length, 1);
});

test('update applies only given fields', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { description: 'A', details: 'keep' });
  updateSession(db, id, { description: 'B' });
  const s = getSession(db, id);
  assert.equal(s.description, 'B');
  assert.equal(s.details, 'keep');
});

test('setSessionTags replaces set', () => {
  const db = openDb(':memory:');
  const id = createSession(db, {});
  db.prepare("INSERT INTO tag (id,name) VALUES (1,'x'),(2,'y')").run();
  setSessionTags(db, id, [1, 2]);
  setSessionTags(db, id, [2]);
  assert.deepEqual(getSession(db, id).tags.map(t => t.id), [2]);
});

test('decorate computes duration, rounded, earnings', () => {
  const db = openDb(':memory:');
  const t = createTask(db, { name: 'Paid', hourlyRateCents: 6000 });
  const id = createSession(db, { taskId: t, segments: [{ start: 0, end: 23 * MIN }] });
  const d = decorateSession(db, getSession(db, id), 999, 15);
  assert.equal(d.durationMs, 23 * MIN);
  assert.equal(d.roundedMs, 30 * MIN);
  assert.equal(d.earningsCents, 3000);
});

test('filters: unlabelled and uncategorized', () => {
  const db = openDb(':memory:');
  const t = createTask(db, { name: 'T' });
  createSession(db, { description: 'has label', taskId: t, segments: [{ start: 1, end: 2 }] });
  const bare = createSession(db, { segments: [{ start: 3, end: 4 }] });
  assert.deepEqual(listSessions(db, { unlabelled: true }).map(s => s.id), [bare]);
  assert.deepEqual(listSessions(db, { uncategorized: true }).map(s => s.id), [bare]);
});

test('delete cascades segments', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { segments: [{ start: 0, end: 1 }] });
  deleteSession(db, id);
  assert.equal(getSession(db, id), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM segment').get().c, 0);
});
