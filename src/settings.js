const ALLOWED = new Set([0, 15, 30, 60]);

export function getSettings(db) {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get();
}

export function updateSettings(db, { roundingMinutes }) {
  const r = Number(roundingMinutes);
  if (!ALLOWED.has(r)) throw new Error('invalid rounding');
  db.prepare('UPDATE settings SET rounding_minutes = ? WHERE id = 1').run(r);
}
