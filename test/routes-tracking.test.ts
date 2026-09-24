import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { getActiveSession } from '../src/timer.js';
import { getSession, createSession } from '../src/sessions.js';
import { createTask } from '../src/catalog.js';
import { updateSettings } from '../src/settings.js';
import { MS_PER_HOUR, MS_PER_DAY } from '../src/constants.js';

test('start creates a running session and broadcasts', async () => {
  const events: string[] = [];
  const { app, db } = makeApp({ hub: { notify: (uid: number, t?: string) => events.push(t || 'changed'), handleConnection() {} } });
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/timer/start');
  assert.equal(res.status, 200);
  assert.ok(getActiveSession(db, 1));
  assert.deepEqual(events, ['changed']);
});

test('pause then resume keeps one active session', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  await agent.post('/timer/start');
  await agent.post('/timer/pause');
  await agent.post('/timer/resume');
  await agent.post('/timer/stop');
  assert.equal(getActiveSession(db, 1), undefined);
});

test('edit while running updates description and task', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const t = createTask(db, { name: 'Paid', }, 1);
  await agent.post('/timer/start');
  const id = getActiveSession(db, 1)!.id;
  const res = await agent.post('/timer/update').type('form').send({ description: 'Live edit', taskId: String(t) });
  assert.equal(res.status, 200);
  const s = getSession(db, id, 1)!;
  assert.equal(s.description, 'Live edit');
  assert.equal(s.task_id, t);
});

test('active session is excluded from the list', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  createSession(db, { description: 'DONEONE', startUtc: 1, endUtc: 2, userId: 1 });
  createSession(db, { description: 'ACTIVEONE', startUtc: Date.now(), endUtc: null, userId: 1 });
  const res = await agent.get('/partials/tracking-list');
  assert.match(res.text, /DONEONE/);
  assert.doesNotMatch(res.text, /ACTIVEONE/);
});

test('monthly grouping paginates one period per page', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  updateSettings(db, 1, { sessionGrouping: 'month' });
  createSession(db, { description: 'SEPWORK', startUtc: Date.parse('2026-09-15T10:00Z'), endUtc: Date.parse('2026-09-15T11:00Z'), userId: 1 });
  createSession(db, { description: 'AUGWORK', startUtc: Date.parse('2026-08-15T10:00Z'), endUtc: Date.parse('2026-08-15T11:00Z'), userId: 1 });
  const first = await agent.get('/partials/tracking-list');
  assert.match(first.text, /SEPWORK/);
  assert.doesNotMatch(first.text, /AUGWORK/);
  assert.match(first.text, /offset=1/);            // load-more sentinel
  const second = await agent.get('/partials/tracking-list?offset=1');
  assert.match(second.text, /AUGWORK/);
});

test('naming running work autocompletes empty fields from history', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const t = createTask(db, { name: 'Dev', }, 1);
  createSession(db, { description: 'Standup', details: 'daily', taskId: t, startUtc: 1, endUtc: 2, userId: 1 });
  await agent.post('/timer/start');
  const id = getActiveSession(db, 1)!.id;
  // only description sent; details/task empty -> filled from template
  await agent.post('/timer/update').type('form').send({ description: 'Standup', details: '', taskId: '' });
  const s = getSession(db, id, 1)!;
  assert.equal(s.details, 'daily');
  assert.equal(s.task_id, t);
});

test('timer start-time clamps to [local midnight, now] on real instants', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  await agent.post('/timer/start').type('form').send({ tz: '0' });
  const id = getActiveSession(db, 1)!.id;
  const now = Date.now();
  const midnight = now - (now % MS_PER_DAY);
  // Midpoint stays within today regardless of time of day.
  const inRange = midnight + Math.floor((now - midnight) / 2);
  await agent.post('/timer/start-time').type('form').send({ start: String(inRange), tz: '0' });
  assert.equal(getSession(db, id, 1)!.start_utc, inRange);
  await agent.post('/timer/start-time').type('form').send({ start: String(now + MS_PER_HOUR), tz: '0' });
  assert.ok(getSession(db, id, 1)!.start_utc! <= Date.now() + 1000);
  await agent.post('/timer/start-time').type('form').send({ start: String(midnight - 5 * MS_PER_HOUR), tz: '0' });
  assert.ok(getSession(db, id, 1)!.start_utc! >= midnight);
});

test('timer split closes an overdue running session', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  createSession(db, { description: 'overnight', startUtc: Date.now() - 2 * MS_PER_DAY, endUtc: null, userId: 1 });
  const res = await agent.post('/timer/split').type('form').send({ tz: '0' });
  assert.equal(res.status, 204);
  const todayMidnight = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  assert.equal(getActiveSession(db, 1)!.start_utc, todayMidnight);
});