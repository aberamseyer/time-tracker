import express from 'express';
import { listSessions, getSession, updateSession, setSessionTags,
  createSession, deleteSession, updateSegment, decorateSession } from '../sessions.js';
import { listTasks, listTags, createTask, createTag } from '../catalog.js';
import { getSettings } from '../settings.js';
import { fmtDuration, fmtMoney } from './tracking.js';

function parseLocal(v) {
  if (!v) return null;
  const ms = Date.parse(v);
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
    const sessions = listSessions(db, filterFrom(q))
      .map(s => decorateSession(db, s, Date.now(), rounding()));
    res.render('partials/session-list', { sessions, fmtDuration, fmtMoney });
  }

  r.get('/tasks', (req, res) => {
    const sessions = listSessions(db, filterFrom(req.query))
      .map(s => decorateSession(db, s, Date.now(), rounding()));
    res.render('tasks', {
      title: 'Tasks', nav: 'tasks', sessions,
      tasks: listTasks(db), tags: listTags(db), q: req.query, fmtDuration, fmtMoney,
    });
  });

  r.get('/partials/session-list', (req, res) => renderList(res, req.query));

  r.get('/sessions/:id/edit', (req, res) => {
    const s = getSession(db, Number(req.params.id));
    res.render('partials/session-edit', { s, tasks: listTasks(db), tags: listTags(db) });
  });

  r.post('/sessions/:id', (req, res) => {
    const id = Number(req.params.id);
    updateSession(db, id, {
      description: req.body.description ?? '',
      details: req.body.details ?? '',
      taskId: req.body.taskId ? Number(req.body.taskId) : null,
    });
    setSessionTags(db, id, idsFrom(req.body, 'tagId'));
    const s = getSession(db, id);
    if (req.body.start && s.segments[0]) {
      updateSegment(db, s.segments[0].id, {
        start: parseLocal(req.body.start),
        end: parseLocal(req.body.end),
      });
    }
    hub.broadcast('changed');
    const decorated = decorateSession(db, getSession(db, id), Date.now(), rounding());
    res.render('partials/session-row', { s: decorated, fmtDuration });
  });

  r.post('/sessions', (req, res) => {
    const start = parseLocal(req.body.start), end = parseLocal(req.body.end);
    createSession(db, {
      description: req.body.description || '',
      taskId: req.body.taskId ? Number(req.body.taskId) : null,
      createdAt: start || Date.now(),
      segments: start ? [{ start, end }] : [],
    });
    hub.broadcast('changed');
    renderList(res, {});
  });

  r.post('/sessions/:id/delete', (req, res) => {
    deleteSession(db, Number(req.params.id));
    hub.broadcast('changed');
    res.status(200).end();
  });

  r.post('/tasks', (req, res) => {
    createTask(db, {
      name: req.body.name, color: req.body.color || '#3b82f6',
      hourlyRateCents: req.body.rate ? Math.round(Number(req.body.rate) * 100) : null,
    });
    res.render('partials/task-tag-pickers', { tasks: listTasks(db), tags: listTags(db), s: null });
  });

  r.post('/tags', (req, res) => {
    createTag(db, { name: req.body.name, color: req.body.color || '#6b7280' });
    res.render('partials/task-tag-pickers', { tasks: listTasks(db), tags: listTags(db), s: null });
  });

  return r;
}
