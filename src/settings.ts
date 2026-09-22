import type Database from 'better-sqlite3';
import type { SettingsRow } from './types.js';

const ROUNDING: Set<number> = new Set([0, 6, 10, 15, 30, 60]);
const GROUPING: Set<string> = new Set(['day', 'week', 'biweek', 'month', 'quarter']);

export function getSettings(db: Database.Database, userId: number): SettingsRow {
  return db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId) as SettingsRow ?? {
    user_id: userId, business_from: '', currency: 'USD', week_start: 1, timezone: 'UTC', rounding_minutes: 0, session_grouping: 'day', invoice_seq: 0
  };
}

// Update only the provided fields; validate each.
export function updateSettings(
  db: Database.Database,
  userId: number,
  { roundingMinutes, sessionGrouping, weekStart, businessFrom }:
    { roundingMinutes?: unknown; sessionGrouping?: unknown; weekStart?: unknown; businessFrom?: unknown } = {}
): void {
  const sets: string[] = [], vals: (string | number)[] = [];
  if (businessFrom !== undefined) { sets.push('business_from = ?'); vals.push(String(businessFrom)); }
  if (roundingMinutes !== undefined) {
    const r = Number(roundingMinutes);
    if (!ROUNDING.has(r)) throw new Error('invalid rounding');
    sets.push('rounding_minutes = ?'); vals.push(r);
  }
  if (sessionGrouping !== undefined) {
    if (!GROUPING.has(sessionGrouping as string)) throw new Error('invalid grouping');
    sets.push('session_grouping = ?'); vals.push(sessionGrouping as string);
  }
  if (weekStart !== undefined) {
    const w = Number(weekStart);
    if (!Number.isInteger(w) || w < 0 || w > 6) throw new Error('invalid week start');
    sets.push('week_start = ?'); vals.push(w);
  }
  if (!sets.length) return;
  db.prepare(`UPDATE settings SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals, userId);
}

export function nextInvoiceNumber(db: Database.Database, userId: number): number {
  return (getSettings(db, userId).invoice_seq ?? 0) + 1;
}

export function recordInvoiceNumber(db: Database.Database, userId: number, n: number): void {
  db.prepare('UPDATE settings SET invoice_seq = MAX(invoice_seq, ?) WHERE user_id = ?').run(n, userId);
}
