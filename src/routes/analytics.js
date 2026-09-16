import express from 'express';
import { buildReport, dayStartUTC } from '../analytics.js';
import { listSessions, decorateSession } from '../sessions.js';
import { listTasks, listTags } from '../catalog.js';
import { getSettings } from '../settings.js';
import { sessionsToCsv } from '../csv.js';
import { fmtDuration, fmtMoney } from './tracking.js';

const DAY = 86400000;

function parseParams(q) {
  const by = q.by === 'tag' ? 'tag' : 'task';
  const metric = q.metric === 'earnings' ? 'earnings' : 'time';
  const chart = q.chart === 'lines' ? 'lines' : 'bars';
  let to = q.to ? dayStartUTC(Number(q.to)) : dayStartUTC(Date.now());
  let from = q.from ? dayStartUTC(Number(q.from)) : to - 13 * DAY;
  if (from > to) [from, to] = [to, from];
  const shift = Number(q.shift) || 0;
  if (shift) { const step = (to - from) + DAY; from += shift * step; to += shift * step; }
  return { from, to, by, metric, chart };
}

function rangeLabel(from, to) {
  const opt = { timeZone: 'UTC', month: 'short', day: 'numeric' };
  const f = new Date(from).toLocaleDateString('en-US', opt);
  const t = new Date(to).toLocaleDateString('en-US', { ...opt, year: 'numeric' });
  return `${f} – ${t}`;
}

export function analyticsRouter(db) {
  const r = express.Router();
  const rounding = () => getSettings(db).rounding_minutes;

  function ctx(query) {
    const p = parseParams(query);
    const report = buildReport(db, { ...p, rounding: rounding() });
    return { p, report, rangeLabel: rangeLabel(p.from, p.to), tasks: listTasks(db), tags: listTags(db), fmtDuration, fmtMoney };
  }

  r.get('/analytics', (req, res) =>
    res.render('analytics', { title: 'Analytics', nav: 'analytics', ...ctx(req.query) }));

  r.get('/partials/analytics-panel', (req, res) =>
    res.render('partials/analytics-panel', ctx(req.query)));

  r.get('/export.csv', (req, res) => {
    const p = parseParams(req.query);
    const filter = { from: p.from, to: p.to + DAY - 1 };
    if (req.query.taskId) filter.taskId = Number(req.query.taskId);
    if (req.query.tagId) filter.tagId = Number(req.query.tagId);
    const rows = listSessions(db, filter)
      .filter(s => s.end_utc != null)
      .map(s => decorateSession(db, s, Date.now(), rounding()));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="time-export.csv"');
    res.send(sessionsToCsv(rows));
  });

  return r;
}
