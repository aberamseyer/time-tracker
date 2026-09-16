import express from 'express';
import { getSettings, updateSettings } from '../settings.js';
import { listTasks, listTags, createTask, createTag, updateTask, updateTag, archiveTask, archiveTag } from '../catalog.js';

function rateCents(v) {
  return v ? Math.round(Number(v) * 100) : null;
}

export function settingsRouter(db, hub) {
  const r = express.Router();

  r.get('/settings', (req, res) =>
    res.render('settings', {
      title: 'Settings', nav: 'settings', settings: getSettings(db),
      tasks: listTasks(db), tags: listTags(db), error: null,
    }));

  r.post('/settings', (req, res) => {
    try {
      updateSettings(db, { roundingMinutes: req.body.roundingMinutes });
      hub.broadcast('changed');
      res.redirect('/settings');
    } catch {
      res.render('settings', {
        title: 'Settings', nav: 'settings', settings: getSettings(db),
        tasks: listTasks(db), tags: listTags(db), error: 'Invalid rounding value',
      });
    }
  });

  const tasksPartial = (res) =>
    res.render('partials/settings-tasks', { tasks: listTasks(db) });
  const tagsPartial = (res) =>
    res.render('partials/settings-tags', { tags: listTags(db) });

  r.post('/settings/tasks', (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Task name is required' });
    createTask(db, { name, color: req.body.color || '#3b82f6', hourlyRateCents: rateCents(req.body.rate) });
    hub.broadcast('changed');
    tasksPartial(res);
  });
  r.post('/settings/tasks/:id', (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Task name is required' });
    updateTask(db, Number(req.params.id), { name, color: req.body.color || '#3b82f6', hourlyRateCents: rateCents(req.body.rate) });
    hub.broadcast('changed');
    tasksPartial(res);
  });
  r.post('/settings/tasks/:id/archive', (req, res) => {
    archiveTask(db, Number(req.params.id));
    hub.broadcast('changed');
    tasksPartial(res);
  });

  r.post('/settings/tags', (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Tag name is required' });
    createTag(db, { name, color: req.body.color || '#6b7280' });
    hub.broadcast('changed');
    tagsPartial(res);
  });
  r.post('/settings/tags/:id', (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Tag name is required' });
    updateTag(db, Number(req.params.id), { name, color: req.body.color || '#6b7280' });
    hub.broadcast('changed');
    tagsPartial(res);
  });
  r.post('/settings/tags/:id/archive', (req, res) => {
    archiveTag(db, Number(req.params.id));
    hub.broadcast('changed');
    tagsPartial(res);
  });

  return r;
}
