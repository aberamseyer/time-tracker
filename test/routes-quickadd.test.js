import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { listTasks, listTags } from '../src/catalog.js';
import { createSession } from '../src/sessions.js';

test('quick-add task returns a selected option', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/tasks').type('form').send({ _qtask: 'Research' });
  assert.equal(res.status, 200);
  assert.match(res.text, /<option value="\d+" selected>Research<\/option>/);
  assert.ok(listTasks(db).some(t => t.name === 'Research'));
});

test('quick-add tag returns a checked chip', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/tags').type('form').send({ _qtag: 'billable' });
  assert.equal(res.status, 200);
  assert.match(res.text, /name="tagId" value="\d+" checked/);
  assert.ok(listTags(db).some(t => t.name === 'billable'));
});

test('tasks view auto-opens the focused session editor', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const id = createSession(db, { description: 'Focus me', startUtc: 1, endUtc: 2 });
  const res = await agent.get(`/tasks?focus=${id}`);
  assert.equal(res.status, 200);
  assert.ok(res.text.includes(`id="s-${id}"`));
  assert.ok(res.text.includes('hx-trigger="load, click"'));
});
