import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createHub } from '../src/ws.js';
import { seedUser } from '../src/auth.js';
import { createSession } from '../src/sessions.js';
import { createTask } from '../src/catalog.js';

const UID = 1;

test('e2e: login, start, stop, tracking + tasks pages render', async () => {
  const db = openDb(':memory:');
  const app = createApp({ db, hub: createHub() });
  seedUser(db, 'abe', 'pw');
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: 'abe', password: 'pw' });
  await agent.post('/timer/start');
  await agent.post('/timer/stop');
  const home = await agent.get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /Start work|Resume|Stop/);
  assert.match(home.text, /Add work unit/); // manual add lives on Time now
  const tasks = await agent.get('/tasks');
  assert.equal(tasks.status, 200);
  assert.match(tasks.text, /New client/); // task manager, grouped by client
});

test('e2e: description template prefills the work-unit fields', async () => {
  const db = openDb(':memory:');
  const app = createApp({ db, hub: createHub() });
  seedUser(db, 'abe', 'pw');
  const t = createTask(db, { name: 'Dev', userId: UID });
  createSession(db, { description: 'Recurring', details: 'same as before', taskId: t, startUtc: 1, endUtc: 2, userId: UID });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: 'abe', password: 'pw' });
  const res = await agent.get('/sessions/template').query({ description: 'Recurring' });
  assert.equal(res.status, 200);
  assert.match(res.text, /same as before/);
});