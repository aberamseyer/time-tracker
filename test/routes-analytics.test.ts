import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { createSession } from '../src/sessions.js';
import { createTask, createClient } from '../src/catalog.js';

const UID = 1;

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
  const t = createTask(db, { name: 'Dev', userId: UID });
  const now = Date.now();
  createSession(db, { description: 'Work', taskId: t, startUtc: now - 3600000, endUtc: now, userId: UID });
  const res = await agent.get(`/export.csv?taskId=${t}`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.headers['content-disposition'], /attachment/);
  assert.ok(res.text.includes('Work'));
});

test('panel renders client/task/tag filters', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  createClient(db, { name: 'Acme' }, UID);
  const res = await agent.get('/partials/analytics-panel');
  assert.match(res.text, /name="clientId"/);
  assert.match(res.text, /All clients/);
  assert.match(res.text, /Acme/);
});

test('export accepts multiple task filters', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const a = createTask(db, { name: 'A', userId: UID }), b = createTask(db, { name: 'B', userId: UID }), c = createTask(db, { name: 'C', userId: UID });
  const now = Date.now();
  createSession(db, { description: 'aa', taskId: a, startUtc: now - 3600000, endUtc: now, userId: UID });
  createSession(db, { description: 'bb', taskId: b, startUtc: now - 3600000, endUtc: now, userId: UID });
  createSession(db, { description: 'cc', taskId: c, startUtc: now - 3600000, endUtc: now, userId: UID });
  const res = await agent.get(`/export.csv?taskId=${a}&taskId=${b}`);
  assert.ok(res.text.includes('aa') && res.text.includes('bb'));
  assert.ok(!res.text.includes('cc'));
});

test('csv export filters by client and names it in a Client column', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const acme = createClient(db, { name: 'Acme' }, UID);
  const paid = createTask(db, { name: 'Paid', clientId: acme, userId: UID });
  const other = createTask(db, { name: 'Other', userId: UID });
  const now = Date.now();
  createSession(db, { description: 'BillMe', taskId: paid, startUtc: now - 3600000, endUtc: now, userId: UID });
  createSession(db, { description: 'Ignore', taskId: other, startUtc: now - 7200000, endUtc: now - 3600000, userId: UID });
  const res = await agent.get(`/export.csv?clientId=${acme}`);
  assert.equal(res.status, 200);
  assert.match(res.text.split('\n')[0], /^Date,.*,Client,Task,/);
  assert.ok(res.text.includes('BillMe'));
  assert.ok(res.text.includes('Acme'));
  assert.ok(!res.text.includes('Ignore'));
});