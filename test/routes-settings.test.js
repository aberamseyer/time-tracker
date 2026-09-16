import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { getSettings } from '../src/settings.js';

test('settings page shows rounding options', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.get('/settings');
  assert.equal(res.status, 200);
  assert.match(res.text, /Round up/);
});

test('posting rounding updates settings', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/settings').type('form').send({ roundingMinutes: '30' });
  assert.equal(res.status, 302);
  assert.equal(getSettings(db).rounding_minutes, 30);
});

test('invalid rounding re-renders with error', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/settings').type('form').send({ roundingMinutes: '7' });
  assert.equal(res.status, 200);
  assert.match(res.text, /Invalid/);
});
