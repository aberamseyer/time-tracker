import express from 'express';
import { startTimer, pauseTimer, stopTimer, resumeTimer, timerState } from '../timer.js';
import { listSessions, decorateSession } from '../sessions.js';
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

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function groupByDay(db, sessions, now, rounding) {
  const groups = new Map();
  for (const s of sessions) {
    const d = decorateSession(db, s, now, rounding);
    const anchor = s.segments.length ? s.segments[0].start_utc : s.created_at;
    const key = dayKey(anchor);
    if (!groups.has(key)) {
      groups.set(key, { key, anchor, label: new Date(anchor).toDateString(), sessions: [], totalMs: 0, totalCents: 0 });
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

  function renderList(res, from) {
    const sessions = listSessions(db, { from });
    const groups = groupByDay(db, sessions, Date.now(), rounding());
    res.render('partials/tracking-list', { groups, fmtDuration, fmtMoney });
  }

  r.get('/', (req, res) => {
    const from = Date.now() - 14 * 24 * 3600 * 1000;
    const sessions = listSessions(db, { from });
    const groups = groupByDay(db, sessions, Date.now(), rounding());
    res.render('tracking', {
      title: 'Time tracking', nav: 'tracking',
      state: timerState(db, Date.now()), groups, fmtDuration, fmtMoney,
    });
  });

  r.get('/partials/active-timer', (req, res) =>
    res.render('partials/active-timer', { state: timerState(db, Date.now()), fmtDuration }));

  r.get('/partials/tracking-list', (req, res) =>
    renderList(res, Date.now() - 14 * 24 * 3600 * 1000));

  function afterMutation(res) {
    hub.broadcast('changed');
    res.render('partials/active-timer', { state: timerState(db, Date.now()), fmtDuration });
  }

  r.post('/timer/start', (req, res) => { startTimer(db, Date.now()); afterMutation(res); });
  r.post('/timer/pause', (req, res) => { pauseTimer(db, Date.now()); afterMutation(res); });
  r.post('/timer/stop', (req, res) => { stopTimer(db, Date.now()); afterMutation(res); });
  r.post('/timer/resume/:id', (req, res) => { resumeTimer(db, Date.now(), Number(req.params.id)); afterMutation(res); });

  return r;
}
