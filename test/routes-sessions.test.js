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
  createSession(db, { description: 'labeled', segments: [{ start: 1, end: 2 }] });
  createSession(db, { segments: [{ start: 3, end: 4 }] });
  const res = await agent.get('/partials/session-list?unlabelled=1');
  assert.equal(res.status, 200);
  assert.match(res.text, /no description/);
  assert.doesNotMatch(res.text, /labeled/);
});

test('update session sets description, task, tags', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const t = createTask(db, { name: 'Paid' });
  const tag = createTag(db, { name: 'Bug' });
  const id = createSession(db, { segments: [{ start: 1, end: 2 }] });
  const res = await agent.post('/sessions/' + id).type('form')
    .send({ description: 'Fixed', taskId: String(t), tagId: String(tag) });
  assert.equal(res.status, 200);
  const s = getSession(db, id);
  assert.equal(s.description, 'Fixed');
  assert.equal(s.task_id, t);
  assert.deepEqual(s.tags.map(x => x.id), [tag]);
});

test('edit round-trips datetime-local as UTC without offset shift', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const id = createSession(db, { segments: [{ start: 1, end: 2 }] });
  const res = await agent.post('/sessions/' + id).type('form')
    .send({ description: '', start: '2026-09-15T09:00', end: '2026-09-15T10:00' });
  assert.equal(res.status, 200);
  const s = getSession(db, id);
  assert.equal(s.segments[0].start_utc, Date.parse('2026-09-15T09:00Z'));
  assert.equal(s.segments[0].end_utc, Date.parse('2026-09-15T10:00Z'));
});

test('edit response keeps the row clickable to re-edit', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const id = createSession(db, { segments: [{ start: 1, end: 2 }] });
  const res = await agent.post('/sessions/' + id).type('form')
    .send({ description: 'Fixed' });
  assert.equal(res.status, 200);
  assert.match(res.text, new RegExp(`hx-get="/sessions/${id}/edit"`));
});

test('manual create adds a session', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  await agent.post('/sessions').type('form').send({
    description: 'Call', start: '2026-09-15T09:00', end: '2026-09-15T10:00',
  });
  const rows = db.prepare('SELECT COUNT(*) c FROM session').get().c;
  assert.equal(rows, 1);
});

test('delete removes session', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const id = createSession(db, { segments: [{ start: 1, end: 2 }] });
  await agent.post('/sessions/' + id + '/delete');
  assert.equal(getSession(db, id), undefined);
});

test('manual create without end is rejected and creates no open segment', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/sessions').type('form').send({
    description: 'Call', start: '2026-09-15T09:00',
  });
  assert.equal(res.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM session').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM segment WHERE end_utc IS NULL').get().c, 0);
});

test('manual create without end does not clash with a running timer', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  await agent.post('/timer/start');
  const res = await agent.post('/sessions').type('form').send({
    description: 'Call', start: '2026-09-15T09:00',
  });
  assert.equal(res.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM segment WHERE end_utc IS NULL').get().c, 1);
});

test('edit clearing end is rejected and segment stays closed', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const id = createSession(db, { segments: [{ start: 1, end: 2 }] });
  const res = await agent.post('/sessions/' + id).type('form')
    .send({ description: '', start: '2026-09-15T09:00', end: '' });
  assert.equal(res.status, 400);
  const s = getSession(db, id);
  assert.equal(s.segments[0].start_utc, 1);
  assert.equal(s.segments[0].end_utc, 2);
});

test('tasks page escapes q param to prevent xss', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.get('/tasks?q=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /<script>/);
  assert.match(res.text, /&lt;script&gt;/);
});

test('POST /tasks with empty name returns 400', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/tasks').type('form').send({ name: '' });
  assert.equal(res.status, 400);
});

test('POST /tags with empty name returns 400', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/tags').type('form').send({ name: '' });
  assert.equal(res.status, 400);
});
