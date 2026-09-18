import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createClient, createTask, createTag, getTag, listTasks, listTags,
  archiveTask, effectiveRateCents, getClient, updateClient, deleteClient,
  listTasksByClient, updateTask } from '../src/catalog.js';
import { TASK_COLORS, TAG_COLORS, suggestColor } from '../src/colors.js';

test('create and list tasks (archived hidden)', () => {
  const db = openDb(':memory:');
  const a = createTask(db, { name: 'App dev' });
  createTask(db, { name: 'Zebra' });
  archiveTask(db, a);
  const names = listTasks(db).map(t => t.name);
  assert.deepEqual(names, ['Zebra']);
});

test('effective rate: task rate wins', () => {
  const db = openDb(':memory:');
  const c = createClient(db, { name: 'Acme', defaultRateCents: 5000 });
  const t = createTask(db, { name: 'Paid', hourlyRateCents: 8000, clientId: c });
  assert.equal(effectiveRateCents(db, t), 8000);
});

test('effective rate: falls back to client default then zero', () => {
  const db = openDb(':memory:');
  const c = createClient(db, { name: 'Acme', defaultRateCents: 5000 });
  const t = createTask(db, { name: 'NoRate', clientId: c });
  assert.equal(effectiveRateCents(db, t), 5000);
  const t2 = createTask(db, { name: 'Bare' });
  assert.equal(effectiveRateCents(db, t2), 0);
  assert.equal(effectiveRateCents(db, null), 0);
});

test('tags create and list', () => {
  const db = openDb(':memory:');
  createTag(db, { name: 'Bug fixes', color: '#2563eb' });
  assert.equal(listTags(db).length, 1);
});

test('new tasks auto-assign distinct palette colors', () => {
  const db = openDb(':memory:');
  const colors: string[] = [];
  for (let i = 0; i < TASK_COLORS.length; i++) {
    const id = createTask(db, { name: 'T' + i });
    colors.push(listTasks(db).find(t => t.id === id)!.color);
  }
  assert.deepEqual(colors, TASK_COLORS);          // cycles the palette in order
});

test('new tags auto-assign from the tag palette', () => {
  const db = openDb(':memory:');
  const id = createTag(db, { name: 'first' });
  assert.equal(getTag(db, id)!.color, TAG_COLORS[0]);
});

test('explicit color overrides palette', () => {
  const db = openDb(':memory:');
  const id = createTag(db, { name: 'x', color: '#123456' });
  assert.equal(getTag(db, id)!.color, '#123456');
});

test('client create, get, update', () => {
  const db = openDb(':memory:');
  const id = createClient(db, { name: 'Acme' });
  updateClient(db, id, { name: 'Acme Inc', defaultRateCents: 12000, currency: 'EUR', address: '1 St' });
  const c = getClient(db, id)!;
  assert.equal(c.name, 'Acme Inc');
  assert.equal(c.default_rate_cents, 12000);
  assert.equal(c.currency, 'EUR');
  assert.equal(c.address, '1 St');
});

test('deleting a client moves its tasks to No client', () => {
  const db = openDb(':memory:');
  const c = createClient(db, { name: 'Acme' });
  const t = createTask(db, { name: 'Job', clientId: c });
  deleteClient(db, c);
  assert.equal(getClient(db, c), undefined);
  const groups = listTasksByClient(db);
  const none = groups.find(g => g.client === null);
  assert.ok(none!.tasks.some(x => x.id === t));
});

test('listTasksByClient groups tasks, No client last', () => {
  const db = openDb(':memory:');
  const b = createClient(db, { name: 'Beta' });
  const a = createClient(db, { name: 'Alpha' });
  createTask(db, { name: 'Loose' });
  createTask(db, { name: 'A-work', clientId: a });
  const groups = listTasksByClient(db);
  assert.deepEqual(groups.map(g => g.client ? g.client.name : 'No client'),
    ['Alpha', 'Beta', 'No client']);
  assert.equal(groups[0].tasks[0].name, 'A-work');
  assert.equal(groups[2].tasks[0].name, 'Loose');
});

test('updateTask reassigns a task to another client', () => {
  const db = openDb(':memory:');
  const a = createClient(db, { name: 'A' });
  const t = createTask(db, { name: 'Job', clientId: a });
  updateTask(db, t, { name: 'Job', color: '#111111', clientId: null });
  const none = listTasksByClient(db).find(g => g.client === null);
  assert.ok(none!.tasks.some(x => x.id === t));
});

test('suggestColor rotates despite lowercase stored hex', () => {
  const db = openDb(':memory:');
  assert.equal(suggestColor(db, 'tag'), TAG_COLORS[0]);
  // <input type=color> submits lowercase; must still count as used.
  createTag(db, { name: 'a', color: TAG_COLORS[0].toLowerCase() });
  assert.equal(suggestColor(db, 'tag'), TAG_COLORS[1]);
});
