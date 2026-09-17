import express from 'express';
import { buildReport, periodOf, listPeriods, dayStartUTC } from '../analytics.js';
import { listSessions, decorateSession } from '../sessions.js';
import { listTasks, listTags, listClients, getClient } from '../catalog.js';
import { getSettings } from '../settings.js';
import { sessionsToCsv } from '../csv.js';
import { fmtDuration, fmtMoney } from './tracking.js';

const DAY = 86400000;
const TYPES = ['week', 'month', 'quarter'];

function idsFrom(v) {
  return (Array.isArray(v) ? v : v != null && v !== '' ? [v] : []).map(Number).filter(n => !Number.isNaN(n));
}

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

    const allTasks = listTasks(db);
    const clientId = q.clientId ? Number(q.clientId) : null;
    const menuTasks = clientId ? allTasks.filter(t => t.client_id === clientId) : allTasks;
    const taskIds = idsFrom(q.taskId).filter(id => menuTasks.some(t => t.id === id));
    const tagIds = idsFrom(q.tagId);

    const p = { by, metric, chart, type, ps: period.start, from: period.from, to: period.to, unit: period.unit,
      clientId, taskIds, tagIds };
    const report = buildReport(db, { from: period.from, to: period.to, unit: period.unit, by, metric,
      rounding: rounding(), clientId, taskIds, tagIds });
    return { p, report, periods, rangeLabel: period.label,
      menuTasks, tags: listTags(db), clients: listClients(db), fmtDuration, fmtMoney };
  }

  r.get('/analytics', (req, res) =>
    res.render('analytics', { title: 'Analytics', nav: 'analytics', ...ctx(req.query) }));

  r.get('/partials/analytics-panel', (req, res) =>
    res.render('partials/analytics-panel', ctx(req.query)));

  r.get('/export.csv', (req, res) => {
    const type = TYPES.includes(req.query.type) ? req.query.type : 'week';
    const period = periodOf(type, req.query.ps ? Number(req.query.ps) : Date.now(), weekStart());
    const filter = { from: dayStartUTC(period.from), to: dayStartUTC(period.to) + DAY - 1 };
    if (req.query.clientId) filter.clientId = Number(req.query.clientId);
    const taskIds = idsFrom(req.query.taskId), tagIds = idsFrom(req.query.tagId);
    if (taskIds.length) filter.taskIds = taskIds;
    if (tagIds.length) filter.tagIds = tagIds;
    const clientCache = new Map();
    const clientOf = (id) => {
      if (!id) return null;
      if (!clientCache.has(id)) clientCache.set(id, getClient(db, id));
      return clientCache.get(id);
    };
    const rows = listSessions(db, filter)
      .filter(s => s.end_utc != null)
      .map(s => ({ ...decorateSession(db, s, Date.now(), rounding()), client: clientOf(s.task && s.task.client_id) }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="time-export.csv"');
    res.send(sessionsToCsv(rows));
  });

  return r;
}
