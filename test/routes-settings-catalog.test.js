import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { listTasks, listTags, createTask, createTag } from '../src/catalog.js';

test('settings page lists task/tag management', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  createTask(db, { name: 'Dev' });
  const res = await agent.get('/settings');
  assert.ok(res.text.includes('id="settings-tasks"'));
  assert.ok(res.text.includes('id="settings-tags"'));
  assert.ok(res.text.includes('Dev'));
});

test('create, edit, archive task via settings', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  await agent.post('/settings/tasks').type('form').send({ name: 'Design', color: '#111111', rate: '50' });
  let t = listTasks(db).find(x => x.name === 'Design');
  assert.ok(t);
  assert.equal(t.hourly_rate_cents, 5000);
  await agent.post(`/settings/tasks/${t.id}`).type('form').send({ name: 'Design v2', color: '#222222', rate: '' });
  t = listTasks(db).find(x => x.id === t.id);
  assert.equal(t.name, 'Design v2');
  assert.equal(t.hourly_rate_cents, null);
  await agent.post(`/settings/tasks/${t.id}/archive`);
  assert.equal(listTasks(db).find(x => x.id === t.id), undefined);
});

test('create and archive tag via settings', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/settings/tags').type('form').send({ name: 'billable', color: '#00ff00' });
  assert.ok(res.text.includes('billable'));
  const tag = listTags(db).find(x => x.name === 'billable');
  await agent.post(`/settings/tags/${tag.id}/archive`);
  assert.equal(listTags(db).find(x => x.id === tag.id), undefined);
});

test('empty task name rejected', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/settings/tasks').type('form').send({ name: '' });
  assert.equal(res.status, 400);
});
