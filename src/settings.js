const ROUNDING = new Set([0, 15, 30, 60]);
const GROUPING = new Set(['day', 'week', 'month', 'quarter']);

export function getSettings(db) {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get();
}

// Update only the provided fields; validate each.
export function updateSettings(db, { roundingMinutes, sessionGrouping, weekStart } = {}) {
  const sets = [], vals = [];
  if (roundingMinutes !== undefined) {
    const r = Number(roundingMinutes);
    if (!ROUNDING.has(r)) throw new Error('invalid rounding');
    sets.push('rounding_minutes = ?'); vals.push(r);
  }
  if (sessionGrouping !== undefined) {
    if (!GROUPING.has(sessionGrouping)) throw new Error('invalid grouping');
    sets.push('session_grouping = ?'); vals.push(sessionGrouping);
  }
  if (weekStart !== undefined) {
    const w = Number(weekStart);
    if (!Number.isInteger(w) || w < 0 || w > 6) throw new Error('invalid week start');
    sets.push('week_start = ?'); vals.push(w);
  }
  if (!sets.length) return;
  db.prepare(`UPDATE settings SET ${sets.join(', ')} WHERE id = 1`).run(...vals);
}
