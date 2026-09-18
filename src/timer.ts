import type Database from 'better-sqlite3';
import { createSession, getSession, updateSession, decorateSession, setSessionTags } from './sessions.js';
import { defaultTask, taskTagIds } from './catalog.js';
import { getSettings } from './settings.js';
import type { SessionRow, DecoratedSession } from './types.js';

const DAY = 86400000;

// Civil midnight of a wall-clock-as-UTC value.
export function civilDayStart(civilMs: number): number {
  const d = new Date(civilMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function getActiveSession(db: Database.Database): SessionRow | undefined {
  return db.prepare('SELECT * FROM session WHERE end_utc IS NULL').get() as SessionRow | undefined;
}

function foldPause(active: SessionRow, now: number): number {
  // returns extra paused_ms to add if currently paused
  return active.pause_started_at == null ? 0 : now - active.pause_started_at;
}

export function stopTimer(db: Database.Database, now: number, tzMin = 0): number | null {
  const active = getActiveSession(db);
  if (!active) return null;
  const off = tzMin * 60000;
  updateSession(db, active.id, {
    startUtc: active.start_utc! - off,               // freeze real -> civil
    endUtc: now - off,
    pausedMs: active.paused_ms + foldPause(active, now),
    pauseStartedAt: null,
  });
  return active.id;
}

export function startTimer(
  db: Database.Database,
  now: number,
  { taskId, description = '', tzMin = 0 }: { taskId?: number | null; description?: string; tzMin?: number } = {},
): number {
  const tx = db.transaction(() => {
    stopTimer(db, now, tzMin);
    const tid = taskId ?? (defaultTask(db)?.id ?? null);
    const id = createSession(db, { taskId: tid, description, startUtc: now, endUtc: null, createdAt: now });
    if (tid) setSessionTags(db, id, taskTagIds(db, tid));
    return id;
  });
  return tx();
}

// Start a new running session copying a past one's description, details, task, tags.
export function startTimerFrom(db: Database.Database, now: number, sourceId: number, tzMin = 0): number | null {
  const src = getSession(db, sourceId);
  if (!src) return null;
  const tx = db.transaction(() => {
    stopTimer(db, now, tzMin);
    const id = createSession(db, {
      description: src.description, details: src.details, taskId: src.task_id,
      startUtc: now, endUtc: null, createdAt: now,
    });
    setSessionTags(db, id, src.tags.map(t => t.id));
    return id;
  });
  return tx();
}

export function pauseTimer(db: Database.Database, now: number): number | null {
  const active = getActiveSession(db);
  if (!active || active.pause_started_at != null) return active ? active.id : null;
  updateSession(db, active.id, { pauseStartedAt: now });
  return active.id;
}

export function resumeTimer(db: Database.Database, now: number): number | null {
  const active = getActiveSession(db);
  if (!active || active.pause_started_at == null) return active ? active.id : null;
  updateSession(db, active.id, {
    pausedMs: active.paused_ms + (now - active.pause_started_at),
    pauseStartedAt: null,
  });
  return active.id;
}

// Keep the running session inside its local calendar day.
export function splitExpiredDays(db: Database.Database, now: number, tzMin: number): boolean {
  const off = tzMin * 60000;
  const nowDay = civilDayStart(now - off);
  let changed = false;
  let active = getActiveSession(db);
  while (active) {
    const startCivil = active.start_utc! - off;
    const dayStart = civilDayStart(startCivil);
    if (nowDay <= dayStart) break;                    // still the same local day
    const boundaryReal = (dayStart + DAY) + off;      // real instant of next local midnight
    const paused = active.paused_ms +
      (active.pause_started_at != null ? Math.max(0, boundaryReal - active.pause_started_at) : 0);
    updateSession(db, active.id, {
      startUtc: startCivil, endUtc: dayStart + DAY - 1, pausedMs: paused, pauseStartedAt: null,
    });
    const src = getSession(db, active.id)!;
    const id = createSession(db, {
      description: src.description, details: src.details, taskId: src.task_id,
      startUtc: boundaryReal, endUtc: null, createdAt: boundaryReal,
    });
    setSessionTags(db, id, src.tags.map(t => t.id));
    changed = true;
    active = getActiveSession(db);
  }
  return changed;
}

export function timerState(
  db: Database.Database,
  now: number,
): { state: 'none' | 'paused' | 'running'; session: DecoratedSession | null; elapsedMs: number } {
  const active = getActiveSession(db);
  if (!active) return { state: 'none', session: null, elapsedMs: 0 };
  const session = decorateSession(db, getSession(db, active.id)!, now, getSettings(db).rounding_minutes);
  return { state: session.paused ? 'paused' : 'running', session, elapsedMs: session.durationMs };
}
