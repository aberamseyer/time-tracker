import type Database from 'better-sqlite3';
import { listSessions, decorateSession } from './sessions.js';
import type { SessionFilter, Series, Report, Period, Bucket } from './types.js';

const DAY = 86400000;
const GREY = '#9ca3af';

export function dayStartUTC(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function mdLabel(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

// Aggregate completed sessions into buckets (day or week) grouped by task or tag.
export function buildReport(db: Database.Database, {
  from, to, unit = 'day', by = 'task', metric = 'time', rounding = 0,
  clientId = null, taskIds = [], tagIds = [],
}: {
  from: number; to: number; unit?: 'day' | 'week'; by?: 'task' | 'tag'; metric?: 'time' | 'earnings';
  rounding?: number; clientId?: number | null; taskIds?: number[]; tagIds?: number[];
}): Report {
  const size = unit === 'week' ? 7 * DAY : DAY;
  const start = dayStartUTC(from);
  const end = dayStartUTC(to) + DAY;
  const n = Math.max(1, Math.ceil((end - start) / size));
  const buckets: Bucket[] = [];
  for (let i = 0; i < n; i++) buckets.push({ start: start + i * size, label: mdLabel(start + i * size) });
  const filter: SessionFilter = { from: start, to: end - 1 };
  if (clientId) filter.clientId = clientId;
  if (taskIds.length) filter.taskIds = taskIds;
  if (tagIds.length) filter.tagIds = tagIds;
  const sessions = listSessions(db, filter).filter(s => s.end_utc != null);
  const seriesMap: Map<string, Series> = new Map();
  const ensure = (key: string, name: string, color: string): Series => {
    if (!seriesMap.has(key)) seriesMap.set(key, { key, name, color, values: buckets.map(() => 0), total: 0 });
    return seriesMap.get(key)!;
  };
  for (const s of sessions) {
    const bi = Math.floor((dayStartUTC(s.start_utc!) - start) / size);
    if (bi < 0 || bi >= n) continue;
    const dec = decorateSession(db, s, Date.now(), rounding);
    const value = metric === 'earnings' ? dec.earningsCents : dec.roundedMs;
    if (by === 'tag') {
      const tags = s.tags.length ? s.tags : [{ id: 0, name: 'Untagged', color: GREY, archived: 0 }];
      for (const t of tags) { const ser = ensure('tag:' + t.id, t.name, t.color); ser.values[bi] += value; ser.total += value; }
    } else {
      const ser = ensure(s.task ? 'task:' + s.task.id : 'task:0', s.task ? s.task.name : 'No task', s.task ? s.task.color : GREY);
      ser.values[bi] += value; ser.total += value;
    }
  }
  const series = [...seriesMap.values()].sort((a, b) => b.total - a.total);
  const grandTotal = series.reduce((sum, s) => sum + s.total, 0);
  return { buckets, series, grandTotal, metric, by };
}

// --- Period navigation (week / month / quarter) ---

function weekStartOf(ms: number, weekStart: number): number {
  const ds = dayStartUTC(ms);
  const diff = (new Date(ds).getUTCDay() - weekStart + 7) % 7;
  return ds - diff * DAY;
}
function monthStartOf(ms: number): number { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
function quarterStartOf(ms: number): number { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1); }

// A period is its span [from,to] plus the bucket unit and a label.
export function periodOf(type: string, ms: number, weekStart = 1): Period {
  if (type === 'month') {
    const start = monthStartOf(ms), d = new Date(start);
    return { type, start, from: start, to: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0), unit: 'day',
      label: new Date(start).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }) };
  }
  if (type === 'quarter') {
    const start = quarterStartOf(ms), d = new Date(start), q = Math.floor(d.getUTCMonth() / 3) + 1;
    return { type, start, from: start, to: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 0), unit: 'week',
      label: `Q${q} ${d.getUTCFullYear()}` };
  }
  const start = weekStartOf(ms, weekStart);
  return { type, start, from: start, to: start + 6 * DAY, unit: 'day', label: mdLabel(start) };
}

function nextPeriodStart(type: string, start: number): number {
  const d = new Date(start);
  if (type === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  if (type === 'quarter') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1);
  return start + 7 * DAY;
}

// Every period of `type` spanning the first..last completed session (newest first).
export function listPeriods(
  db: Database.Database,
  type: string,
  weekStart = 1,
): { ps: number; label: string; selected?: boolean }[] {
  const row = db.prepare('SELECT MIN(start_utc) a, MAX(start_utc) b FROM session WHERE end_utc IS NOT NULL').get() as
    { a: number | null; b: number | null };
  const now = Date.now();
  const first = row && row.a != null ? row.a : now;
  const last = row && row.b != null ? row.b : now;
  const periods: { ps: number; label: string; selected?: boolean }[] = [];
  let ps = periodOf(type, first, weekStart).start;
  const lastStart = periodOf(type, last, weekStart).start;
  let guard = 0;
  while (ps <= lastStart && guard++ < 2000) { periods.push({ ps, label: periodOf(type, ps, weekStart).label }); ps = nextPeriodStart(type, ps); }
  if (!periods.length) { const p = periodOf(type, now, weekStart); periods.push({ ps: p.start, label: p.label }); }
  return periods.reverse();
}
