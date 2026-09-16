import { createSession, getSession, updateSession, decorateSession } from './sessions.js';
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

export function startTimer(db, now, { taskId = null, description = '' } = {}) {
  const tx = db.transaction(() => {
    stopTimer(db, now);
    return createSession(db, { taskId, description, startUtc: now, endUtc: null, createdAt: now });
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
