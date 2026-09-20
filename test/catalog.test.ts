import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createClient, createTask, createTag, getTag, listTasks, listTags,
  archiveTask, effectiveRateCents, getClient, updateClient, deleteClient,
  listTasksByClient, updateTask } from '../src/catalog.js';
import { TASK_COLORS, TAG_COLORS, suggestColor } from '../src/colors.js';

test('create and list tasks (archived hidden)', () => {
  const db = openDb(':memory:');
  const a = createTask(db, { name: 'App dev' }, 1);
  createTask(db, { name: 'Zebra' }, 1);
  archiveTask(db, a, 1);
  const names = listTasks(db, 1).map(t => t.name);
  assert.deepEqual(names, ['Zebra']);
});

test('effective rate: task rate wins', () => {
  const db = openDb(':memory:');
  const c = createClient(db, {name: 'Acme', defaultRateCents: 5000}, 1);
  const t = createTask(db, { name: 'Paid', hourlyRateCents: 8000, clientId: c }, 1);
  assert.equal(effectiveRateCents(db, t, 1), 8000);
});

test('effective rate: falls back to client default then zero', () => {
  const db = openDb(':memory:');
  const c = createClient(db, {name: 'Acme', defaultRateCents: 5000}, 1);
  const t = createTask(db, { name: 'NoRate', clientId: c }, 1);
  assert.equal(effectiveRateCents(db, t, 1), 5000);
  const t2 = createTask(db, { name: 'Bare' }, 1);
  assert.equal(effectiveRateCents(db, t2, 1), 0);
  assert.equal(effectiveRateCents(db, null, 1), 0);
});

test('tags create and list', () => {
  const db = openDb(':memory:');
  createTag(db, {name: 'Bug fixes', color: '#2563eb'}, 1);
  assert.equal(listTags(db, 1).length, 1);
});

test('new tasks auto-assign distinct palette colors', () => {
  const db = openDb(':memory:');
  const colors: string[] = [];
  for (let i = 0; i < TASK_COLORS.length; i++) {
    const id = createTask(db, { name: 'T' + i }, 1);
    colors.push(listTasks(db, 1).find(t => t.id === id)!.color);
  }
  assert.deepEqual(colors, TASK_COLORS);          // cycles the palette in order
});

test('new tags auto-assign from the tag palette', () => {
  const db = openDb(':memory:');
  const id = createTag(db, {name: 'first'}, 1);
  assert.equal(getTag(db, id, 1)!.color, TAG_COLORS[0]);
});

test('explicit color overrides palette', () => {
  const db = openDb(':memory:');
  const id = createTag(db, {name: 'x', color: '#123456'}, 1);
  assert.equal(getTag(db, id, 1)!.color, '#123456');
});

test('client create, get, update', () => {
  const db = openDb(':memory:');
  const id = createClient(db, {name: 'Acme'}, 1);
  updateClient(db, id, { name: 'Acme Inc', defaultRateCents: 12000, currency: 'EUR', address: '1 St' }, 1);
  const c = getClient(db, id, 1)!;
  assert.equal(c.name, 'Acme Inc');
  assert.equal(c.default_rate_cents, 12000);
  assert.equal(c.currency, 'EUR');
  assert.equal(c.address, '1 St');
});

test('deleting a client moves its tasks to No client', () => {
  const db = openDb(':memory:');
  const c = createClient(db, {name: 'Acme'}, 1);
  const t = createTask(db, { name: 'Job', clientId: c }, 1);
  deleteClient(db, c, 1);
  assert.equal(getClient(db, c, 1), undefined);
  const groups = listTasksByClient(db, 1);
  const none = groups.find(g => g.client === null);
  assert.ok(none!.tasks.some(x => x.id === t));
});

test('listTasksByClient groups tasks, No client last', () => {
  const db = openDb(':memory:');
  const b = createClient(db, {name: 'Beta'}, 1);
  const a = createClient(db, {name: 'Alpha'}, 1);
  createTask(db, { name: 'Loose' }, 1);
  createTask(db, { name: 'A-work', clientId: a }, 1);
  const groups = listTasksByClient(db, 1);
  assert.deepEqual(groups.map(g => g.client ? g.client.name : 'No client'),
    ['Alpha', 'Beta', 'No client']);
  assert.equal(groups[0].tasks[0].name, 'A-work');
  assert.equal(groups[2].tasks[0].name, 'Loose');
});

test('updateTask reassigns a task to another client', () => {
  const db = openDb(':memory:');
  const a = createClient(db, { name: 'A' }, 1);
  const t = createTask(db, { name: 'Job', clientId: a }, 1);
  updateTask(db, t, { name: 'Job', color: '#111111', clientId: null }, 1);
  const none = listTasksByClient(db, 1).find(g => g.client === null);
  assert.ok(none!.tasks.some(x => x.id === t));
});

test('suggestColor rotates despite lowercase stored hex', () => {
  const db = openDb(':memory:');
  assert.equal(suggestColor(db, 'tag'), TAG_COLORS[0]);
  // <input type=color> submits lowercase; must still count as used.
  createTag(db, { name: 'a', color: TAG_COLORS[0].toLowerCase() }, 1);
  assert.equal(suggestColor(db, 'tag'), TAG_COLORS[1]);
});
