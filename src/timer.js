import { createSession, getSession, updateSession, decorateSession, setSessionTags } from './sessions.js';
import { defaultTask, taskTagIds } from './catalog.js';
import { getSettings } from './settings.js';

export function getActiveSession(db) {
  return db.prepare('SELECT * FROM session WHERE end_utc IS NULL').get();
}

function foldPause(active, now) {
  // returns extra paused_ms to add if currently paused
  return active.pause_started_at == null ? 0 : now - active.pause_started_at;
}

export function stopTimer(db, now) {
  const active = getActiveSession(db);
  if (!active) return null;
  updateSession(db, active.id, {
    endUtc: now,
    pausedMs: active.paused_ms + foldPause(active, now),
    pauseStartedAt: null,
  });
  return active.id;
}

export function startTimer(db, now, { taskId, description = '' } = {}) {
  const tx = db.transaction(() => {
    stopTimer(db, now);
    const tid = taskId ?? (defaultTask(db)?.id ?? null);
    const id = createSession(db, { taskId: tid, description, startUtc: now, endUtc: null, createdAt: now });
    if (tid) setSessionTags(db, id, taskTagIds(db, tid));
    return id;
  });
  return tx();
}

// Start a new running session copying a past one's description, details, task, tags.
export function startTimerFrom(db, now, sourceId) {
  const src = getSession(db, sourceId);
  if (!src) return null;
  const tx = db.transaction(() => {
    stopTimer(db, now);
    const id = createSession(db, {
      description: src.description, details: src.details, taskId: src.task_id,
      startUtc: now, endUtc: null, createdAt: now,
    });
    setSessionTags(db, id, src.tags.map(t => t.id));
    return id;
  });
  return tx();
}

export function pauseTimer(db, now) {
  const active = getActiveSession(db);
  if (!active || active.pause_started_at != null) return active ? active.id : null;
  updateSession(db, active.id, { pauseStartedAt: now });
  return active.id;
}

export function resumeTimer(db, now) {
  const active = getActiveSession(db);
  if (!active || active.pause_started_at == null) return active ? active.id : null;
  updateSession(db, active.id, {
    pausedMs: active.paused_ms + (now - active.pause_started_at),
    pauseStartedAt: null,
  });
  return active.id;
}

export function timerState(db, now) {
  const active = getActiveSession(db);
  if (!active) return { state: 'none', session: null, elapsedMs: 0 };
  const session = decorateSession(db, getSession(db, active.id), now, getSettings(db).rounding_minutes);
  return { state: session.paused ? 'paused' : 'running', session, elapsedMs: session.durationMs };
}
