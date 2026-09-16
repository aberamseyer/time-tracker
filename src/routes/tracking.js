import express from 'express';
import { startTimer, startTimerFrom, pauseTimer, stopTimer, resumeTimer, timerState, getActiveSession } from '../timer.js';
import { listSessions, decorateSession, updateSession, setSessionTags, distinctDescriptions, latestByDescription } from '../sessions.js';
import { listTasks, listTags, taskTagIds } from '../catalog.js';
import { getSettings } from '../settings.js';

export function fmtDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

export function fmtMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}
function dayLabel(ms) {
  return new Date(ms).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function groupByDay(db, sessions, now, rounding) {
  const groups = new Map();
  for (const s of sessions) {
    const d = decorateSession(db, s, now, rounding);
    const anchor = s.start_utc ?? s.created_at;
    const key = dayKey(anchor);
    if (!groups.has(key)) {
      groups.set(key, { key, anchor, label: dayLabel(anchor), sessions: [], totalMs: 0, totalCents: 0 });
    }
    const g = groups.get(key);
    g.sessions.push(d);
    g.totalMs += d.roundedMs;
    g.totalCents += d.earningsCents;
  }
  return [...groups.values()].sort((a, b) => b.anchor - a.anchor);
}

export function trackingRouter(db, hub) {
  const r = express.Router();
  const rounding = () => getSettings(db).rounding_minutes;

  function activeCtx() {
    return { state: timerState(db, Date.now()), tasks: listTasks(db), tags: listTags(db), fmtDuration };
  }

  function idsFrom(v) {
    return (Array.isArray(v) ? v : v != null && v !== '' ? [v] : []).map(Number).filter(n => !Number.isNaN(n));
  }
  function filterFrom(q) {
    return {
      from: Date.now() - 14 * 24 * 3600 * 1000,
      q: q.q || undefined,
      taskIds: idsFrom(q.taskId),
      tagIds: idsFrom(q.tagId),
      invertTask: q.invertTask ? true : undefined,
      invertTag: q.invertTag ? true : undefined,
    };
  }
  function filterCtx(q) {
    return {
      tasks: listTasks(db), tags: listTags(db), q,
      selTasks: idsFrom(q.taskId), selTags: idsFrom(q.tagId),
    };
  }

  r.get('/', (req, res) => {
    const groups = groupByDay(db, listSessions(db, filterFrom(req.query)), Date.now(), rounding());
    res.render('tracking', {
      title: 'Time tracking', nav: 'tracking',
      ...activeCtx(), ...filterCtx(req.query), groups, fmtMoney, descriptions: distinctDescriptions(db, '', 50),
    });
  });

  r.get('/partials/active-timer', (req, res) =>
    res.render('partials/active-timer', activeCtx()));

  r.get('/partials/tracking-list', (req, res) => {
    const groups = groupByDay(db, listSessions(db, filterFrom(req.query)), Date.now(), rounding());
    res.render('partials/tracking-list', { groups, fmtDuration, fmtMoney });
  });

  function afterMutation(res) {
    hub.broadcast('changed');
    res.render('partials/active-timer', activeCtx());
  }

  r.post('/timer/start', (req, res) => { startTimer(db, Date.now()); afterMutation(res); });
  r.post('/timer/pause', (req, res) => { pauseTimer(db, Date.now()); afterMutation(res); });
  r.post('/timer/resume', (req, res) => { resumeTimer(db, Date.now()); afterMutation(res); });
  r.post('/timer/stop', (req, res) => { stopTimer(db, Date.now()); afterMutation(res); });
  r.post('/timer/start-from/:id', (req, res) => { startTimerFrom(db, Date.now(), Number(req.params.id)); afterMutation(res); });

  // Autosave the running editor. When the description changes to a known one,
  // fill still-empty details/task/tags from the most recent matching session
  // (autocomplete), without clobbering values the user already set.
  r.post('/timer/update', (req, res) => {
    const active = getActiveSession(db);
    if (active) {
      const description = req.body.description ?? '';
      let details = req.body.details ?? '';
      let taskId = req.body.taskId ? Number(req.body.taskId) : null;
      let tagIds = (Array.isArray(req.body.tagId) ? req.body.tagId : req.body.tagId ? [req.body.tagId] : []).map(Number).filter(Boolean);
      if (description && description !== active.description) {
        const tpl = latestByDescription(db, description);
        if (tpl) {
          if (!details) details = tpl.details;
          if (taskId == null) taskId = tpl.task_id;
          if (!tagIds.length) tagIds = tpl.tags.map(t => t.id);
        }
      }
      // Assigning a task adds its default tags (without clobbering current ones).
      if (taskId != null && taskId !== active.task_id) {
        tagIds = [...new Set([...tagIds, ...taskTagIds(db, taskId)])];
      }
      updateSession(db, active.id, { description, details, taskId });
      setSessionTags(db, active.id, tagIds);
    }
    afterMutation(res);
  });

  return r;
}
