import { segmentsDurationMs, roundDurationMs, earningsCents } from './calc.js';
import { effectiveRateCents } from './catalog.js';

export function createSession(db, { description = '', details = '', taskId = null, createdAt = Date.now(), segments = [] } = {}) {
  const id = db.prepare(
    'INSERT INTO session (description, details, task_id, created_at) VALUES (?, ?, ?, ?)'
  ).run(description, details, taskId, createdAt).lastInsertRowid;
  for (const seg of segments) addSegment(db, id, seg.start, seg.end ?? null);
  return id;
}

export function addSegment(db, sessionId, start, end = null) {
  return db.prepare(
    'INSERT INTO segment (session_id, start_utc, end_utc) VALUES (?, ?, ?)'
  ).run(sessionId, start, end).lastInsertRowid;
}

export function updateSegment(db, id, fields) {
  const sets = [], vals = [];
  if ('start' in fields) { sets.push('start_utc = ?'); vals.push(fields.start); }
  if ('end' in fields) { sets.push('end_utc = ?'); vals.push(fields.end); }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE segment SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function updateSession(db, id, fields) {
  const sets = [], vals = [];
  if ('description' in fields) { sets.push('description = ?'); vals.push(fields.description); }
  if ('details' in fields) { sets.push('details = ?'); vals.push(fields.details); }
  if ('taskId' in fields) { sets.push('task_id = ?'); vals.push(fields.taskId); }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE session SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function setSessionTags(db, id, tagIds) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM session_tag WHERE session_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO session_tag (session_id, tag_id) VALUES (?, ?)');
    for (const t of tagIds) ins.run(id, t);
  });
  tx();
}

export function deleteSession(db, id) {
  db.prepare('DELETE FROM session WHERE id = ?').run(id);
}

export function getSession(db, id) {
  const row = db.prepare('SELECT * FROM session WHERE id = ?').get(id);
  if (!row) return undefined;
  return hydrate(db, row);
}

function hydrate(db, row) {
  const segments = db.prepare(
    'SELECT * FROM segment WHERE session_id = ? ORDER BY start_utc'
  ).all(row.id);
  const tags = db.prepare(
    `SELECT tag.* FROM tag JOIN session_tag st ON st.tag_id = tag.id
     WHERE st.session_id = ? ORDER BY tag.name`
  ).all(row.id);
  const task = row.task_id ? db.prepare('SELECT * FROM task WHERE id = ?').get(row.task_id) : null;
  return { ...row, segments, tags, task };
}

export function listSessions(db, filter = {}) {
  const where = [], vals = [];
  if (filter.q) { where.push('s.description LIKE ?'); vals.push('%' + filter.q + '%'); }
  if (filter.taskId) { where.push('s.task_id = ?'); vals.push(filter.taskId); }
  if (filter.unlabelled) where.push("s.description = ''");
  if (filter.uncategorized) where.push('s.task_id IS NULL');
  if (filter.tagId) {
    where.push('EXISTS (SELECT 1 FROM session_tag st WHERE st.session_id = s.id AND st.tag_id = ?)');
    vals.push(filter.tagId);
  }
  if (filter.from != null) {
    where.push('EXISTS (SELECT 1 FROM segment g WHERE g.session_id = s.id AND COALESCE(g.end_utc, g.start_utc) >= ?)');
    vals.push(filter.from);
  }
  if (filter.to != null) {
    where.push('EXISTS (SELECT 1 FROM segment g WHERE g.session_id = s.id AND g.start_utc <= ?)');
    vals.push(filter.to);
  }
  const sql = `
    SELECT s.*, (SELECT MIN(start_utc) FROM segment g WHERE g.session_id = s.id) AS first_start
    FROM session s
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY first_start IS NULL, first_start DESC, s.id DESC`;
  return db.prepare(sql).all(...vals).map(row => hydrate(db, row));
}

export function decorateSession(db, session, now, roundingMinutes) {
  const running = session.segments.some(s => s.end_utc == null);
  const durationMs = segmentsDurationMs(session.segments, now);
  const roundedMs = running ? durationMs : roundDurationMs(durationMs, roundingMinutes);
  const rate = effectiveRateCents(db, session.task_id);
  return { ...session, running, durationMs, roundedMs, earningsCents: earningsCents(roundedMs, rate) };
}
