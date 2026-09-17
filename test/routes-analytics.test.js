import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { createSession } from '../src/sessions.js';
import { createTask, createClient } from '../src/catalog.js';

test('analytics page renders', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.get('/analytics');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('id="analytics"'));
});

test('panel switches to lines and tags via query', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.get('/partials/analytics-panel?chart=lines&by=tag&metric=earnings');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('polyline') || res.text.includes('No completed work'));
});

test('csv export downloads with filters', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const t = createTask(db, { name: 'Dev' });
  const now = Date.now();
  createSession(db, { description: 'Work', taskId: t, startUtc: now - 3600000, endUtc: now });
  const res = await agent.get(`/export.csv?taskId=${t}`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.headers['content-disposition'], /attachment/);
  assert.ok(res.text.includes('Work'));
});

test('csv export filters by client and names it in a Client column', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const acme = createClient(db, { name: 'Acme' });
  const paid = createTask(db, { name: 'Paid', clientId: acme });
  const other = createTask(db, { name: 'Other' });
  const now = Date.now();
  createSession(db, { description: 'BillMe', taskId: paid, startUtc: now - 3600000, endUtc: now });
  createSession(db, { description: 'Ignore', taskId: other, startUtc: now - 7200000, endUtc: now - 3600000 });
  const res = await agent.get(`/export.csv?clientId=${acme}`);
  assert.equal(res.status, 200);
  assert.match(res.text.split('\n')[0], /^Date,.*,Client,Task,/);
  assert.ok(res.text.includes('BillMe'));
  assert.ok(res.text.includes('Acme'));
  assert.ok(!res.text.includes('Ignore'));
});
