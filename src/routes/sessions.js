import express from 'express';
import { getSession, updateSession, setSessionTags,
  createSession, deleteSession, decorateSession, latestByDescription } from '../sessions.js';
import { listActiveTasksByClient, listTags, createTask, createTag, getTag, taskTagIds } from '../catalog.js';
import { getSettings } from '../settings.js';
import { fmtDuration } from './tracking.js';

// Wall-clock times are treated as UTC (v2); timezone setting is future work.
function parseLocal(v) {
  if (!v) return null;
  const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + 'Z';
  const ms = Date.parse(withZone);
  return Number.isNaN(ms) ? null : ms;
}

function idsFrom(body, key) {
  const v = body[key];
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).map(Number).filter(Boolean);
}

export function sessionsRouter(db, hub) {
  const r = express.Router();
  const rounding = () => getSettings(db).rounding_minutes;

  r.get('/sessions/template', (req, res) => {
    const tpl = latestByDescription(db, req.query.description || '');
    const s = tpl ? { details: tpl.details, task_id: tpl.task_id, tags: tpl.tags } : { details: '', task_id: null, tags: [] };
    res.render('partials/wu-fields', { s, taskGroups: listActiveTasksByClient(db), tags: listTags(db) });
  });

  r.get('/sessions/:id/edit', (req, res) => {
    const s = getSession(db, Number(req.params.id));
    res.render('partials/session-edit', { s, taskGroups: listActiveTasksByClient(db), tags: listTags(db) });
  });

  r.post('/sessions/:id', (req, res) => {
    const id = Number(req.params.id);
    let start, end;
    if (req.body.start) {
      start = parseLocal(req.body.start); end = parseLocal(req.body.end);
      if (!start || !end || end < start) {
        return res.status(400).render('partials/error', { message: 'Start and end times are required' });
      }
    }
    updateSession(db, id, {
      description: req.body.description ?? '',
      details: req.body.details ?? '',
      taskId: req.body.taskId ? Number(req.body.taskId) : null,
      ...(req.body.start ? { startUtc: start, endUtc: end } : {}),
    });
    setSessionTags(db, id, idsFrom(req.body, 'tagId'));
    hub.broadcast('changed');
    const s = decorateSession(db, getSession(db, id), Date.now(), rounding());
    res.render('partials/session-row', { s, fmtDuration });
  });

  r.post('/sessions', (req, res) => {
    const start = parseLocal(req.body.start), end = parseLocal(req.body.end);
    if (!start || !end || end < start) {
      return res.status(400).render('partials/manual-add', {
        taskGroups: listActiveTasksByClient(db), tags: listTags(db), error: 'Start and end times are required',
      });
    }
    const taskId = req.body.taskId ? Number(req.body.taskId) : null;
    const id = createSession(db, {
      description: req.body.description || '',
      details: req.body.details || '',
      taskId, startUtc: start, endUtc: end, createdAt: start,
    });
    let tagIds = idsFrom(req.body, 'tagId');
    if (taskId) tagIds = [...new Set([...tagIds, ...taskTagIds(db, taskId)])];
    setSessionTags(db, id, tagIds);
    hub.broadcast('changed');
    res.render('partials/manual-add', { taskGroups: listActiveTasksByClient(db), tags: listTags(db), error: null });
  });

  r.post('/sessions/:id/delete', (req, res) => {
    deleteSession(db, Number(req.params.id));
    hub.broadcast('changed');
    res.status(200).end();
  });

  // Quick-add from the work-unit card: create and return an option/chip to inject.
  r.post('/quick/task', (req, res) => {
    const name = (req.body._qtask || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Task name is required' });
    const id = createTask(db, { name });
    res.render('partials/task-option', { t: { id, name } });
  });

  r.post('/quick/tag', (req, res) => {
    const name = (req.body._qtag || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Tag name is required' });
    const id = createTag(db, { name });
    res.render('partials/tag-chip', { t: getTag(db, id) });
  });

  return r;
}
