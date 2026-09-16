import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb } from './helpers.js';
import { buildReport, periodOf, listPeriods } from '../src/analytics.js';
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
  assert.equal(rep.buckets.length, 2);
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

test('quarter period uses weekly buckets spanning three months', () => {
  const db = makeTestDb();
  const p = periodOf('quarter', Date.UTC(2026, 1, 15)); // Feb -> Q1
  assert.equal(p.unit, 'week');
  assert.equal(p.label, 'Q1 2026');
  assert.equal(p.from, Date.UTC(2026, 0, 1));
  assert.equal(p.to, Date.UTC(2026, 2, 31));
});

test('month period covers the calendar month by day', () => {
  const p = periodOf('month', Date.UTC(2026, 3, 10)); // April
  assert.equal(p.unit, 'day');
  assert.equal(p.from, Date.UTC(2026, 3, 1));
  assert.equal(p.to, Date.UTC(2026, 3, 30));
});

test('listPeriods enumerates weeks between first and last session, newest first', () => {
  const db = makeTestDb();
  createSession(db, { startUtc: day(0), endUtc: day(0) + 3600000 });
  createSession(db, { startUtc: day(20), endUtc: day(20) + 3600000 });
  const weeks = listPeriods(db, 'week');
  assert.ok(weeks.length >= 3);
  assert.ok(weeks[0].ps > weeks[weeks.length - 1].ps); // newest first
});
