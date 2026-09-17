import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { getActiveSession } from '../src/timer.js';
import { getSession, createSession } from '../src/sessions.js';
import { createTask } from '../src/catalog.js';
import { updateSettings } from '../src/settings.js';

test('start creates a running session and broadcasts', async () => {
  const events = [];
  const { app, db } = makeApp({ hub: { broadcast: (t) => events.push(t || 'changed'), handleConnection() {} } });
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/timer/start');
  assert.equal(res.status, 200);
  assert.ok(getActiveSession(db));
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
  assert.equal(getActiveSession(db), undefined);
});

test('edit while running updates description and task', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const t = createTask(db, { name: 'Paid' });
  await agent.post('/timer/start');
  const id = getActiveSession(db).id;
  const res = await agent.post('/timer/update').type('form').send({ description: 'Live edit', taskId: String(t) });
  assert.equal(res.status, 200);
  const s = getSession(db, id);
  assert.equal(s.description, 'Live edit');
  assert.equal(s.task_id, t);
});

test('active session is excluded from the list', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  createSession(db, { description: 'DONEONE', startUtc: 1, endUtc: 2 });
  createSession(db, { description: 'ACTIVEONE', startUtc: Date.now(), endUtc: null });
  const res = await agent.get('/partials/tracking-list');
  assert.match(res.text, /DONEONE/);
  assert.doesNotMatch(res.text, /ACTIVEONE/);
});

test('monthly grouping paginates one period per page', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  updateSettings(db, { sessionGrouping: 'month' });
  createSession(db, { description: 'SEPWORK', startUtc: Date.parse('2026-09-15T10:00Z'), endUtc: Date.parse('2026-09-15T11:00Z') });
  createSession(db, { description: 'AUGWORK', startUtc: Date.parse('2026-08-15T10:00Z'), endUtc: Date.parse('2026-08-15T11:00Z') });
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
  const t = createTask(db, { name: 'Dev' });
  createSession(db, { description: 'Standup', details: 'daily', taskId: t, startUtc: 1, endUtc: 2 });
  await agent.post('/timer/start');
  const id = getActiveSession(db).id;
  // only description sent; details/task empty -> filled from template
  await agent.post('/timer/update').type('form').send({ description: 'Standup', details: '', taskId: '' });
  const s = getSession(db, id);
  assert.equal(s.details, 'daily');
  assert.equal(s.task_id, t);
});
