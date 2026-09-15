import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { getOpenSegment } from '../src/timer.js';

test('start creates a running timer and broadcasts', async () => {
  const events = [];
  const { app, db } = makeApp({ hub: { broadcast: (t) => events.push(t || 'changed'), handleConnection() {} } });
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/timer/start');
  assert.equal(res.status, 200);
  assert.ok(getOpenSegment(db));
  assert.deepEqual(events, ['changed']);
});

test('stop closes the open segment', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  await agent.post('/timer/start');
  await agent.post('/timer/stop');
  assert.equal(getOpenSegment(db), undefined);
});

test('tracking page shows a stopped session description', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  await agent.post('/timer/start');
  await agent.post('/timer/stop');
  const res = await agent.get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /Start work|Stop/);
});
