import { createSession, addSegment, getSession, decorateSession } from './sessions.js';
import { getSettings } from './settings.js';

export function getOpenSegment(db) {
  return db.prepare('SELECT * FROM segment WHERE end_utc IS NULL').get();
}

function closeOpen(db, now) {
  const open = getOpenSegment(db);
  if (open) {
    db.prepare('UPDATE segment SET end_utc = ? WHERE id = ?').run(now, open.id);
    return open.session_id;
  }
  return null;
}

export function startTimer(db, now, { taskId = null, description = '' } = {}) {
  const tx = db.transaction(() => {
    closeOpen(db, now);
    const id = createSession(db, { taskId, description, createdAt: now });
    addSegment(db, id, now, null);
    return id;
  });
  return tx();
}

export function pauseTimer(db, now) {
  return closeOpen(db, now);
}

export function resumeTimer(db, now, sessionId) {
  const tx = db.transaction(() => {
    closeOpen(db, now);
    addSegment(db, sessionId, now, null);
    return sessionId;
  });
  return tx();
}

export function stopTimer(db, now) {
  return closeOpen(db, now);
}

export function timerState(db, now) {
  const open = getOpenSegment(db);
  if (!open) return { running: false, session: null, since: null };
  const session = decorateSession(db, getSession(db, open.session_id), now, getSettings(db).rounding_minutes);
  return { running: true, session, since: open.start_utc };
}
