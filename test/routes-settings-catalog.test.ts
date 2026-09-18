import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { listTags } from '../src/catalog.js';

test('settings page lists tag management (tasks moved to Tasks view)', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.get('/settings');
  assert.ok(res.text.includes('id="settings-tags"'));
  assert.ok(!res.text.includes('id="settings-tasks"'));
});

test('create and archive tag via settings', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/settings/tags').type('form').send({ name: 'billable', color: '#00ff00' });
  assert.ok(res.text.includes('billable'));
  const tag = listTags(db).find(x => x.name === 'billable')!;
  await agent.post(`/settings/tags/${tag.id}/archive`);
  assert.equal(listTags(db).find(x => x.id === tag.id), undefined);
});

test('empty tag name rejected', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/settings/tags').type('form').send({ name: '' });
  assert.equal(res.status, 400);
});
