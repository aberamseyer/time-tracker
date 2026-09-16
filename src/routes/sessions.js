import express from 'express';
import { listSessions, getSession, updateSession, setSessionTags,
  createSession, deleteSession, decorateSession, latestByDescription, distinctDescriptions } from '../sessions.js';
import { listTasks, listTags, createTask, createTag } from '../catalog.js';
import { getSettings } from '../settings.js';
import { fmtDuration, fmtMoney, escapeHtml } from './tracking.js';

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

  function filterFrom(q) {
    return {
      q: q.q || undefined,
      taskId: q.taskId ? Number(q.taskId) : undefined,
      tagId: q.tagId ? Number(q.tagId) : undefined,
      unlabelled: q.unlabelled ? true : undefined,
      uncategorized: q.uncategorized ? true : undefined,
    };
  }

  function renderList(res, q) {
    const sessions = listSessions(db, filterFrom(q)).map(s => decorateSession(db, s, Date.now(), rounding()));
    res.render('partials/session-list', { sessions, fmtDuration, fmtMoney });
  }

  r.get('/tasks', (req, res) => {
    const sessions = listSessions(db, filterFrom(req.query)).map(s => decorateSession(db, s, Date.now(), rounding()));
    res.render('tasks', {
      title: 'Tasks', nav: 'tasks', sessions,
      tasks: listTasks(db), tags: listTags(db), q: req.query,
      focus: req.query.focus ? Number(req.query.focus) : null,
      descriptions: distinctDescriptions(db, '', 50), fmtDuration, fmtMoney, escapeHtml,
    });
  });

  r.get('/partials/session-list', (req, res) => renderList(res, req.query));

  r.get('/sessions/template', (req, res) => {
    const tpl = latestByDescription(db, req.query.description || '');
    const s = tpl ? { details: tpl.details, task_id: tpl.task_id, tags: tpl.tags } : { details: '', task_id: null, tags: [] };
    res.render('partials/wu-fields', { s, tasks: listTasks(db), tags: listTags(db) });
  });

  r.get('/sessions/:id/edit', (req, res) => {
    const s = getSession(db, Number(req.params.id));
    res.render('partials/session-edit', { s, tasks: listTasks(db), tags: listTags(db) });
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
    const decorated = decorateSession(db, getSession(db, id), Date.now(), rounding());
    res.render('partials/session-item', { s: decorated, fmtDuration });
  });

  r.post('/sessions', (req, res) => {
    const start = parseLocal(req.body.start), end = parseLocal(req.body.end);
    if (!start || !end || end < start) {
      return res.status(400).render('partials/error', { message: 'Start and end times are required' });
    }
    const id = createSession(db, {
      description: req.body.description || '',
      details: req.body.details || '',
      taskId: req.body.taskId ? Number(req.body.taskId) : null,
      startUtc: start, endUtc: end, createdAt: start,
    });
    setSessionTags(db, id, idsFrom(req.body, 'tagId'));
    hub.broadcast('changed');
    renderList(res, {});
  });

  r.post('/sessions/:id/delete', (req, res) => {
    deleteSession(db, Number(req.params.id));
    hub.broadcast('changed');
    res.status(200).end();
  });

  // Quick-add from the work-unit card: create and return an option/chip to inject.
  r.post('/tasks', (req, res) => {
    const name = (req.body._qtask || req.body.name || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Task name is required' });
    const id = createTask(db, { name });
    res.render('partials/task-option', { t: { id, name } });
  });

  r.post('/tags', (req, res) => {
    const name = (req.body._qtag || req.body.name || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Tag name is required' });
    const id = createTag(db, { name });
    res.render('partials/tag-chip', { t: { id, name, color: '#6b7280' } });
  });

  return r;
}
