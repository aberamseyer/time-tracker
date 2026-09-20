import type Database from 'better-sqlite3';
import { suggestColor } from './colors.js';
import type { TaskRow, TagRow, ClientRow, ClientGroup } from './types.js';

export function createClient(
  db: Database.Database,
  { name, address = '', defaultRateCents = null, currency = 'USD' }:
    { name: string; address?: string; defaultRateCents?: number | null; currency?: string },
  userId: number
): number {
  return db.prepare(
    'INSERT INTO client (name, address, default_rate_cents, currency, user_id) VALUES (?, ?, ?, ?, ?)'
  ).run(name, address, defaultRateCents, currency, userId).lastInsertRowid as number;
}

export function createTask(
  db: Database.Database,
  { name, details = '', color, hourlyRateCents = null, clientId = null }:
    { name: string; details?: string; color?: string; hourlyRateCents?: number | null; clientId?: number | null },
  userId: number,
): number {
  const c = color ?? suggestColor(db, 'task');
  return db.prepare(
    'INSERT INTO task (name, details, color, hourly_rate_cents, client_id, user_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, details, c, hourlyRateCents, clientId, userId).lastInsertRowid as number;
}

export function getTask(db: Database.Database, id: number, userId: number): (TaskRow & { tags: TagRow[] }) | undefined {
  const where = userId ? 'AND user_id = ?' : '';
  const row = db.prepare(`SELECT * FROM task WHERE id = ? ${where}`).get(userId ? [id, userId] : [id]) as TaskRow | undefined;
  if (!row) return undefined;
  return { ...row, tags: taskTags(db, id, userId) };
}

// Tags auto-assigned to new work units of this task.
export function taskTags(db: Database.Database, taskId: number, userId: number): TagRow[] {
  const where = userId ? 'WHERE tt.task_id = ? AND tag.user_id = ?' : 'WHERE tt.task_id = ?';
  return db.prepare(
    `SELECT tag.* FROM tag JOIN task_tag tt ON tt.tag_id = tag.id ${where} ORDER BY tag.name`
  ).all(userId ? [taskId, userId] : [taskId]) as TagRow[];
}
export function taskTagIds(db: Database.Database, taskId: number, userId: number): number[] {
  const where = userId ? 'WHERE tt.task_id = ? AND tag.user_id = ?' : 'WHERE tt.task_id = ?';
  return (db.prepare(`SELECT tt.tag_id FROM task_tag tt JOIN tag tag ON tag.id = tt.tag_id ${where}`).all(userId ? [taskId, userId] : [taskId]) as { tag_id: number }[])
    .map(r => r.tag_id);
}
export function addTaskTag(db: Database.Database, taskId: number, tagId: number, userId: number): void {
  if (userId) {
    const t = db.prepare('SELECT id FROM task WHERE id = ? AND user_id = ?').get(taskId, userId);
    const g = db.prepare('SELECT id FROM tag WHERE id = ? AND user_id = ?').get(tagId, userId);
    if (!t || !g) return; // prevent cross-user linking
  }
  db.prepare('INSERT OR IGNORE INTO task_tag (task_id, tag_id) VALUES (?, ?)').run(taskId, tagId);
}
export function removeTaskTag(db: Database.Database, taskId: number, tagId: number, userId: number): void {
  if (userId) {
    db.prepare('DELETE FROM task_tag WHERE task_id = ? AND tag_id = ? AND EXISTS (SELECT 1 FROM task WHERE id = ? AND user_id = ?) AND EXISTS (SELECT 1 FROM tag WHERE id = ? AND user_id = ?)').run(taskId, tagId, taskId, userId, tagId, userId);
  } else {
    db.prepare('DELETE FROM task_tag WHERE task_id = ? AND tag_id = ?').run(taskId, tagId);
  }
}

export function defaultTask(db: Database.Database, userId: number): TaskRow | undefined {
  const where = userId ? 'AND user_id = ?' : '';
  return db.prepare(`SELECT * FROM task WHERE is_default = 1 AND archived = 0 ${where}`).get(userId ? [userId] : []) as TaskRow | undefined;
}
export function setTaskHidden(db: Database.Database, id: number, hidden: boolean, userId: number): void {
  db.prepare('UPDATE task SET archived = ? WHERE id = ? AND user_id = ?').run(hidden ? 1 : 0, id, userId);
}
export function deleteTask(db: Database.Database, id: number, userId: number): void {
  db.prepare('DELETE FROM task WHERE id = ? AND user_id = ?').run(id, userId);
}

export function createTag(db: Database.Database, { name, color }: { name: string; color?: string }, userId: number): number {
  const c = color ?? suggestColor(db, 'tag');
  return db.prepare('INSERT INTO tag (name, color, user_id) VALUES (?, ?, ?)').run(name, c, userId).lastInsertRowid as number;
}

export function getTag(db: Database.Database, id: number, userId: number): TagRow | undefined {
  const w = userId ? 'AND user_id = ?' : '';
  return db.prepare(`SELECT * FROM tag WHERE id = ? ${w}`).get(userId ? [id, userId] : [id]) as TagRow | undefined;
}

export function listTasks(db: Database.Database, userId: number): TaskRow[] {
  const where = userId ? 'WHERE user_id = ? AND archived = 0' : 'WHERE archived = 0';
  return db.prepare(`SELECT * FROM task ${where} ORDER BY name`).all(userId ? [userId] : []) as TaskRow[];
}
export function listAllTasks(db: Database.Database, userId: number): TaskRow[] {
  const where = userId ? 'WHERE user_id = ?' : '';
  return db.prepare(`SELECT * FROM task ${where} ORDER BY is_default DESC, name`).all(userId ? [userId] : []) as TaskRow[];
}
export function listTags(db: Database.Database, userId: number): TagRow[] {
  const where = userId ? 'WHERE user_id = ? AND archived = 0' : 'WHERE archived = 0';
  return db.prepare(`SELECT * FROM tag ${where} ORDER BY name`).all(userId ? [userId] : []) as TagRow[];
}
export function listClients(db: Database.Database, userId: number): ClientRow[] {
  const where = userId ? 'WHERE user_id = ? AND archived = 0' : 'WHERE archived = 0';
  return db.prepare(`SELECT * FROM client ${where} ORDER BY name`).all(userId ? [userId] : []) as ClientRow[];
}
export function getClient(db: Database.Database, id: number, userId: number): ClientRow | undefined {
  const where = userId ? 'AND user_id = ?' : '';
  return db.prepare(`SELECT * FROM client WHERE id = ? ${where}`).get(userId ? [id, userId] : [id]) as ClientRow | undefined;
}
export function updateClient(
  db: Database.Database,
  id: number,
  { name, defaultRateCents = null, currency = 'USD', address = '' }:
    { name: string; defaultRateCents?: number | null; currency?: string; address?: string },
  userId: number
): void {
  db.prepare('UPDATE client SET name = ?, default_rate_cents = ?, currency = ?, address = ? WHERE id = ? AND user_id = ?')
    .run(name, defaultRateCents, currency, address, id, userId);
}
// Hard delete; task.client_id FK is ON DELETE SET NULL, so tasks fall to No client.
export function deleteClient(db: Database.Database, id: number, userId: number): void {
  db.prepare('DELETE FROM client WHERE id = ? AND user_id = ?').run(id, userId);
}

// Group a task list by client (clients by name, No client last).
function groupByClient(db: Database.Database, tasks: TaskRow[], userId: number, { keepEmpty = true }: { keepEmpty?: boolean } = {}): ClientGroup[] {
  const clients = listClients(db, userId);
  const buckets: Map<number, TaskRow[]> = new Map(clients.map(c => [c.id, []]));
  const none: TaskRow[] = [];
  for (const t of tasks) {
    if (t.client_id != null && buckets.has(t.client_id)) buckets.get(t.client_id)!.push(t);
    else none.push(t);
  }
  const groups: ClientGroup[] = clients.map(c => ({ client: c, tasks: buckets.get(c.id)! }))
    .filter(g => keepEmpty || g.tasks.length);
  if (keepEmpty || none.length) groups.push({ client: null, tasks: none });
  return groups;
}

// All tasks (incl. archived) grouped by client — for the Tasks manager page.
export function listTasksByClient(db: Database.Database, userId: number): ClientGroup[] {
  return groupByClient(db, listAllTasks(db, userId), userId);
}

// Active tasks grouped by client, empty clients omitted — for task pickers.
export function listActiveTasksByClient(db: Database.Database, userId: number): ClientGroup[] {
  return groupByClient(db, listTasks(db, userId), userId, { keepEmpty: false });
}

export function updateTask(
  db: Database.Database,
  id: number,
  { name, details = '', color, hourlyRateCents = null, isDefault = false, clientId = null }:
    { name: string; details?: string; color: string; hourlyRateCents?: number | null; isDefault?: boolean; clientId?: number | null },
  userId: number
): void {
  const tx = db.transaction(() => {
    if (isDefault) db.prepare('UPDATE task SET is_default = 0 WHERE user_id = ?').run(userId);
    db.prepare('UPDATE task SET name = ?, details = ?, color = ?, hourly_rate_cents = ?, is_default = ?, client_id = ? WHERE id = ? AND user_id = ?')
      .run(name, details, color, hourlyRateCents, isDefault ? 1 : 0, clientId, id, userId);
  });
  tx();
}
export function updateTag(db: Database.Database, id: number, { name, color }: { name: string; color: string }, userId: number): void {
  db.prepare('UPDATE tag SET name = ?, color = ? WHERE id = ? AND user_id = ?').run(name, color, id, userId);
}

export function archiveTask(db: Database.Database, id: number, userId: number): void {
  db.prepare('UPDATE task SET archived = 1 WHERE id = ? AND user_id = ?').run(id, userId);
}
export function archiveTag(db: Database.Database, id: number, userId: number): void {
  db.prepare('UPDATE tag SET archived = 1 WHERE id = ? AND user_id = ?').run(id, userId);
}

export function effectiveRateCents(db: Database.Database, taskId: number | null, userId: number): number {
  if (!taskId) return 0;
  const where = userId ? 'AND user_id = ?' : '';
  const task = db.prepare(`SELECT hourly_rate_cents, client_id FROM task WHERE id = ? ${where}`).get(userId ? [taskId, userId] : [taskId]) as
    { hourly_rate_cents: number | null; client_id: number | null } | undefined;
  if (!task) return 0;
  if (task.hourly_rate_cents != null) return task.hourly_rate_cents;
  if (task.client_id) {
    const c = db.prepare(`SELECT default_rate_cents FROM client WHERE id = ? ${where}`).get(userId ? [task.client_id, userId] : [task.client_id]) as
      { default_rate_cents: number | null } | undefined;
    if (c && c.default_rate_cents != null) return c.default_rate_cents;
  }
  return 0;
}
