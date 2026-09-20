import express, { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import {
  listTags, createTask, updateTask, getTask, deleteTask, setTaskHidden,
  addTaskTag, removeTaskTag, listTasksByClient,
  listClients, createClient, getClient, updateClient, deleteClient,
} from '../catalog.js';
import { ensureUserId } from './sessions.js';
import { DEFAULT_TASK_COLOR } from '../colors.js';
import type { Hub } from '../types.js';

function rateCents(v: unknown): number | null { return v ? Math.round(Number(v) * 100) : null; }

export function tasksRouter(db: Database.Database, hub: Hub): Router {
  const r = express.Router();

  const listCtx = (userId: number) => ({ groups: listTasksByClient(db, userId) });
  const editCtx = (id: number, userId: number) => ({ task: getTask(db, id, userId), tags: listTags(db, userId), clients: listClients(db, userId) });
  const tagsCtx = (id: number, userId: number) => ({ task: getTask(db, id, userId), tags: listTags(db, userId) });
  const groupOf = (id: number, userId: number) => listTasksByClient(db, userId).find(g => g.client && g.client.id === id)
    || { client: getClient(db, id, userId), tasks: [] };

  r.get('/tasks', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    res.render('tasks', { title: 'Tasks', nav: 'tasks', ...listCtx(userId) });
  });

  r.post('/tasks', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    const body = req.body as Record<string, unknown>;
    createTask(db, { name: 'New task', clientId: body.clientId ? Number(body.clientId) : null }, userId);
    hub.notify(userId, 'changed');
    res.render('partials/task-list', listCtx(userId));
  });

  r.get('/tasks/:id/edit', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    res.render('partials/task-edit', editCtx(Number(req.params.id), userId));
  });

  r.get('/tasks/:id/row', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    res.render('partials/task-row', { t: getTask(db, Number(req.params.id), userId) });
  });

  r.post('/tasks/:id', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    const id = Number(req.params.id);
    const body = req.body as Record<string, unknown>;
    const name = ((body.name as string) || '').trim() || 'Untitled';
    updateTask(db, id, {
      name, details: (body.details as string) || '', color: (body.color as string) || DEFAULT_TASK_COLOR,
      hourlyRateCents: rateCents(body.rate), isDefault: !!body.isDefault,
      clientId: body.clientId ? Number(body.clientId) : null,
    }, userId);
    setTaskHidden(db, id, !!body.hidden, userId);
    hub.notify(userId, 'changed');
    res.render('partials/task-list', listCtx(userId));
  });

  r.post('/tasks/:id/hide', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    const id = Number(req.params.id);
    const t = getTask(db, id, userId);
    setTaskHidden(db, id, !t!.archived, userId);
    hub.notify(userId, 'changed');
    res.render('partials/task-row', { t: getTask(db, id, userId) });
  });

  r.post('/tasks/:id/delete', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    deleteTask(db, Number(req.params.id), userId);
    hub.notify(userId, 'changed');
    res.status(200).end();
  });

  r.post('/tasks/:id/tags', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    const id = Number(req.params.id);
    const body = req.body as Record<string, unknown>;
    if (body.tagId) addTaskTag(db, id, Number(body.tagId), userId);
    hub.notify(userId, 'changed');
    res.render('partials/task-tags', tagsCtx(id, userId));
  });

  r.post('/tasks/:id/tags/:tagId/delete', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    const id = Number(req.params.id);
    removeTaskTag(db, id, Number(req.params.tagId), userId);
    hub.notify(userId, 'changed');
    res.render('partials/task-tags', tagsCtx(id, userId));
  });

  r.post('/clients', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    createClient(db, { name: 'New client' }, userId);
    hub.notify(userId, 'changed');
    res.render('partials/task-list', listCtx(userId));
  });

  r.get('/clients/:id/edit', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    res.render('partials/client-edit', { c: getClient(db, Number(req.params.id), userId) });
  });

  r.get('/clients/:id/group', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    res.render('partials/client-group', { group: groupOf(Number(req.params.id), userId) });
  });

  r.post('/clients/:id', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    const id = Number(req.params.id);
    const body = req.body as Record<string, unknown>;
    updateClient(db, id, {
      name: ((body.name as string) || '').trim() || 'Client',
      defaultRateCents: rateCents(body.rate),
      currency: ((body.currency as string) || 'USD').trim() || 'USD',
      address: (body.address as string) || '',
    }, userId);
    hub.notify(userId, 'changed');
    res.render('partials/client-group', { group: groupOf(id, userId) });
  });

  r.post('/clients/:id/delete', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    deleteClient(db, Number(req.params.id), userId);
    hub.notify(userId, 'changed');
    res.render('partials/task-list', listCtx(userId));
  });

  return r;
}
