import { listSessions, decorateSession } from './sessions.js';

const DAY = 86400000;
const GREY = '#9ca3af';

export function dayStartUTC(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function dayLabel(ms) {
  return new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

// Aggregate completed sessions into per-day series grouped by task or tag.
export function buildReport(db, { from, to, by = 'task', metric = 'time', rounding = 0 }) {
  const sessions = listSessions(db, { from, to: to + DAY - 1 }).filter(s => s.end_utc != null);
  const days = [];
  for (let d = dayStartUTC(from); d <= dayStartUTC(to); d += DAY) days.push(d);
  const dayIndex = new Map(days.map((k, i) => [k, i]));
  const seriesMap = new Map();
  const ensure = (key, name, color) => {
    if (!seriesMap.has(key)) seriesMap.set(key, { key, name, color, values: days.map(() => 0), total: 0 });
    return seriesMap.get(key);
  };
  for (const s of sessions) {
    const di = dayIndex.get(dayStartUTC(s.start_utc));
    if (di == null) continue;
    const dec = decorateSession(db, s, Date.now(), rounding);
    const value = metric === 'earnings' ? dec.earningsCents : dec.roundedMs;
    if (by === 'tag') {
      const tags = s.tags.length ? s.tags : [{ id: 0, name: 'Untagged', color: GREY }];
      for (const t of tags) { const ser = ensure('tag:' + t.id, t.name, t.color); ser.values[di] += value; ser.total += value; }
    } else {
      const key = s.task ? 'task:' + s.task.id : 'task:0';
      const ser = ensure(key, s.task ? s.task.name : 'No task', s.task ? s.task.color : GREY);
      ser.values[di] += value; ser.total += value;
    }
  }
  const series = [...seriesMap.values()].sort((a, b) => b.total - a.total);
  const grandTotal = series.reduce((n, s) => n + s.total, 0);
  return { days: days.map(k => ({ key: k, label: dayLabel(k) })), series, grandTotal, metric, by };
}
