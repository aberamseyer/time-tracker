import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { getActiveSession, startTimerFrom } from '../src/timer.js';
import { getSession, createSession, setSessionTags } from '../src/sessions.js';
import { createTask, createTag } from '../src/catalog.js';

const UID = 1;

test('startTimerFrom copies description, details, task and tags', () => {
  const { db } = makeApp();
  const t = createTask(db, { name: 'Dev', }, UID);
  const tag = createTag(db, { name: 'urgent' }, UID);
  const src = createSession(db, { description: 'Bug fix', details: 'null ptr', taskId: t, startUtc: 1, endUtc: 2, userId: UID });
  setSessionTags(db, src, [tag], UID);
  const id = startTimerFrom(db, Date.now(), src, 0, UID)!;
  const s = getSession(db, id, UID)!;
  assert.equal(s.description, 'Bug fix');
  assert.equal(s.details, 'null ptr');
  assert.equal(s.task_id, t);
  assert.deepEqual(s.tags.map(x => x.id), [tag]);
  assert.equal(s.end_utc, null);
});

test('start-from route starts new running session', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const src = createSession(db, { description: 'Prev', startUtc: 1, endUtc: 2, userId: UID });
  const res = await agent.post(`/timer/start-from/${src}`);
  assert.equal(res.status, 200);
  const active = getActiveSession(db, UID)!;
  assert.ok(active);
  assert.equal(getSession(db, active.id, UID)!.description, 'Prev');
});