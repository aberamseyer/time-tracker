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
  const id = createSession(db, { description: 'Work', startUtc: 0, endUtc: 10 * MIN, userId: 1 });
  const s = getSession(db, id, 1)!;
  assert.equal(s.description, 'Work');
  assert.equal(s.start_utc, 0);
  assert.equal(s.end_utc, 10 * MIN);
});

test('update applies only given fields incl times', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { description: 'A', details: 'keep', startUtc: 0, endUtc: MIN, userId: 1 });
  updateSession(db, id, { description: 'B', endUtc: 5 * MIN }, 1);
  const s = getSession(db, id, 1)!;
  assert.equal(s.description, 'B');
  assert.equal(s.details, 'keep');
  assert.equal(s.end_utc, 5 * MIN);
});

test('setSessionTags replaces set', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { startUtc: 0, endUtc: 1, userId: 1 });
  db.prepare("INSERT INTO tag (id,name,user_id) VALUES (1,'x',1),(2,'y',1)").run();
  setSessionTags(db, id, [1, 2], 1);
  setSessionTags(db, id, [2], 1);
  assert.deepEqual(getSession(db, id, 1)!.tags.map(t => t.id), [2]);
});

test('decorate: stopped rounds up, running raw', () => {
  const db = openDb(':memory:');
  const t = createTask(db, { name: 'Paid', hourlyRateCents: 6000, userId: 1 });
  const stopped = createSession(db, { taskId: t, startUtc: 0, endUtc: 23 * MIN, userId: 1 });
  const ds = decorateSession(db, getSession(db, stopped, 1)!, 999, 15);
  assert.equal(ds.durationMs, 23 * MIN);
  assert.equal(ds.roundedMs, 30 * MIN);            // ceil
  assert.equal(ds.earningsCents, 3000);            // 30min @ $60/h
  const running = createSession(db, { taskId: t, startUtc: 0, endUtc: null, userId: 1 });
  const dr = decorateSession(db, getSession(db, running, 1)!, 23 * MIN, 15);
  assert.equal(dr.running, true);
  assert.equal(dr.roundedMs, 23 * MIN);            // raw while running
});

test('filters unlabelled/uncategorized', () => {
  const db = openDb(':memory:');
  const t = createTask(db, { name: 'T', userId: 1 });
  createSession(db, { description: 'x', taskId: t, startUtc: 1, endUtc: 2, userId: 1 });
  const bare = createSession(db, { startUtc: 3, endUtc: 4, userId: 1 });
  assert.deepEqual(listSessions(db, { unlabelled: true }, 1).map(s => s.id), [bare]);
  assert.deepEqual(listSessions(db, { uncategorized: true }, 1).map(s => s.id), [bare]);
});

test('delete removes session', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { startUtc: 0, endUtc: 1, userId: 1 });
  deleteSession(db, id, 1);
  assert.equal(getSession(db, id, 1), undefined);
});

test('autocomplete: distinct descriptions and template', () => {
  const db = openDb(':memory:');
  const t = createTask(db, { name: 'Dev', userId: 1 });
  const older = createSession(db, { description: 'Bug fix', details: 'old', taskId: t, startUtc: 0, endUtc: 1, userId: 1 });
  db.prepare("INSERT INTO tag (id,name,user_id) VALUES (1,'urgent',1)").run();
  setSessionTags(db, older, [1], 1);
  const newer = createSession(db, { description: 'Bug fix', details: 'new', taskId: t, startUtc: 10, endUtc: 11, userId: 1 });
  setSessionTags(db, newer, [1], 1);
  createSession(db, { description: 'Other', startUtc: 20, endUtc: 21, userId: 1 });
  assert.deepEqual(distinctDescriptions(db, 'Bug', 8, 1), ['Bug fix']);
  const tpl = latestByDescription(db, 'Bug fix', 1)!;
  assert.equal(tpl.details, 'new');       // most recent
  assert.equal(tpl.task_id, t);
  assert.deepEqual(tpl.tags.map(x => x.id), [1]);
});