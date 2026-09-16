import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb } from './helpers.js';
import { buildReport } from '../src/analytics.js';
import { createSession, setSessionTags } from '../src/sessions.js';
import { createTask, createTag } from '../src/catalog.js';

const DAY = 86400000;
const day = (n) => Date.UTC(2026, 0, 1) + n * DAY; // Jan 1 2026 + n days

test('report groups working time by task per day', () => {
  const db = makeTestDb();
  const t = createTask(db, { name: 'Dev' });
  createSession(db, { taskId: t, startUtc: day(0), endUtc: day(0) + 3600000 }); // 1h
  createSession(db, { taskId: null, startUtc: day(1), endUtc: day(1) + 1800000 }); // 30m no task
  const rep = buildReport(db, { from: day(0), to: day(1), by: 'task', metric: 'time', rounding: 0 });
  assert.equal(rep.days.length, 2);
  const dev = rep.series.find(s => s.name === 'Dev');
  const none = rep.series.find(s => s.name === 'No task');
  assert.equal(dev.values[0], 3600000);
  assert.equal(dev.total, 3600000);
  assert.equal(none.values[1], 1800000);
  assert.equal(rep.grandTotal, 3600000 + 1800000);
});

test('report counts a session under each of its tags', () => {
  const db = makeTestDb();
  const a = createTag(db, { name: 'a' }), b = createTag(db, { name: 'b' });
  const id = createSession(db, { startUtc: day(0), endUtc: day(0) + 3600000 });
  setSessionTags(db, id, [a, b]);
  const rep = buildReport(db, { from: day(0), to: day(0), by: 'tag', metric: 'time' });
  assert.equal(rep.series.length, 2);
  assert.equal(rep.grandTotal, 7200000); // counted twice, once per tag
});

test('running sessions are excluded', () => {
  const db = makeTestDb();
  createSession(db, { startUtc: day(0), endUtc: null });
  const rep = buildReport(db, { from: day(0), to: day(0), by: 'task', metric: 'time' });
  assert.equal(rep.grandTotal, 0);
});

test('earnings metric uses task rate', () => {
  const db = makeTestDb();
  const t = createTask(db, { name: 'Paid', hourlyRateCents: 6000 }); // $60/h
  createSession(db, { taskId: t, startUtc: day(0), endUtc: day(0) + 3600000 });
  const rep = buildReport(db, { from: day(0), to: day(0), by: 'task', metric: 'earnings' });
  assert.equal(rep.grandTotal, 6000);
});
