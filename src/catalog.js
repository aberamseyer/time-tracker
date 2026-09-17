import { suggestColor } from './colors.js';

export function createClient(db, { name, address = '', defaultRateCents = null, currency = 'USD' }) {
  return db.prepare(
    'INSERT INTO client (name, address, default_rate_cents, currency) VALUES (?, ?, ?, ?)'
  ).run(name, address, defaultRateCents, currency).lastInsertRowid;
}

export function createTask(db, { name, details = '', color, hourlyRateCents = null, clientId = null }) {
  const c = color ?? suggestColor(db, 'task');
  return db.prepare(
    'INSERT INTO task (name, details, color, hourly_rate_cents, client_id) VALUES (?, ?, ?, ?, ?)'
  ).run(name, details, c, hourlyRateCents, clientId).lastInsertRowid;
}

export function getTask(db, id) {
  const row = db.prepare('SELECT * FROM task WHERE id = ?').get(id);
  if (!row) return undefined;
  return { ...row, tags: taskTags(db, id) };
}

// Tags auto-assigned to new work units of this task.
export function taskTags(db, taskId) {
  return db.prepare(
    `SELECT tag.* FROM tag JOIN task_tag tt ON tt.tag_id = tag.id
     WHERE tt.task_id = ? ORDER BY tag.name`
  ).all(taskId);
}
export function taskTagIds(db, taskId) {
  return db.prepare('SELECT tag_id FROM task_tag WHERE task_id = ?').all(taskId).map(r => r.tag_id);
}
export function addTaskTag(db, taskId, tagId) {
  db.prepare('INSERT OR IGNORE INTO task_tag (task_id, tag_id) VALUES (?, ?)').run(taskId, tagId);
}
export function removeTaskTag(db, taskId, tagId) {
  db.prepare('DELETE FROM task_tag WHERE task_id = ? AND tag_id = ?').run(taskId, tagId);
}

export function defaultTask(db) {
  return db.prepare('SELECT * FROM task WHERE is_default = 1 AND archived = 0').get();
}
export function setTaskHidden(db, id, hidden) {
  db.prepare('UPDATE task SET archived = ? WHERE id = ?').run(hidden ? 1 : 0, id);
}
export function deleteTask(db, id) {
  db.prepare('DELETE FROM task WHERE id = ?').run(id);
}

export function createTag(db, { name, color }) {
  const c = color ?? suggestColor(db, 'tag');
  return db.prepare('INSERT INTO tag (name, color) VALUES (?, ?)').run(name, c).lastInsertRowid;
}

export function getTag(db, id) {
  return db.prepare('SELECT * FROM tag WHERE id = ?').get(id);
}

export function listTasks(db) {
  return db.prepare('SELECT * FROM task WHERE archived = 0 ORDER BY name').all();
}
export function listAllTasks(db) {
  return db.prepare('SELECT * FROM task ORDER BY is_default DESC, name').all();
}
export function listTags(db) {
  return db.prepare('SELECT * FROM tag WHERE archived = 0 ORDER BY name').all();
}
export function listClients(db) {
  return db.prepare('SELECT * FROM client WHERE archived = 0 ORDER BY name').all();
}
export function getClient(db, id) {
  return db.prepare('SELECT * FROM client WHERE id = ?').get(id);
}
export function updateClient(db, id, { name, defaultRateCents = null, currency = 'USD', address = '' }) {
  db.prepare('UPDATE client SET name = ?, default_rate_cents = ?, currency = ?, address = ? WHERE id = ?')
    .run(name, defaultRateCents, currency, address, id);
}
// Hard delete; task.client_id FK is ON DELETE SET NULL, so tasks fall to No client.
export function deleteClient(db, id) {
  db.prepare('DELETE FROM client WHERE id = ?').run(id);
}

// Group a task list by client (clients by name, No client last).
function groupByClient(db, tasks, { keepEmpty = true } = {}) {
  const clients = listClients(db);
  const buckets = new Map(clients.map(c => [c.id, []]));
  const none = [];
  for (const t of tasks) {
    if (t.client_id != null && buckets.has(t.client_id)) buckets.get(t.client_id).push(t);
    else none.push(t);
  }
  const groups = clients.map(c => ({ client: c, tasks: buckets.get(c.id) }))
    .filter(g => keepEmpty || g.tasks.length);
  if (keepEmpty || none.length) groups.push({ client: null, tasks: none });
  return groups;
}

// All tasks (incl. archived) grouped by client — for the Tasks manager page.
export function listTasksByClient(db) {
  return groupByClient(db, listAllTasks(db));
}

// Active tasks grouped by client, empty clients omitted — for task pickers.
export function listActiveTasksByClient(db) {
  return groupByClient(db, listTasks(db), { keepEmpty: false });
}

export function updateTask(db, id, { name, details = '', color, hourlyRateCents = null, isDefault = false, clientId = null }) {
  const tx = db.transaction(() => {
    if (isDefault) db.prepare('UPDATE task SET is_default = 0').run();
    db.prepare('UPDATE task SET name = ?, details = ?, color = ?, hourly_rate_cents = ?, is_default = ?, client_id = ? WHERE id = ?')
      .run(name, details, color, hourlyRateCents, isDefault ? 1 : 0, clientId, id);
  });
  tx();
}
export function updateTag(db, id, { name, color }) {
  db.prepare('UPDATE tag SET name = ?, color = ? WHERE id = ?').run(name, color, id);
}

export function archiveTask(db, id) {
  db.prepare('UPDATE task SET archived = 1 WHERE id = ?').run(id);
}
export function archiveTag(db, id) {
  db.prepare('UPDATE tag SET archived = 1 WHERE id = ?').run(id);
}

export function effectiveRateCents(db, taskId) {
  if (!taskId) return 0;
  const task = db.prepare('SELECT hourly_rate_cents, client_id FROM task WHERE id = ?').get(taskId);
  if (!task) return 0;
  if (task.hourly_rate_cents != null) return task.hourly_rate_cents;
  if (task.client_id) {
    const c = db.prepare('SELECT default_rate_cents FROM client WHERE id = ?').get(task.client_id);
    if (c && c.default_rate_cents != null) return c.default_rate_cents;
  }
  return 0;
}
