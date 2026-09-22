import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb } from './helpers.js';
import { buildReport, periodOf, listPeriods } from '../src/analytics.js';
import { createSession, setSessionTags } from '../src/sessions.js';
import { createTask, createTag, createClient } from '../src/catalog.js';

import { MS_PER_DAY, MS_PER_MINUTE, MS_PER_HOUR } from '../src/constants.js';
const DAY = MS_PER_DAY;
const day = (n: number) => Date.UTC(2026, 0, 1) + n * DAY; // Jan 1 2026 + n days

test('report groups working time by task per day', () => {
  const db = makeTestDb();
  const t = createTask(db, { name: 'Dev' }, 1);
  createSession(db, { taskId: t, startUtc: day(0), endUtc: day(0) + MS_PER_HOUR, userId: 1 }); // 1h
  createSession(db, { taskId: null, startUtc: day(1), endUtc: day(1) + (MS_PER_MINUTE * 30), userId: 1 }); // 30m no task
  const rep = buildReport(db, { from: day(0), to: day(1), by: 'task', metric: 'time', rounding: 0, userId: 1 });
  assert.equal(rep.buckets.length, 2);
  const dev = rep.series.find(s => s.name === 'Dev');
  const none = rep.series.find(s => s.name === 'No task');
  assert.equal(dev!.values[0], MS_PER_HOUR);
  assert.equal(dev!.total, MS_PER_HOUR);
  assert.equal(none!.values[1], (MS_PER_MINUTE * 30));
  assert.equal(rep.grandTotal, MS_PER_HOUR + (MS_PER_MINUTE * 30));
});

test('report counts a session under each of its tags', () => {
  const db = makeTestDb();
  const a = createTag(db, {name: 'a'}, 1), b = createTag(db, {name: 'b'}, 1);
  const id = createSession(db, { startUtc: day(0), endUtc: day(0) + MS_PER_HOUR, userId: 1 });
  setSessionTags(db, id, [a, b], 1);
  const rep = buildReport(db, { from: day(0), to: day(0), by: 'tag', metric: 'time', userId: 1 });
  assert.equal(rep.series.length, 2);
  assert.equal(rep.grandTotal, (MS_PER_HOUR * 2)); // counted twice, once per tag
});

test('running sessions are excluded', () => {
  const db = makeTestDb();
  createSession(db, { startUtc: day(0), endUtc: null, userId: 1 });
  const rep = buildReport(db, { from: day(0), to: day(0), by: 'task', metric: 'time', userId: 1 });
  assert.equal(rep.grandTotal, 0);
});

test('report filters by client and by task ids', () => {
  const db = makeTestDb();
  const acme = createClient(db, {name: 'Acme'}, 1);
  const t1 = createTask(db, { name: 'Billed', clientId: acme }, 1);
  const t2 = createTask(db, { name: 'Loose' }, 1);
  createSession(db, { taskId: t1, startUtc: day(0), endUtc: day(0) + MS_PER_HOUR, userId: 1 });
  createSession(db, { taskId: t2, startUtc: day(0), endUtc: day(0) + MS_PER_HOUR, userId: 1 });
  const byClient = buildReport(db, { from: day(0), to: day(0), by: 'task', metric: 'time', clientId: acme, userId: 1 });
  assert.deepEqual(byClient.series.map(s => s.name), ['Billed']);
  const byTask = buildReport(db, { from: day(0), to: day(0), by: 'task', metric: 'time', taskIds: [t2], userId: 1 });
  assert.deepEqual(byTask.series.map(s => s.name), ['Loose']);
});

test('earnings metric uses task rate', () => {
  const db = makeTestDb();
  const t = createTask(db, { name: 'Paid', hourlyRateCents: 6000 }, 1); // $60/h
  createSession(db, { taskId: t, startUtc: day(0), endUtc: day(0) + MS_PER_HOUR, userId: 1 });
  const rep = buildReport(db, { from: day(0), to: day(0), by: 'task', metric: 'earnings', userId: 1 });
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
  createSession(db, { startUtc: day(0), endUtc: day(0) + MS_PER_HOUR });
  createSession(db, { startUtc: day(20), endUtc: day(20) + MS_PER_HOUR });
  const weeks = listPeriods(db, 'week');
  assert.ok(weeks.length >= 3);
  assert.ok(weeks[0].ps > weeks[weeks.length - 1].ps); // newest first
});

test('biweek period is 14 days anchored to week start', () => {
  const a = periodOf('biweek', Date.UTC(2026, 8, 16), 1); // Wed Sep 16 2026
  assert.equal(a.to - a.from, 13 * 86400000);
  assert.equal(a.unit, 'day');
  assert.equal(new Date(a.start).getUTCDay(), 1); // Monday-aligned
  const next = periodOf('biweek', a.start + 14 * 86400000, 1);
  assert.equal(next.start, a.start + 14 * 86400000);
  const within = periodOf('biweek', a.start + 5 * 86400000, 1);
  assert.equal(within.start, a.start); // same fortnight
});
