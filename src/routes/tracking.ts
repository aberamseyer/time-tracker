import express, { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { startTimer, startTimerFrom, pauseTimer, stopTimer, resumeTimer, timerState, getActiveSession, splitExpiredDays, civilDayStart } from '../timer.js';
import { listSessions, decorateSession, updateSession, setSessionTags, distinctDescriptions, latestByDescription } from '../sessions.js';
import { listTasks, listTags, taskTagIds, listActiveTasksByClient } from '../catalog.js';
import { getSettings } from '../settings.js';
import { dayStartUTC, periodOf } from '../analytics.js';
import type { Hub, HydratedSession, SessionFilter, SessionGroup } from '../types.js';

function ensureUserId(req: Request): number {
  return (req.session && req.session.userId) ? req.session.userId : 0;
}

// Periods loaded per infinite-scroll page.
const PAGE = 1;

export function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

export function fmtMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function escapeHtml(str: unknown): string {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

// Bucket start and header label for a session under the chosen grouping.
function bucketOf(unit: string, ms: number, weekStart: number): { start: number; label: string } {
  if (unit === 'day') { const start = dayStartUTC(ms); return { start, label: dayLabel(start) }; }
  const p = periodOf(unit, ms, weekStart);
  return { start: p.start, label: unit === 'week' ? `Week of ${p.label}` : p.label };
}

export function groupSessions(
  db: Database.Database,
  sessions: HydratedSession[],
  now: number,
  rounding: number,
  unit = 'day',
  weekStart = 1,
  userId = 0,
): SessionGroup[] {
  const groups: Map<number, SessionGroup> = new Map();
  for (const s of sessions) {
    const d = decorateSession(db, s, now, rounding, userId);
    const anchor = s.start_utc ?? s.created_at;
    const b = bucketOf(unit, anchor, weekStart);
    if (!groups.has(b.start)) {
      groups.set(b.start, { key: String(b.start), anchor: b.start, label: b.label, sessions: [], totalMs: 0, totalCents: 0 });
    }
    const g = groups.get(b.start)!;
    g.sessions.push(d);
    g.totalMs += d.roundedMs;
    g.totalCents += d.earningsCents;
  }
  return [...groups.values()].sort((a, b) => b.anchor - a.anchor);
}

export function trackingRouter(db: Database.Database, hub: Hub): Router {
  const r = express.Router();
  const rounding = (userId = 0) => getSettings(db, userId).rounding_minutes;
  const grouping = (userId = 0) => { const s = getSettings(db, userId); return { unit: s.session_grouping || 'day', weekStart: s.week_start ?? 1 }; };

  // All completed sessions for the query, grouped by the chosen period.
  function allGroups(q: Record<string, unknown>, userId: number) {
    const g = grouping(userId);
    return groupSessions(db, listSessions(db, filterFrom(q), userId), Date.now(), rounding(userId), g.unit, g.weekStart, userId);
  }
  function pageCtx(q: Record<string, unknown>, userId: number) {
    const groups = allGroups(q, userId);
    const offset = Math.max(0, Number(q.offset) || 0);
    return {
      groups: groups.slice(offset, offset + PAGE),
      hasMore: groups.length > offset + PAGE,
      nextOffset: offset + PAGE,
      showEmpty: offset === 0,
      fmtDuration, fmtMoney,
    };
  }

  function activeCtx(req: Request) {
    const userId = ensureUserId(req);
    return { state: timerState(db, Date.now(), userId), taskGroups: listActiveTasksByClient(db, userId), tags: listTags(db, userId), fmtDuration };
  }

  function idsFrom(v: unknown): number[] {
    return (Array.isArray(v) ? v : v != null && v !== '' ? [v] : []).map(Number).filter(n => !Number.isNaN(n));
  }
  function filterFrom(q: Record<string, unknown>): SessionFilter {
    return {
      completedOnly: true,
      q: (q.q as string) || undefined,
      taskIds: idsFrom(q.taskId),
      tagIds: idsFrom(q.tagId),
      invertTask: q.invertTask ? true : undefined,
      invertTag: q.invertTag ? true : undefined,
    };
  }
  function filterCtx(req: Request) {
    const userId = ensureUserId(req);
    return {
      tasks: listTasks(db, userId), tags: listTags(db, userId), q: req.query,
      selTasks: idsFrom(req.query.taskId), selTags: idsFrom(req.query.tagId),
    };
  }

  r.get('/', (req: Request, res: Response) => {
    res.render('tracking', {
      title: 'Time tracking', nav: 'tracking',
      ...activeCtx(req), ...filterCtx(req), ...pageCtx(req.query, ensureUserId(req)), fmtMoney, descriptions: distinctDescriptions(db, '', 50, ensureUserId(req)),
    });
  });

  r.get('/partials/active-timer', (req: Request, res: Response) =>
    res.render('partials/active-timer', activeCtx(req)));

  r.get('/partials/tracking-list', (req: Request, res: Response) =>
    res.render('partials/tracking-list', pageCtx(req.query, ensureUserId(req))));

  function afterMutation(req: Request, res: Response) {
    hub.broadcast('changed');
    res.render('partials/active-timer', activeCtx(req));
  }

  const tzOf = (req: Request) => {
    const raw = (req.body as Record<string, unknown>).tz;
    return raw == null || raw === '' ? new Date().getTimezoneOffset() : Number(raw) || 0;
  };

  r.post('/timer/start', (req: Request, res: Response) => { startTimer(db, Date.now(), { tzMin: tzOf(req), userId: ensureUserId(req) }); afterMutation(req, res); });
  r.post('/timer/pause', (req: Request, res: Response) => { pauseTimer(db, Date.now(), ensureUserId(req)); afterMutation(req, res); });
  r.post('/timer/resume', (req: Request, res: Response) => { resumeTimer(db, Date.now(), ensureUserId(req)); afterMutation(req, res); });
  r.post('/timer/stop', (req: Request, res: Response) => { stopTimer(db, Date.now(), tzOf(req), ensureUserId(req)); afterMutation(req, res); });
  r.post('/timer/start-from/:id', (req: Request, res: Response) => { startTimerFrom(db, Date.now(), Number(req.params.id), tzOf(req), ensureUserId(req)); afterMutation(req, res); });

  // Autosave the running editor. When the description changes to a known one,
  // fill still-empty details/task/tags from the most recent matching session
  // (autocomplete), without clobbering values the user already set.
  r.post('/timer/update', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    const active = getActiveSession(db, userId);
    if (active) {
      const body = req.body as Record<string, unknown>;
      const description = (body.description as string) ?? '';
      let details = (body.details as string) ?? '';
      let taskId = body.taskId ? Number(body.taskId) : null;
      let tagIds = (Array.isArray(body.tagId) ? body.tagId : body.tagId ? [body.tagId] : []).map(Number).filter(Boolean);
      if (description && description !== active.description) {
        const tpl = latestByDescription(db, description, userId);
        if (tpl) {
          if (!details) details = tpl.details;
          if (taskId == null) taskId = tpl.task_id;
          if (!tagIds.length) tagIds = tpl.tags.map(t => t.id);
        }
      }
      // Assigning a task adds its default tags (without clobbering current ones).
      if (taskId != null && taskId !== active.task_id) {
        tagIds = [...new Set([...tagIds, ...taskTagIds(db, taskId, userId)])];
      }
      updateSession(db, active.id, { description, details, taskId }, userId);
      setSessionTags(db, active.id, tagIds, userId);
    }
    afterMutation(req, res);
  });

  // Editable start; no broadcast/swap — the client updates the clock in place.
  // Clamp to the local calendar day and non-negative elapsed.
  r.post('/timer/start-time', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    const active = getActiveSession(db, userId);
    const body = req.body as Record<string, unknown>;
    const start = Number(body.start), tzMin = tzOf(req);
    if (active && Number.isFinite(start)) {
      const off = tzMin * 60000, now = Date.now();
      const lo = civilDayStart(now - off) + off;                        // local midnight today (real)
      const hi = (active.pause_started_at ?? now) - (active.paused_ms || 0);
      updateSession(db, active.id, { startUtc: Math.min(hi, Math.max(lo, start)) }, userId);
    }
    res.status(204).end();
  });

  r.post('/timer/split', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    if (splitExpiredDays(db, Date.now(), tzOf(req), userId)) hub.broadcast('changed');
    res.status(204).end();
  });

  return r;
}
