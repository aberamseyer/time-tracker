import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { getActiveSession } from '../src/timer.js';
import { getSession, createSession } from '../src/sessions.js';
import { createTask } from '../src/catalog.js';

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
