import express from 'express';
import { buildReport, periodOf, listPeriods, dayStartUTC } from '../analytics.js';
import { listSessions, decorateSession } from '../sessions.js';
import { listTasks, listTags } from '../catalog.js';
import { getSettings } from '../settings.js';
import { sessionsToCsv } from '../csv.js';
import { fmtDuration, fmtMoney } from './tracking.js';

const DAY = 86400000;
const TYPES = ['week', 'month', 'quarter'];

export function analyticsRouter(db) {
  const r = express.Router();
  const rounding = () => getSettings(db).rounding_minutes;
  const weekStart = () => getSettings(db).week_start ?? 1;

  function ctx(q) {
    const by = q.by === 'tag' ? 'tag' : 'task';
    const metric = q.metric === 'earnings' ? 'earnings' : 'time';
    const chart = q.chart === 'lines' ? 'lines' : 'bars';
    const type = TYPES.includes(q.type) ? q.type : 'week';
    const ws = weekStart();
    const periods = listPeriods(db, type, ws);
    const ps = q.ps ? Number(q.ps) : periods[0].ps;
    const period = periodOf(type, ps, ws);
    periods.forEach(x => { x.selected = x.ps === period.start; });
    const p = { by, metric, chart, type, ps: period.start, from: period.from, to: period.to, unit: period.unit };
    const report = buildReport(db, { from: period.from, to: period.to, unit: period.unit, by, metric, rounding: rounding() });
    return { p, report, periods, rangeLabel: period.label, tasks: listTasks(db), tags: listTags(db), fmtDuration, fmtMoney };
  }

  r.get('/analytics', (req, res) =>
    res.render('analytics', { title: 'Analytics', nav: 'analytics', ...ctx(req.query) }));

  r.get('/partials/analytics-panel', (req, res) =>
    res.render('partials/analytics-panel', ctx(req.query)));

  r.get('/export.csv', (req, res) => {
    const type = TYPES.includes(req.query.type) ? req.query.type : 'week';
    const period = periodOf(type, req.query.ps ? Number(req.query.ps) : Date.now(), weekStart());
    const filter = { from: dayStartUTC(period.from), to: dayStartUTC(period.to) + DAY - 1 };
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
