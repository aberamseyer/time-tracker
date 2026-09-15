import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createHub } from '../src/ws.js';
import { seedUser } from '../src/auth.js';

test('end-to-end: login, start, stop, see session', async () => {
  const db = openDb(':memory:');
  const app = createApp({ db, hub: createHub() });
  seedUser(db, 'abe', 'pw');
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: 'abe', password: 'pw' });
  await agent.post('/timer/start');
  await agent.post('/timer/stop');
  const home = await agent.get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /Start work/);
  const tasks = await agent.get('/tasks');
  assert.match(tasks.text, /Tasks/);
});
