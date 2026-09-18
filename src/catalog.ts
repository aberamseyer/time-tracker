import type Database from 'better-sqlite3';
import { suggestColor } from './colors.js';
import type { TaskRow, TagRow, ClientRow, ClientGroup } from './types.js';

export function createClient(
  db: Database.Database,
  { name, address = '', defaultRateCents = null, currency = 'USD' }:
    { name: string; address?: string; defaultRateCents?: number | null; currency?: string }
): number {
  return db.prepare(
    'INSERT INTO client (name, address, default_rate_cents, currency) VALUES (?, ?, ?, ?)'
  ).run(name, address, defaultRateCents, currency).lastInsertRowid as number;
}

export function createTask(
  db: Database.Database,
  { name, details = '', color, hourlyRateCents = null, clientId = null }:
    { name: string; details?: string; color?: string; hourlyRateCents?: number | null; clientId?: number | null }
): number {
  const c = color ?? suggestColor(db, 'task');
  return db.prepare(
    'INSERT INTO task (name, details, color, hourly_rate_cents, client_id) VALUES (?, ?, ?, ?, ?)'
  ).run(name, details, c, hourlyRateCents, clientId).lastInsertRowid as number;
}

export function getTask(db: Database.Database, id: number): (TaskRow & { tags: TagRow[] }) | undefined {
  const row = db.prepare('SELECT * FROM task WHERE id = ?').get(id) as TaskRow | undefined;
  if (!row) return undefined;
  return { ...row, tags: taskTags(db, id) };
}

// Tags auto-assigned to new work units of this task.
export function taskTags(db: Database.Database, taskId: number): TagRow[] {
  return db.prepare(
    `SELECT tag.* FROM tag JOIN task_tag tt ON tt.tag_id = tag.id
     WHERE tt.task_id = ? ORDER BY tag.name`
  ).all(taskId) as TagRow[];
}
export function taskTagIds(db: Database.Database, taskId: number): number[] {
  return (db.prepare('SELECT tag_id FROM task_tag WHERE task_id = ?').all(taskId) as { tag_id: number }[])
    .map(r => r.tag_id);
}
export function addTaskTag(db: Database.Database, taskId: number, tagId: number): void {
  db.prepare('INSERT OR IGNORE INTO task_tag (task_id, tag_id) VALUES (?, ?)').run(taskId, tagId);
}
export function removeTaskTag(db: Database.Database, taskId: number, tagId: number): void {
  db.prepare('DELETE FROM task_tag WHERE task_id = ? AND tag_id = ?').run(taskId, tagId);
}

export function defaultTask(db: Database.Database): TaskRow | undefined {
  return db.prepare('SELECT * FROM task WHERE is_default = 1 AND archived = 0').get() as TaskRow | undefined;
}
export function setTaskHidden(db: Database.Database, id: number, hidden: boolean): void {
  db.prepare('UPDATE task SET archived = ? WHERE id = ?').run(hidden ? 1 : 0, id);
}
export function deleteTask(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM task WHERE id = ?').run(id);
}

export function createTag(db: Database.Database, { name, color }: { name: string; color?: string }): number {
  const c = color ?? suggestColor(db, 'tag');
  return db.prepare('INSERT INTO tag (name, color) VALUES (?, ?)').run(name, c).lastInsertRowid as number;
}

export function getTag(db: Database.Database, id: number): TagRow | undefined {
  return db.prepare('SELECT * FROM tag WHERE id = ?').get(id) as TagRow | undefined;
}

export function listTasks(db: Database.Database): TaskRow[] {
  return db.prepare('SELECT * FROM task WHERE archived = 0 ORDER BY name').all() as TaskRow[];
}
export function listAllTasks(db: Database.Database): TaskRow[] {
  return db.prepare('SELECT * FROM task ORDER BY is_default DESC, name').all() as TaskRow[];
}
export function listTags(db: Database.Database): TagRow[] {
  return db.prepare('SELECT * FROM tag WHERE archived = 0 ORDER BY name').all() as TagRow[];
}
export function listClients(db: Database.Database): ClientRow[] {
  return db.prepare('SELECT * FROM client WHERE archived = 0 ORDER BY name').all() as ClientRow[];
}
export function getClient(db: Database.Database, id: number): ClientRow | undefined {
  return db.prepare('SELECT * FROM client WHERE id = ?').get(id) as ClientRow | undefined;
}
export function updateClient(
  db: Database.Database,
  id: number,
  { name, defaultRateCents = null, currency = 'USD', address = '' }:
    { name: string; defaultRateCents?: number | null; currency?: string; address?: string }
): void {
  db.prepare('UPDATE client SET name = ?, default_rate_cents = ?, currency = ?, address = ? WHERE id = ?')
    .run(name, defaultRateCents, currency, address, id);
}
// Hard delete; task.client_id FK is ON DELETE SET NULL, so tasks fall to No client.
export function deleteClient(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM client WHERE id = ?').run(id);
}

// Group a task list by client (clients by name, No client last).
function groupByClient(db: Database.Database, tasks: TaskRow[], { keepEmpty = true }: { keepEmpty?: boolean } = {}): ClientGroup[] {
  const clients = listClients(db);
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
export function listTasksByClient(db: Database.Database): ClientGroup[] {
  return groupByClient(db, listAllTasks(db));
}

// Active tasks grouped by client, empty clients omitted — for task pickers.
export function listActiveTasksByClient(db: Database.Database): ClientGroup[] {
  return groupByClient(db, listTasks(db), { keepEmpty: false });
}

export function updateTask(
  db: Database.Database,
  id: number,
  { name, details = '', color, hourlyRateCents = null, isDefault = false, clientId = null }:
    { name: string; details?: string; color: string; hourlyRateCents?: number | null; isDefault?: boolean; clientId?: number | null }
): void {
  const tx = db.transaction(() => {
    if (isDefault) db.prepare('UPDATE task SET is_default = 0').run();
    db.prepare('UPDATE task SET name = ?, details = ?, color = ?, hourly_rate_cents = ?, is_default = ?, client_id = ? WHERE id = ?')
      .run(name, details, color, hourlyRateCents, isDefault ? 1 : 0, clientId, id);
  });
  tx();
}
export function updateTag(db: Database.Database, id: number, { name, color }: { name: string; color: string }): void {
  db.prepare('UPDATE tag SET name = ?, color = ? WHERE id = ?').run(name, color, id);
}

export function archiveTask(db: Database.Database, id: number): void {
  db.prepare('UPDATE task SET archived = 1 WHERE id = ?').run(id);
}
export function archiveTag(db: Database.Database, id: number): void {
  db.prepare('UPDATE tag SET archived = 1 WHERE id = ?').run(id);
}

export function effectiveRateCents(db: Database.Database, taskId: number | null): number {
  if (!taskId) return 0;
  const task = db.prepare('SELECT hourly_rate_cents, client_id FROM task WHERE id = ?').get(taskId) as
    { hourly_rate_cents: number | null; client_id: number | null } | undefined;
  if (!task) return 0;
  if (task.hourly_rate_cents != null) return task.hourly_rate_cents;
  if (task.client_id) {
    const c = db.prepare('SELECT default_rate_cents FROM client WHERE id = ?').get(task.client_id) as
      { default_rate_cents: number | null } | undefined;
    if (c && c.default_rate_cents != null) return c.default_rate_cents;
  }
  return 0;
}
