import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { createSession, getSession } from '../src/sessions.js';
import { createTask, createTag } from '../src/catalog.js';

test('time filter shows only sessions without a task', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const now = Date.now();
  const t = createTask(db, { name: 'Paid' });
  createSession(db, { description: 'labeled', taskId: t, startUtc: now - 3600000, endUtc: now });
  createSession(db, { description: 'bareone', startUtc: now - 7200000, endUtc: now - 3600000 });
  const res = await agent.get('/partials/tracking-list?taskId=0');
  assert.match(res.text, /bareone/);
  assert.doesNotMatch(res.text, /labeled/);
});

test('manual create composes civil start/end from date + times', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const bad = await agent.post('/sessions').type('form').send({ date: '2026-09-15', start: '10:00', end: '09:00' });
  assert.equal(bad.status, 400);
  assert.equal((db.prepare('SELECT COUNT(*) c FROM session').get() as { c: number }).c, 0);
  const ok = await agent.post('/sessions').type('form').send({ description: 'Call', date: '2026-09-15', start: '09:00', end: '10:30' });
  assert.equal(ok.status, 200);
  const s = db.prepare('SELECT * FROM session').get() as { start_utc: number; end_utc: number; paused_ms: number };
  assert.equal(s.start_utc, Date.parse('2026-09-15T09:00Z'));
  assert.equal(s.end_utc, Date.parse('2026-09-15T10:30Z'));
  assert.equal(s.paused_ms, 0);
});

test('edit composes times and preserves paused_ms', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const id = createSession(db, {
    startUtc: Date.parse('2026-09-15T09:00Z'), endUtc: Date.parse('2026-09-15T10:00Z'), pausedMs: 15 * 60000,
  });
  const res = await agent.post('/sessions/' + id).type('form')
    .send({ description: 'Fixed', date: '2026-09-15', start: '09:30', end: '11:00' });
  assert.equal(res.status, 200);
  assert.match(res.text, new RegExp(`hx-get="/sessions/${id}/edit"`));
  const s = getSession(db, id)!;
  assert.equal(s.start_utc, Date.parse('2026-09-15T09:30Z'));
  assert.equal(s.end_utc, Date.parse('2026-09-15T11:00Z'));
  assert.equal(s.paused_ms, 15 * 60000);            // untouched
});

test('template endpoint prefills from last matching description', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const t = createTask(db, { name: 'Dev' });
  createSession(db, { description: 'Bug fix', details: 'notes', taskId: t, startUtc: 1, endUtc: 2 });
  const res = await agent.get('/sessions/template').query({ description: 'Bug fix' });
  assert.equal(res.status, 200);
  assert.match(res.text, /notes/);            // details prefilled
  assert.match(res.text, new RegExp(`value="${t}" selected`)); // task preselected
});

test('empty quick-task name rejected 400', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/quick/task').type('form').send({ _qtask: '' });
  assert.equal(res.status, 400);
});

test('xss: search param is escaped on Time view', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.get('/').query({ q: '"><script>alert(1)</script>' });
  assert.doesNotMatch(res.text, /<script>alert\(1\)<\/script>/);
});
