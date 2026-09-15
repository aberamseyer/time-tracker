export function createClient(db, { name, address = '', defaultRateCents = null, currency = 'USD' }) {
  return db.prepare(
    'INSERT INTO client (name, address, default_rate_cents, currency) VALUES (?, ?, ?, ?)'
  ).run(name, address, defaultRateCents, currency).lastInsertRowid;
}

export function createTask(db, { name, color = '#3b82f6', hourlyRateCents = null, clientId = null }) {
  return db.prepare(
    'INSERT INTO task (name, color, hourly_rate_cents, client_id) VALUES (?, ?, ?, ?)'
  ).run(name, color, hourlyRateCents, clientId).lastInsertRowid;
}

export function createTag(db, { name, color = '#6b7280' }) {
  return db.prepare('INSERT INTO tag (name, color) VALUES (?, ?)').run(name, color).lastInsertRowid;
}

export function listTasks(db) {
  return db.prepare('SELECT * FROM task WHERE archived = 0 ORDER BY name').all();
}
export function listTags(db) {
  return db.prepare('SELECT * FROM tag WHERE archived = 0 ORDER BY name').all();
}
export function listClients(db) {
  return db.prepare('SELECT * FROM client WHERE archived = 0 ORDER BY name').all();
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
