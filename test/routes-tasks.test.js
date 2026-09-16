import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { listAllTasks, getTask, createTask, createTag, defaultTask, taskTagIds } from '../src/catalog.js';
import { startTimer, getActiveSession } from '../src/timer.js';
import { getSession } from '../src/sessions.js';

test('task manager page renders', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.get('/tasks');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('id="task-list"'));
});

test('create, edit (default + rate), hide, delete a task', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  await agent.post('/tasks'); // creates "New task"
  const t = listAllTasks(db).find(x => x.name === 'New task');
  assert.ok(t);

  await agent.post(`/tasks/${t.id}`).type('form')
    .send({ name: 'Client A', details: 'retainer', color: '#123456', rate: '75', isDefault: '1' });
  const edited = getTask(db, t.id);
  assert.equal(edited.name, 'Client A');
  assert.equal(edited.details, 'retainer');
  assert.equal(edited.hourly_rate_cents, 7500);
  assert.equal(edited.is_default, 1);
  assert.equal(defaultTask(db).id, t.id);

  await agent.post(`/tasks/${t.id}/hide`);
  assert.equal(getTask(db, t.id).archived, 1);
  await agent.post(`/tasks/${t.id}/hide`);
  assert.equal(getTask(db, t.id).archived, 0);

  await agent.post(`/tasks/${t.id}/delete`);
  assert.equal(getTask(db, t.id), undefined);
});

test('only one default task at a time', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const a = createTask(db, { name: 'A' }), b = createTask(db, { name: 'B' });
  await agent.post(`/tasks/${a}`).type('form').send({ name: 'A', isDefault: '1' });
  await agent.post(`/tasks/${b}`).type('form').send({ name: 'B', isDefault: '1' });
  assert.equal(defaultTask(db).id, b);
  assert.equal(getTask(db, a).is_default, 0);
});

test('default tags add and remove', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const t = createTask(db, { name: 'T' });
  const tag = createTag(db, { name: 'billable' });
  await agent.post(`/tasks/${t}/tags`).type('form').send({ tagId: String(tag) });
  assert.deepEqual(taskTagIds(db, t), [tag]);
  await agent.post(`/tasks/${t}/tags/${tag}/delete`);
  assert.deepEqual(taskTagIds(db, t), []);
});

test('starting the timer applies default task and its tags', () => {
  const { db } = makeApp();
  const t = createTask(db, { name: 'Def' });
  const tag = createTag(db, { name: 'auto' });
  db.prepare('UPDATE task SET is_default = 1 WHERE id = ?').run(t);
  db.prepare('INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)').run(t, tag);
  startTimer(db, Date.now());
  const active = getActiveSession(db);
  const s = getSession(db, active.id);
  assert.equal(s.task_id, t);
  assert.deepEqual(s.tags.map(x => x.id), [tag]);
});
