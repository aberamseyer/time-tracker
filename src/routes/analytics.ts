import express, { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { buildReport, periodOf, listPeriods, dayStartUTC } from '../analytics.js';
import { listSessions, decorateSession } from '../sessions.js';
import { listTasks, listTags, listClients, getClient } from '../catalog.js';
import { getSettings } from '../settings.js';
import { sessionsToCsv } from '../csv.js';
import { fmtDuration, fmtMoney } from './tracking.js';
import type { SessionFilter } from '../types.js';
import { MS_PER_DAY } from '../constants.js';

const TYPES = ['week', 'month', 'quarter'];

function idsFrom(v: unknown): number[] {
  return (Array.isArray(v) ? v : v != null && v !== '' ? [v] : []).map(Number).filter(n => !Number.isNaN(n));
}

export function analyticsRouter(db: Database.Database): Router {
  const r = express.Router();
  const rounding = (userId: number) => getSettings(db, userId).rounding_minutes;
  const weekStart = (userId: number) => getSettings(db, userId).week_start ?? 1;

  function ctx(q: Record<string, unknown>, userId: number) {
    const by = q.by === 'tag' ? 'tag' : 'task';
    const metric = q.metric === 'earnings' ? 'earnings' : 'time';
    const chart = q.chart === 'lines' ? 'lines' : 'bars';
    const type = TYPES.includes(q.type as string) ? (q.type as string) : 'week';
    const ws = weekStart(userId);
    const periods = listPeriods(db, type, ws);
    const ps = q.ps ? Number(q.ps) : periods[0].ps;
    const period = periodOf(type, ps, ws);
    periods.forEach(x => { x.selected = x.ps === period.start; });

    const allTasks = listTasks(db, userId);
    const clientId = q.clientId ? Number(q.clientId) : null;
    const menuTasks = clientId ? allTasks.filter(t => t.client_id === clientId) : allTasks;
    const taskIds = idsFrom(q.taskId).filter(id => menuTasks.some(t => t.id === id));
    const tagIds = idsFrom(q.tagId);

    const p = { by, metric, chart, type, ps: period.start, from: period.from, to: period.to, unit: period.unit,
      clientId, taskIds, tagIds };
    const report = buildReport(db, { from: period.from, to: period.to, unit: period.unit, by, metric,
      rounding: rounding(userId), clientId, taskIds, tagIds, userId });
    return { p, report, periods, rangeLabel: period.label,
      menuTasks, tags: listTags(db, userId), clients: listClients(db, userId), fmtDuration, fmtMoney };
  }

  r.get('/analytics', (req: Request, res: Response) => {
    const userId = (req.session && req.session.userId) ? req.session.userId : 0;
    res.render('analytics', { title: 'Analytics', nav: 'analytics', ...ctx(req.query as Record<string, unknown>, userId) });
  });

  r.get('/partials/analytics-panel', (req: Request, res: Response) => {
    const userId = (req.session && req.session.userId) ? req.session.userId : 0;
    res.render('partials/analytics-panel', ctx(req.query as Record<string, unknown>, userId));
  });

  r.get('/export.csv', (req: Request, res: Response) => {
    const userId = (req.session && req.session.userId) ? req.session.userId : 0;
    const query = req.query as Record<string, unknown>;
    const type = TYPES.includes(query.type as string) ? (query.type as string) : 'week';
    const period = periodOf(type, query.ps ? Number(query.ps) : Date.now(), weekStart(userId));
    const filter: SessionFilter = { from: dayStartUTC(period.from), to: dayStartUTC(period.to) + MS_PER_DAY - 1 };
    if (query.clientId) filter.clientId = Number(query.clientId);
    const taskIds = idsFrom(query.taskId), tagIds = idsFrom(query.tagId);
    if (taskIds.length) filter.taskIds = taskIds;
    if (tagIds.length) filter.tagIds = tagIds;
    const clientCache = new Map();
    const clientOf = (id: number | null | undefined) => {
      if (!id) return null;
      if (!clientCache.has(id)) clientCache.set(id, getClient(db, id, userId));
      return clientCache.get(id);
    };
    const rows = listSessions(db, filter, userId)
      .filter(s => s.end_utc != null)
      .map(s => ({ ...decorateSession(db, s, Date.now(), rounding(userId), userId), client: clientOf(s.task && s.task.client_id) }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="time-export.csv"');
    res.send(sessionsToCsv(rows));
  });

  return r;
}
