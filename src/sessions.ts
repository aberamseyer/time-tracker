import type Database from 'better-sqlite3';
import { sessionDurationMs, roundUpDurationMs, earningsCents } from './calc.js';
import { effectiveRateCents } from './catalog.js';
import type {
  SessionRow, HydratedSession, DecoratedSession, SessionFilter, TagRow, TaskRow,
} from './types.js';

export function createSession(db: Database.Database, {
  description = '', details = '', taskId = null,
  startUtc, endUtc = null, pausedMs = 0, pauseStartedAt = null,
  createdAt = Date.now(),
}: {
  description?: string; details?: string; taskId?: number | null;
  startUtc?: number | null; endUtc?: number | null; pausedMs?: number;
  pauseStartedAt?: number | null; createdAt?: number;
} = {}): number {
  return db.prepare(
    `INSERT INTO session (description, details, task_id, created_at, start_utc, end_utc, paused_ms, pause_started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(description, details, taskId, createdAt, startUtc, endUtc, pausedMs, pauseStartedAt).lastInsertRowid as number;
}

const COLS: Record<string, string> = {
  description: 'description', details: 'details', taskId: 'task_id',
  startUtc: 'start_utc', endUtc: 'end_utc', pausedMs: 'paused_ms', pauseStartedAt: 'pause_started_at',
};

export function updateSession(
  db: Database.Database,
  id: number,
  fields: Partial<Record<'description' | 'details' | 'taskId' | 'startUtc' | 'endUtc' | 'pausedMs' | 'pauseStartedAt', unknown>>,
): void {
  const sets: string[] = [], vals: unknown[] = [];
  for (const [key, col] of Object.entries(COLS)) {
    if (key in fields) { sets.push(`${col} = ?`); vals.push((fields as Record<string, unknown>)[key]); }
  }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE session SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function setSessionTags(db: Database.Database, id: number, tagIds: number[]): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM session_tag WHERE session_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO session_tag (session_id, tag_id) VALUES (?, ?)');
    for (const t of tagIds) ins.run(id, t);
  });
  tx();
}

export function deleteSession(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM session WHERE id = ?').run(id);
}

function hydrate(db: Database.Database, row: SessionRow): HydratedSession {
  const tags = db.prepare(
    `SELECT tag.* FROM tag JOIN session_tag st ON st.tag_id = tag.id
     WHERE st.session_id = ? ORDER BY tag.name`
  ).all(row.id) as TagRow[];
  const task = row.task_id
    ? (db.prepare('SELECT * FROM task WHERE id = ?').get(row.task_id) as TaskRow | undefined) ?? null
    : null;
  return { ...row, tags, task };
}

export function getSession(db: Database.Database, id: number): HydratedSession | undefined {
  const row = db.prepare('SELECT * FROM session WHERE id = ?').get(id) as SessionRow | undefined;
  return row ? hydrate(db, row) : undefined;
}

export function listSessions(db: Database.Database, filter: SessionFilter = {}): HydratedSession[] {
  const where: string[] = [], vals: unknown[] = [];
  if (filter.completedOnly) where.push('s.end_utc IS NOT NULL');
  if (filter.q) { where.push('s.description LIKE ?'); vals.push('%' + filter.q + '%'); }
  if (filter.taskId) { where.push('s.task_id = ?'); vals.push(filter.taskId); }
  if (filter.unlabelled) where.push("s.description = ''");
  if (filter.uncategorized) where.push('s.task_id IS NULL');
  if (filter.clientId) {
    where.push('s.task_id IN (SELECT id FROM task WHERE client_id = ?)');
    vals.push(filter.clientId);
  }
  if (filter.tagId) {
    where.push('EXISTS (SELECT 1 FROM session_tag st WHERE st.session_id = s.id AND st.tag_id = ?)');
    vals.push(filter.tagId);
  }
  // Multi-select filters; id 0 means "without task" / "without tag".
  if (filter.taskIds && filter.taskIds.length) {
    const ids = filter.taskIds.filter(x => x > 0);
    const parts: string[] = [];
    if (ids.length) { parts.push(`s.task_id IN (${ids.map(() => '?').join(',')})`); vals.push(...ids); }
    if (filter.taskIds.includes(0)) parts.push('s.task_id IS NULL');
    where.push(`${filter.invertTask ? 'NOT ' : ''}(${parts.join(' OR ')})`);
  }
  if (filter.tagIds && filter.tagIds.length) {
    const ids = filter.tagIds.filter(x => x > 0);
    const parts: string[] = [];
    if (ids.length) { parts.push(`EXISTS (SELECT 1 FROM session_tag st WHERE st.session_id = s.id AND st.tag_id IN (${ids.map(() => '?').join(',')}))`); vals.push(...ids); }
    if (filter.tagIds.includes(0)) parts.push('NOT EXISTS (SELECT 1 FROM session_tag st WHERE st.session_id = s.id)');
    where.push(`${filter.invertTag ? 'NOT ' : ''}(${parts.join(' OR ')})`);
  }
  if (filter.from != null) { where.push('COALESCE(s.end_utc, s.start_utc) >= ?'); vals.push(filter.from); }
  if (filter.to != null) { where.push('s.start_utc <= ?'); vals.push(filter.to); }
  const sql = `SELECT * FROM session s
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.start_utc DESC, s.id DESC`;
  return (db.prepare(sql).all(...vals) as SessionRow[]).map(row => hydrate(db, row));
}

export function decorateSession(
  db: Database.Database,
  session: HydratedSession,
  now: number,
  roundingMinutes: number,
): DecoratedSession {
  const active = session.end_utc == null;
  const paused = active && session.pause_started_at != null;
  const running = active && !paused;
  const durationMs = sessionDurationMs(session, now);
  const roundedMs = active ? durationMs : roundUpDurationMs(durationMs, roundingMinutes);
  const rate = effectiveRateCents(db, session.task_id);
  return { ...session, active, paused, running, durationMs, roundedMs, earningsCents: earningsCents(roundedMs, rate) };
}

export function distinctDescriptions(db: Database.Database, q = '', limit = 8): string[] {
  return (db.prepare(
    `SELECT description, MAX(start_utc) AS last FROM session
     WHERE description <> '' AND description LIKE ?
     GROUP BY description ORDER BY last DESC LIMIT ?`
  ).all('%' + q + '%', limit) as { description: string; last: number }[]).map(r => r.description);
}

export function latestByDescription(
  db: Database.Database,
  description: string,
): { details: string; task_id: number | null; task: TaskRow | null; tags: TagRow[] } | null {
  const row = db.prepare(
    `SELECT * FROM session WHERE description = ? ORDER BY start_utc DESC, id DESC LIMIT 1`
  ).get(description) as SessionRow | undefined;
  if (!row) return null;
  const h = hydrate(db, row);
  return { details: h.details, task_id: h.task_id, task: h.task, tags: h.tags };
}
