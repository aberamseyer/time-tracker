import express from 'express';
import {
  listTags, createTask, updateTask, getTask, deleteTask, setTaskHidden,
  addTaskTag, removeTaskTag, listTasksByClient,
  listClients, createClient, getClient, updateClient, deleteClient,
} from '../catalog.js';

function rateCents(v) { return v ? Math.round(Number(v) * 100) : null; }

export function tasksRouter(db, hub) {
  const r = express.Router();

  const listCtx = () => ({ groups: listTasksByClient(db) });
  const editCtx = (id) => ({ task: getTask(db, id), tags: listTags(db), clients: listClients(db) });
  const tagsCtx = (id) => ({ task: getTask(db, id), tags: listTags(db) });
  const groupOf = (id) => listTasksByClient(db).find(g => g.client && g.client.id === id)
    || { client: getClient(db, id), tasks: [] };

  r.get('/tasks', (req, res) =>
    res.render('tasks', { title: 'Tasks', nav: 'tasks', ...listCtx() }));

  r.post('/tasks', (req, res) => {
    createTask(db, { name: 'New task', clientId: req.body.clientId ? Number(req.body.clientId) : null });
    hub.broadcast('changed');
    res.render('partials/task-list', listCtx());
  });

  r.get('/tasks/:id/edit', (req, res) =>
    res.render('partials/task-edit', editCtx(Number(req.params.id))));

  r.get('/tasks/:id/row', (req, res) =>
    res.render('partials/task-row', { t: getTask(db, Number(req.params.id)) }));

  r.post('/tasks/:id', (req, res) => {
    const id = Number(req.params.id);
    const name = (req.body.name || '').trim() || 'Untitled';
    updateTask(db, id, {
      name, details: req.body.details || '', color: req.body.color || '#3b82f6',
      hourlyRateCents: rateCents(req.body.rate), isDefault: !!req.body.isDefault,
      clientId: req.body.clientId ? Number(req.body.clientId) : null,
    });
    setTaskHidden(db, id, !!req.body.hidden);
    hub.broadcast('changed');
    res.render('partials/task-list', listCtx());
  });

  r.post('/tasks/:id/hide', (req, res) => {
    const id = Number(req.params.id);
    const t = getTask(db, id);
    setTaskHidden(db, id, !t.archived);
    hub.broadcast('changed');
    res.render('partials/task-row', { t: getTask(db, id) });
  });

  r.post('/tasks/:id/delete', (req, res) => {
    deleteTask(db, Number(req.params.id));
    hub.broadcast('changed');
    res.status(200).end();
  });

  r.post('/tasks/:id/tags', (req, res) => {
    const id = Number(req.params.id);
    if (req.body.tagId) addTaskTag(db, id, Number(req.body.tagId));
    hub.broadcast('changed');
    res.render('partials/task-tags', tagsCtx(id));
  });

  r.post('/tasks/:id/tags/:tagId/delete', (req, res) => {
    const id = Number(req.params.id);
    removeTaskTag(db, id, Number(req.params.tagId));
    hub.broadcast('changed');
    res.render('partials/task-tags', tagsCtx(id));
  });

  r.post('/clients', (req, res) => {
    createClient(db, { name: 'New client' });
    hub.broadcast('changed');
    res.render('partials/task-list', listCtx());
  });

  r.get('/clients/:id/edit', (req, res) =>
    res.render('partials/client-edit', { c: getClient(db, Number(req.params.id)) }));

  r.get('/clients/:id/group', (req, res) =>
    res.render('partials/client-group', { group: groupOf(Number(req.params.id)) }));

  r.post('/clients/:id', (req, res) => {
    const id = Number(req.params.id);
    updateClient(db, id, {
      name: (req.body.name || '').trim() || 'Client',
      defaultRateCents: rateCents(req.body.rate),
      currency: (req.body.currency || 'USD').trim() || 'USD',
      address: req.body.address || '',
    });
    hub.broadcast('changed');
    res.render('partials/client-group', { group: groupOf(id) });
  });

  r.post('/clients/:id/delete', (req, res) => {
    deleteClient(db, Number(req.params.id));
    hub.broadcast('changed');
    res.render('partials/task-list', listCtx());
  });

  return r;
}
