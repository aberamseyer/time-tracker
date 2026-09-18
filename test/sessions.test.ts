import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createTask } from '../src/catalog.js';
import { createSession, getSession, updateSession, setSessionTags,
  deleteSession, listSessions, decorateSession,
  distinctDescriptions, latestByDescription } from '../src/sessions.js';

const MIN = 60000;

test('create with start/end, read back (no segments key needed)', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { description: 'Work', startUtc: 0, endUtc: 10 * MIN });
  const s = getSession(db, id)!;
  assert.equal(s.description, 'Work');
  assert.equal(s.start_utc, 0);
  assert.equal(s.end_utc, 10 * MIN);
});

test('update applies only given fields incl times', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { description: 'A', details: 'keep', startUtc: 0, endUtc: MIN });
  updateSession(db, id, { description: 'B', endUtc: 5 * MIN });
  const s = getSession(db, id)!;
  assert.equal(s.description, 'B');
  assert.equal(s.details, 'keep');
  assert.equal(s.end_utc, 5 * MIN);
});

test('setSessionTags replaces set', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { startUtc: 0, endUtc: 1 });
  db.prepare("INSERT INTO tag (id,name) VALUES (1,'x'),(2,'y')").run();
  setSessionTags(db, id, [1, 2]);
  setSessionTags(db, id, [2]);
  assert.deepEqual(getSession(db, id)!.tags.map(t => t.id), [2]);
});

test('decorate: stopped rounds up, running raw', () => {
  const db = openDb(':memory:');
  const t = createTask(db, { name: 'Paid', hourlyRateCents: 6000 });
  const stopped = createSession(db, { taskId: t, startUtc: 0, endUtc: 23 * MIN });
  const ds = decorateSession(db, getSession(db, stopped)!, 999, 15);
  assert.equal(ds.durationMs, 23 * MIN);
  assert.equal(ds.roundedMs, 30 * MIN);            // ceil
  assert.equal(ds.earningsCents, 3000);            // 30min @ $60/h
  const running = createSession(db, { taskId: t, startUtc: 0, endUtc: null });
  const dr = decorateSession(db, getSession(db, running)!, 23 * MIN, 15);
  assert.equal(dr.running, true);
  assert.equal(dr.roundedMs, 23 * MIN);            // raw while running
});

test('filters unlabelled/uncategorized', () => {
  const db = openDb(':memory:');
  const t = createTask(db, { name: 'T' });
  createSession(db, { description: 'x', taskId: t, startUtc: 1, endUtc: 2 });
  const bare = createSession(db, { startUtc: 3, endUtc: 4 });
  assert.deepEqual(listSessions(db, { unlabelled: true }).map(s => s.id), [bare]);
  assert.deepEqual(listSessions(db, { uncategorized: true }).map(s => s.id), [bare]);
});

test('delete removes session', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { startUtc: 0, endUtc: 1 });
  deleteSession(db, id);
  assert.equal(getSession(db, id), undefined);
});

test('autocomplete: distinct descriptions and template', () => {
  const db = openDb(':memory:');
  const t = createTask(db, { name: 'Dev' });
  const older = createSession(db, { description: 'Bug fix', details: 'old', taskId: t, startUtc: 0, endUtc: 1 });
  db.prepare("INSERT INTO tag (id,name) VALUES (1,'urgent')").run();
  setSessionTags(db, older, [1]);
  const newer = createSession(db, { description: 'Bug fix', details: 'new', taskId: t, startUtc: 10, endUtc: 11 });
  setSessionTags(db, newer, [1]);
  createSession(db, { description: 'Other', startUtc: 20, endUtc: 21 });
  assert.deepEqual(distinctDescriptions(db, 'Bug'), ['Bug fix']);
  const tpl = latestByDescription(db, 'Bug fix')!;
  assert.equal(tpl.details, 'new');       // most recent
  assert.equal(tpl.task_id, t);
  assert.deepEqual(tpl.tags.map(x => x.id), [1]);
});
