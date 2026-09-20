import express, { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { getSession, updateSession, setSessionTags,
  createSession, deleteSession, decorateSession, latestByDescription } from '../sessions.js';
import { listActiveTasksByClient, listTags, createTask, createTag, getTag, taskTagIds } from '../catalog.js';
import { getSettings } from '../settings.js';
import { fmtDuration } from './tracking.js';
import type { Hub } from '../types.js';

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

export function ensureUserId(req: Request): number {
  return (req.session && req.session.userId) ? req.session.userId : 0;
}

export function sessionsRouter(db: Database.Database, hub: Hub): Router {
  const r = express.Router();
  const rounding = (userId: number) => getSettings(db, userId).rounding_minutes;

  r.get('/sessions/template', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    const tpl = latestByDescription(db, (req.query.description as string) || '', userId);
    const s = tpl ? { details: tpl.details, task_id: tpl.task_id, tags: tpl.tags } : { details: '', task_id: null, tags: [] };
    res.render('partials/wu-fields', { s, taskGroups: listActiveTasksByClient(db, userId), tags: listTags(db, userId) });
  });

  r.get('/sessions/:id/edit', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    const s = getSession(db, Number(req.params.id), userId);
    const at = (ms: number | null) => ms == null
      ? { date: '', time: '' }
      : { date: new Date(ms).toISOString().slice(0, 10), time: new Date(ms).toISOString().slice(11, 16) };
    res.render('partials/session-edit', {
      s, startAt: at(s ? s.start_utc : null), endAt: at(s ? s.end_utc : null),
      taskGroups: listActiveTasksByClient(db, userId), tags: listTags(db, userId),
    });
  });

  r.post('/sessions/:id', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    const id = Number(req.params.id);
    const body = req.body as Record<string, unknown>;
    let times: { startUtc: number; endUtc: number } | undefined;
    if (body.date) {
      const start = parseLocal(`${body.date}T${body.start}`), end = parseLocal(`${body.date}T${body.end}`);
      if (start == null || end == null || end <= start) {
        return res.status(400).render('partials/error', { message: 'End must be after start' });
      }
      times = { startUtc: start, endUtc: end };
    }
    updateSession(db, id, {
      description: (body.description as string) ?? '',
      details: (body.details as string) ?? '',
      taskId: body.taskId ? Number(body.taskId) : null,
      ...(times ?? {}),
    }, userId);
    setSessionTags(db, id, idsFrom(body, 'tagId'), userId);
    hub.notify(userId, 'changed');
    const s = decorateSession(db, getSession(db, id, userId)!, Date.now(), rounding(userId), userId);
    res.render('partials/session-row', { s, fmtDuration });
  });

  r.post('/sessions', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    const body = req.body as Record<string, unknown>;
    const start = parseLocal(`${body.date}T${body.start}`), end = parseLocal(`${body.date}T${body.end}`);
    if (!body.date || start == null || end == null || end <= start) {
      return res.status(400).render('partials/manual-add', {
        taskGroups: listActiveTasksByClient(db, userId), tags: listTags(db, userId), error: 'End must be after start',
      });
    }
    const taskId = body.taskId ? Number(body.taskId) : null;
    const id = createSession(db, {
      description: (body.description as string) || '',
      details: (body.details as string) || '',
      taskId, startUtc: start, endUtc: end, createdAt: start, userId,
    });
    let tagIds = idsFrom(body, 'tagId');
    if (taskId) tagIds = [...new Set([...tagIds, ...taskTagIds(db, taskId, userId)])];
    setSessionTags(db, id, tagIds, userId);
    hub.notify(userId, 'changed');
    res.render('partials/manual-add', { taskGroups: listActiveTasksByClient(db, userId), tags: listTags(db, userId), error: null });
  });

  r.post('/sessions/:id/delete', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    deleteSession(db, Number(req.params.id), userId);
    hub.notify(userId, 'changed');
    res.status(200).end();
  });

  // Quick-add from the work-unit card: create and return an option/chip to inject.
  r.post('/quick/task', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const name = ((body._qtask as string) || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Task name is required' });
    const id = createTask(db, { name }, ensureUserId(req));
    res.render('partials/task-option', { t: { id, name } });
  });

  r.post('/quick/tag', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const name = ((body._qtag as string) || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Tag name is required' });
    const id = createTag(db, { name }, ensureUserId(req));
    res.render('partials/tag-chip', { t: getTag(db, id, ensureUserId(req)) });
  });

  return r;
}
