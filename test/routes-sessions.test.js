import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { createSession, getSession } from '../src/sessions.js';
import { createTask, createTag } from '../src/catalog.js';

test('unlabelled filter lists only bare sessions', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  createSession(db, { description: 'labeled', startUtc: 1, endUtc: 2 });
  createSession(db, { startUtc: 3, endUtc: 4 });
  const res = await agent.get('/partials/session-list?unlabelled=1');
  assert.match(res.text, /no description/);
  assert.doesNotMatch(res.text, /labeled/);
});

test('manual create requires start and end', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const bad = await agent.post('/sessions').type('form').send({ description: 'x', start: '2026-09-15T09:00' });
  assert.equal(bad.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM session').get().c, 0);
  const ok = await agent.post('/sessions').type('form').send({ description: 'Call', start: '2026-09-15T09:00', end: '2026-09-15T10:00' });
  assert.equal(ok.status, 200);
  const s = db.prepare('SELECT * FROM session').get();
  assert.equal(s.start_utc, Date.parse('2026-09-15T09:00Z'));
  assert.equal(s.end_utc, Date.parse('2026-09-15T10:00Z'));
});

test('edit updates fields and times, returns re-editable row', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const t = createTask(db, { name: 'Paid' });
  const tag = createTag(db, { name: 'Bug' });
  const id = createSession(db, { startUtc: Date.parse('2026-09-15T09:00Z'), endUtc: Date.parse('2026-09-15T10:00Z') });
  const res = await agent.post('/sessions/' + id).type('form')
    .send({ description: 'Fixed', taskId: String(t), tagId: String(tag), start: '2026-09-15T09:30', end: '2026-09-15T10:30' });
  assert.equal(res.status, 200);
  assert.match(res.text, new RegExp(`hx-get="/sessions/${id}/edit"`));
  const s = getSession(db, id);
  assert.equal(s.description, 'Fixed');
  assert.equal(s.start_utc, Date.parse('2026-09-15T09:30Z'));
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

test('empty task name rejected 400', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/tasks').type('form').send({ name: '' });
  assert.equal(res.status, 400);
});

test('xss: q param is escaped', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.get('/tasks').query({ q: '"><script>alert(1)</script>' });
  assert.doesNotMatch(res.text, /<script>alert\(1\)<\/script>/);
});
