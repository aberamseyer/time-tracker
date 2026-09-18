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
  const res = await agent.post('/quick/task').type('form').send({ _qtask: 'Research' });
  assert.equal(res.status, 200);
  assert.match(res.text, /<option value="\d+" selected>Research<\/option>/);
  assert.ok(listTasks(db).some(t => t.name === 'Research'));
});

test('quick-add tag returns a checked chip', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/quick/tag').type('form').send({ _qtag: 'billable' });
  assert.equal(res.status, 200);
  assert.match(res.text, /name="tagId" value="\d+" checked/);
  assert.ok(listTags(db).some(t => t.name === 'billable'));
});
