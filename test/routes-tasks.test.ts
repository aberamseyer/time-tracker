import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { listAllTasks, getTask, createTask, createTag, defaultTask, taskTagIds,
  listClients, getClient, createClient } from '../src/catalog.js';
import { startTimer, getActiveSession } from '../src/timer.js';
import { getSession } from '../src/sessions.js';

const UID = 1;

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
  const t = listAllTasks(db, UID).find(x => x.name === 'New task')!;
  assert.ok(t);

  await agent.post(`/tasks/${t.id}`).type('form')
    .send({ name: 'Client A', details: 'retainer', color: '#123456', rate: '75', isDefault: '1' });
  const edited = getTask(db, t.id, UID)!;
  assert.equal(edited.name, 'Client A');
  assert.equal(edited.details, 'retainer');
  assert.equal(edited.hourly_rate_cents, 7500);
  assert.equal(edited.is_default, 1);
  assert.equal(defaultTask(db, UID)!.id, t.id);

  await agent.post(`/tasks/${t.id}/hide`);
  assert.equal(getTask(db, t.id, UID)!.archived, 1);
  await agent.post(`/tasks/${t.id}/hide`);
  assert.equal(getTask(db, t.id, UID)!.archived, 0);

  await agent.post(`/tasks/${t.id}/delete`);
  assert.equal(getTask(db, t.id, UID), undefined);
});

test('only one default task at a time', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const a = createTask(db, { name: 'A', }, UID), b = createTask(db, { name: 'B', }, UID);
  await agent.post(`/tasks/${a}`).type('form').send({ name: 'A', isDefault: '1' });
  await agent.post(`/tasks/${b}`).type('form').send({ name: 'B', isDefault: '1' });
  assert.equal(defaultTask(db, UID)!.id, b);
  assert.equal(getTask(db, a, UID)!.is_default, 0);
});

test('default tags add and remove', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const t = createTask(db, { name: 'T', }, UID);
  const tag = createTag(db, { name: 'billable' }, UID);
  await agent.post(`/tasks/${t}/tags`).type('form').send({ tagId: String(tag) });
  assert.deepEqual(taskTagIds(db, t, UID), [tag]);
  await agent.post(`/tasks/${t}/tags/${tag}/delete`);
  assert.deepEqual(taskTagIds(db, t, UID), []);
});

test('create client, add task to it, then reassign to No client', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);

  await agent.post('/clients');                       // creates "New client"
  const c = listClients(db, UID).find(x => x.name === 'New client')!;
  assert.ok(c);

  await agent.post(`/clients/${c.id}`).type('form')
    .send({ name: 'Acme', rate: '120', currency: 'EUR', address: '1 Main' });
  const saved = getClient(db, c.id, UID)!;
  assert.equal(saved.name, 'Acme');
  assert.equal(saved.default_rate_cents, 12000);
  assert.equal(saved.currency, 'EUR');

  const res = await agent.post('/tasks').type('form').send({ clientId: String(c.id) });
  assert.match(res.text, /id="task-list"/);
  const t = listAllTasks(db, UID).find(x => x.name === 'New task')!;
  assert.equal(t.client_id, c.id);

  await agent.post(`/tasks/${t.id}`).type('form').send({ name: 'Job', clientId: '' });
  assert.equal(getTask(db, t.id, UID)!.client_id, null);
});

test('deleting a client via route keeps its tasks under No client', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const c = createClient(db, { name: 'Beta' }, UID);
  const t = createTask(db, { name: 'Job', clientId: c, }, UID);
  const res = await agent.post(`/clients/${c}/delete`);
  assert.equal(res.status, 200);
  assert.equal(getClient(db, c, UID), undefined);
  assert.equal(getTask(db, t, UID)!.client_id, null);
});

test('tasks page groups by client, No client last', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const c = createClient(db, { name: 'Acme' }, UID);
  createTask(db, { name: 'Grouped', clientId: c, }, UID);
  createTask(db, { name: 'Loose', }, UID);
  const res = await agent.get('/tasks');
  assert.ok(res.text.indexOf('Acme') < res.text.indexOf('No client'));
  assert.match(res.text, /Grouped/);
});

test('starting the timer applies default task and its tags', () => {
  const { db } = makeApp();
  const t = createTask(db, { name: 'Def', }, UID);
  const tag = createTag(db, { name: 'auto' }, UID);
  db.prepare('UPDATE task SET is_default = 1 WHERE id = ? AND user_id = ?').run(t, UID);
  db.prepare('INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)').run(t, tag);
  startTimer(db, Date.now(), { tzMin: 0, userId: UID });
  const active = getActiveSession(db, UID)!;
  const s = getSession(db, active.id, UID)!;
  assert.equal(s.task_id, t);
  assert.deepEqual(s.tags.map(x => x.id), [tag]);
});

test('cross-user isolation: a user cannot list, read, or delete another user\'s tasks', async () => {
  const { app, db } = makeApp();
  const abe = request.agent(app); const bob = request.agent(app);
  await login(abe, db, 'abe', 'pw');            // user A (id 1)
  await login(bob, db, 'bob', 'pw');            // user B (id 2)

  const aTaskId = createTask(db, { name: 'AbeSecret', clientId: null, }, UID);
  assert.ok(getTask(db, aTaskId, UID));

  // List: bob's task page omits abe's task; abe's shows it.
  assert.doesNotMatch((await bob.get('/tasks')).text, /AbeSecret/);
  assert.match((await abe.get('/tasks')).text, /AbeSecret/);

  // Read: scoped by user_id — only the owner resolves it.
  assert.equal(getTask(db, aTaskId, 2), undefined);

  // Delete: bob's delete is a no-op (scoped); abe's task survives.
  const del = await bob.post(`/tasks/${aTaskId}/delete`);
  assert.equal(del.status, 200);
  assert.ok(getTask(db, aTaskId, UID));

  // Bob can create a task scoped to himself, invisible to abe.
  await bob.post('/tasks').type('form').send({});
  const bobTask = listAllTasks(db, 2).find(x => x.name === 'New task');
  assert.ok(bobTask);
  assert.equal(listAllTasks(db, UID).find(x => x.id === bobTask.id), undefined);

  // Non-vacuity: unscoped (userId=0) returns both, scoped (userId=2) returns only bob's.
  assert.deepEqual(listAllTasks(db, 0).map(t => t.name), ['AbeSecret', 'New task']);
  assert.deepEqual(listAllTasks(db, 2).map(t => t.name), ['New task']);
});

