import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createClient, createTask, createTag, getTag, listTasks, listTags,
  archiveTask, effectiveRateCents } from '../src/catalog.js';
import { TASK_COLORS, TAG_COLORS } from '../src/colors.js';

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
  const colors = [];
  for (let i = 0; i < TASK_COLORS.length; i++) {
    const id = createTask(db, { name: 'T' + i });
    colors.push(listTasks(db).find(t => t.id === id).color);
  }
  assert.deepEqual(colors, TASK_COLORS);          // cycles the palette in order
});

test('new tags auto-assign from the tag palette', () => {
  const db = openDb(':memory:');
  const id = createTag(db, { name: 'first' });
  assert.equal(getTag(db, id).color, TAG_COLORS[0]);
});

test('explicit color overrides palette', () => {
  const db = openDb(':memory:');
  const id = createTag(db, { name: 'x', color: '#123456' });
  assert.equal(getTag(db, id).color, '#123456');
});
