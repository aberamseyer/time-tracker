import express, { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { getSession, updateSession, setSessionTags,
  createSession, deleteSession, decorateSession, latestByDescription } from '../sessions.js';
import { listActiveTasksByClient, listTags, createTask, createTag, getTag, taskTagIds } from '../catalog.js';
import { getSettings } from '../settings.js';
import { fmtDuration } from './tracking.js';
import type { Hub } from '../types.js';

// Wall-clock times are treated as UTC (v2); timezone setting is future work.
function parseLocal(v: unknown): number | null {
  if (!v) return null;
  const s = String(v);
  const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z';
  const ms = Date.parse(withZone);
  return Number.isNaN(ms) ? null : ms;
}

function idsFrom(body: Record<string, unknown>, key: string): number[] {
  const v = body[key];
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).map(Number).filter(Boolean);
}

export function sessionsRouter(db: Database.Database, hub: Hub): Router {
  const r = express.Router();
  const rounding = () => getSettings(db).rounding_minutes;

  r.get('/sessions/template', (req: Request, res: Response) => {
    const tpl = latestByDescription(db, (req.query.description as string) || '');
    const s = tpl ? { details: tpl.details, task_id: tpl.task_id, tags: tpl.tags } : { details: '', task_id: null, tags: [] };
    res.render('partials/wu-fields', { s, taskGroups: listActiveTasksByClient(db), tags: listTags(db) });
  });

  r.get('/sessions/:id/edit', (req: Request, res: Response) => {
    const s = getSession(db, Number(req.params.id));
    res.render('partials/session-edit', { s, taskGroups: listActiveTasksByClient(db), tags: listTags(db) });
  });

  r.post('/sessions/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const body = req.body as Record<string, unknown>;
    let start, end;
    if (body.start) {
      start = parseLocal(body.start); end = parseLocal(body.end);
      if (!start || !end || end < start) {
        return res.status(400).render('partials/error', { message: 'Start and end times are required' });
      }
    }
    updateSession(db, id, {
      description: (body.description as string) ?? '',
      details: (body.details as string) ?? '',
      taskId: body.taskId ? Number(body.taskId) : null,
      ...(body.start ? { startUtc: start, endUtc: end } : {}),
    });
    setSessionTags(db, id, idsFrom(body, 'tagId'));
    hub.broadcast('changed');
    const s = decorateSession(db, getSession(db, id)!, Date.now(), rounding());
    res.render('partials/session-row', { s, fmtDuration });
  });

  r.post('/sessions', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const start = parseLocal(body.start), end = parseLocal(body.end);
    if (!start || !end || end < start) {
      return res.status(400).render('partials/manual-add', {
        taskGroups: listActiveTasksByClient(db), tags: listTags(db), error: 'Start and end times are required',
      });
    }
    const taskId = body.taskId ? Number(body.taskId) : null;
    const id = createSession(db, {
      description: (body.description as string) || '',
      details: (body.details as string) || '',
      taskId, startUtc: start, endUtc: end, createdAt: start,
    });
    let tagIds = idsFrom(body, 'tagId');
    if (taskId) tagIds = [...new Set([...tagIds, ...taskTagIds(db, taskId)])];
    setSessionTags(db, id, tagIds);
    hub.broadcast('changed');
    res.render('partials/manual-add', { taskGroups: listActiveTasksByClient(db), tags: listTags(db), error: null });
  });

  r.post('/sessions/:id/delete', (req: Request, res: Response) => {
    deleteSession(db, Number(req.params.id));
    hub.broadcast('changed');
    res.status(200).end();
  });

  // Quick-add from the work-unit card: create and return an option/chip to inject.
  r.post('/quick/task', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const name = ((body._qtask as string) || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Task name is required' });
    const id = createTask(db, { name });
    res.render('partials/task-option', { t: { id, name } });
  });

  r.post('/quick/tag', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const name = ((body._qtag as string) || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Tag name is required' });
    const id = createTag(db, { name });
    res.render('partials/tag-chip', { t: getTag(db, id) });
  });

  return r;
}
