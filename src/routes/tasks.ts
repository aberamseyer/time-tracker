import express, { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import {
  listTags, createTask, updateTask, getTask, deleteTask, setTaskHidden,
  addTaskTag, removeTaskTag, listTasksByClient,
  listClients, createClient, getClient, updateClient, deleteClient,
} from '../catalog.js';
import type { Hub } from '../types.js';

function rateCents(v: unknown): number | null { return v ? Math.round(Number(v) * 100) : null; }

export function tasksRouter(db: Database.Database, hub: Hub): Router {
  const r = express.Router();

  const listCtx = () => ({ groups: listTasksByClient(db) });
  const editCtx = (id: number) => ({ task: getTask(db, id), tags: listTags(db), clients: listClients(db) });
  const tagsCtx = (id: number) => ({ task: getTask(db, id), tags: listTags(db) });
  const groupOf = (id: number) => listTasksByClient(db).find(g => g.client && g.client.id === id)
    || { client: getClient(db, id), tasks: [] };

  r.get('/tasks', (req: Request, res: Response) =>
    res.render('tasks', { title: 'Tasks', nav: 'tasks', ...listCtx() }));

  r.post('/tasks', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    createTask(db, { name: 'New task', clientId: body.clientId ? Number(body.clientId) : null });
    hub.broadcast('changed');
    res.render('partials/task-list', listCtx());
  });

  r.get('/tasks/:id/edit', (req: Request, res: Response) =>
    res.render('partials/task-edit', editCtx(Number(req.params.id))));

  r.get('/tasks/:id/row', (req: Request, res: Response) =>
    res.render('partials/task-row', { t: getTask(db, Number(req.params.id)) }));

  r.post('/tasks/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const body = req.body as Record<string, unknown>;
    const name = ((body.name as string) || '').trim() || 'Untitled';
    updateTask(db, id, {
      name, details: (body.details as string) || '', color: (body.color as string) || '#3b82f6',
      hourlyRateCents: rateCents(body.rate), isDefault: !!body.isDefault,
      clientId: body.clientId ? Number(body.clientId) : null,
    });
    setTaskHidden(db, id, !!body.hidden);
    hub.broadcast('changed');
    res.render('partials/task-list', listCtx());
  });

  r.post('/tasks/:id/hide', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const t = getTask(db, id);
    setTaskHidden(db, id, !t!.archived);
    hub.broadcast('changed');
    res.render('partials/task-row', { t: getTask(db, id) });
  });

  r.post('/tasks/:id/delete', (req: Request, res: Response) => {
    deleteTask(db, Number(req.params.id));
    hub.broadcast('changed');
    res.status(200).end();
  });

  r.post('/tasks/:id/tags', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const body = req.body as Record<string, unknown>;
    if (body.tagId) addTaskTag(db, id, Number(body.tagId));
    hub.broadcast('changed');
    res.render('partials/task-tags', tagsCtx(id));
  });

  r.post('/tasks/:id/tags/:tagId/delete', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    removeTaskTag(db, id, Number(req.params.tagId));
    hub.broadcast('changed');
    res.render('partials/task-tags', tagsCtx(id));
  });

  r.post('/clients', (req: Request, res: Response) => {
    createClient(db, { name: 'New client' });
    hub.broadcast('changed');
    res.render('partials/task-list', listCtx());
  });

  r.get('/clients/:id/edit', (req: Request, res: Response) =>
    res.render('partials/client-edit', { c: getClient(db, Number(req.params.id)) }));

  r.get('/clients/:id/group', (req: Request, res: Response) =>
    res.render('partials/client-group', { group: groupOf(Number(req.params.id)) }));

  r.post('/clients/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const body = req.body as Record<string, unknown>;
    updateClient(db, id, {
      name: ((body.name as string) || '').trim() || 'Client',
      defaultRateCents: rateCents(body.rate),
      currency: ((body.currency as string) || 'USD').trim() || 'USD',
      address: (body.address as string) || '',
    });
    hub.broadcast('changed');
    res.render('partials/client-group', { group: groupOf(id) });
  });

  r.post('/clients/:id/delete', (req: Request, res: Response) => {
    deleteClient(db, Number(req.params.id));
    hub.broadcast('changed');
    res.render('partials/task-list', listCtx());
  });

  return r;
}
