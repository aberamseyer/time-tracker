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
