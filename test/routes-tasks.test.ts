import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { listAllTasks, getTask, createTask, createTag, defaultTask, taskTagIds,
  listClients, getClient, createClient } from '../src/catalog.js';
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
  const t = listAllTasks(db).find(x => x.name === 'New task')!;
  assert.ok(t);

  await agent.post(`/tasks/${t.id}`).type('form')
    .send({ name: 'Client A', details: 'retainer', color: '#123456', rate: '75', isDefault: '1' });
  const edited = getTask(db, t.id)!;
  assert.equal(edited.name, 'Client A');
  assert.equal(edited.details, 'retainer');
  assert.equal(edited.hourly_rate_cents, 7500);
  assert.equal(edited.is_default, 1);
  assert.equal(defaultTask(db)!.id, t.id);

  await agent.post(`/tasks/${t.id}/hide`);
  assert.equal(getTask(db, t.id)!.archived, 1);
  await agent.post(`/tasks/${t.id}/hide`);
  assert.equal(getTask(db, t.id)!.archived, 0);

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
  assert.equal(defaultTask(db)!.id, b);
  assert.equal(getTask(db, a)!.is_default, 0);
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

test('create client, add task to it, then reassign to No client', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);

  await agent.post('/clients');                       // creates "New client"
  const c = listClients(db).find(x => x.name === 'New client')!;
  assert.ok(c);

  await agent.post(`/clients/${c.id}`).type('form')
    .send({ name: 'Acme', rate: '120', currency: 'EUR', address: '1 Main' });
  const saved = getClient(db, c.id)!;
  assert.equal(saved.name, 'Acme');
  assert.equal(saved.default_rate_cents, 12000);
  assert.equal(saved.currency, 'EUR');

  const res = await agent.post('/tasks').type('form').send({ clientId: String(c.id) });
  assert.match(res.text, /id="task-list"/);
  const t = listAllTasks(db).find(x => x.name === 'New task')!;
  assert.equal(t.client_id, c.id);

  await agent.post(`/tasks/${t.id}`).type('form').send({ name: 'Job', clientId: '' });
  assert.equal(getTask(db, t.id)!.client_id, null);
});

test('deleting a client via route keeps its tasks under No client', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const c = createClient(db, { name: 'Beta' });
  const t = createTask(db, { name: 'Job', clientId: c });
  const res = await agent.post(`/clients/${c}/delete`);
  assert.equal(res.status, 200);
  assert.equal(getClient(db, c), undefined);
  assert.equal(getTask(db, t)!.client_id, null);
});

test('tasks page groups by client, No client last', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const c = createClient(db, { name: 'Acme' });
  createTask(db, { name: 'Grouped', clientId: c });
  createTask(db, { name: 'Loose' });
  const res = await agent.get('/tasks');
  assert.ok(res.text.indexOf('Acme') < res.text.indexOf('No client'));
  assert.match(res.text, /Grouped/);
});

test('starting the timer applies default task and its tags', () => {
  const { db } = makeApp();
  const t = createTask(db, { name: 'Def' });
  const tag = createTag(db, { name: 'auto' });
  db.prepare('UPDATE task SET is_default = 1 WHERE id = ?').run(t);
  db.prepare('INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)').run(t, tag);
  startTimer(db, Date.now());
  const active = getActiveSession(db)!;
  const s = getSession(db, active.id)!;
  assert.equal(s.task_id, t);
  assert.deepEqual(s.tags.map(x => x.id), [tag]);
});
