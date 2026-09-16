import express from 'express';
import {
  listAllTasks, listTags, createTask, updateTask, getTask, deleteTask,
  setTaskHidden, addTaskTag, removeTaskTag,
} from '../catalog.js';

function rateCents(v) { return v ? Math.round(Number(v) * 100) : null; }

export function tasksRouter(db, hub) {
  const r = express.Router();

  const listCtx = () => ({ tasks: listAllTasks(db).map(t => getTask(db, t.id)) });
  const editCtx = (id) => ({ task: getTask(db, id), tags: listTags(db) });
  const tagsCtx = (id) => ({ task: getTask(db, id), tags: listTags(db) });

  r.get('/tasks', (req, res) =>
    res.render('tasks', { title: 'Tasks', nav: 'tasks', ...listCtx() }));

  r.post('/tasks', (req, res) => {
    createTask(db, { name: 'New task' });
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
    });
    setTaskHidden(db, id, !!req.body.hidden);
    hub.broadcast('changed');
    res.render('partials/task-row', { t: getTask(db, id) });
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

  return r;
}
