import express, { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { startTimer, startTimerFrom, pauseTimer, stopTimer, resumeTimer, timerState, getActiveSession } from '../timer.js';
import { listSessions, decorateSession, updateSession, setSessionTags, distinctDescriptions, latestByDescription } from '../sessions.js';
import { listTasks, listTags, taskTagIds, listActiveTasksByClient } from '../catalog.js';
import { getSettings } from '../settings.js';
import { dayStartUTC, periodOf } from '../analytics.js';
import type { Hub, HydratedSession, SessionFilter, SessionGroup } from '../types.js';

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
): SessionGroup[] {
  const groups: Map<number, SessionGroup> = new Map();
  for (const s of sessions) {
    const d = decorateSession(db, s, now, rounding);
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
  const rounding = () => getSettings(db).rounding_minutes;
  const grouping = () => { const s = getSettings(db); return { unit: s.session_grouping || 'day', weekStart: s.week_start ?? 1 }; };

  // All completed sessions for the query, grouped by the chosen period.
  function allGroups(q: Record<string, unknown>) {
    const g = grouping();
    return groupSessions(db, listSessions(db, filterFrom(q)), Date.now(), rounding(), g.unit, g.weekStart);
  }
  function pageCtx(q: Record<string, unknown>) {
    const groups = allGroups(q);
    const offset = Math.max(0, Number(q.offset) || 0);
    return {
      groups: groups.slice(offset, offset + PAGE),
      hasMore: groups.length > offset + PAGE,
      nextOffset: offset + PAGE,
      showEmpty: offset === 0,
      fmtDuration, fmtMoney,
    };
  }

  function activeCtx() {
    return { state: timerState(db, Date.now()), taskGroups: listActiveTasksByClient(db), tags: listTags(db), fmtDuration };
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
  function filterCtx(q: Record<string, unknown>) {
    return {
      tasks: listTasks(db), tags: listTags(db), q,
      selTasks: idsFrom(q.taskId), selTags: idsFrom(q.tagId),
    };
  }

  r.get('/', (req: Request, res: Response) => {
    res.render('tracking', {
      title: 'Time tracking', nav: 'tracking',
      ...activeCtx(), ...filterCtx(req.query), ...pageCtx(req.query), fmtMoney, descriptions: distinctDescriptions(db, '', 50),
    });
  });

  r.get('/partials/active-timer', (req: Request, res: Response) =>
    res.render('partials/active-timer', activeCtx()));

  r.get('/partials/tracking-list', (req: Request, res: Response) =>
    res.render('partials/tracking-list', pageCtx(req.query)));

  function afterMutation(res: Response) {
    hub.broadcast('changed');
    res.render('partials/active-timer', activeCtx());
  }

  r.post('/timer/start', (req: Request, res: Response) => { startTimer(db, Date.now()); afterMutation(res); });
  r.post('/timer/pause', (req: Request, res: Response) => { pauseTimer(db, Date.now()); afterMutation(res); });
  r.post('/timer/resume', (req: Request, res: Response) => { resumeTimer(db, Date.now()); afterMutation(res); });
  r.post('/timer/stop', (req: Request, res: Response) => { stopTimer(db, Date.now()); afterMutation(res); });
  r.post('/timer/start-from/:id', (req: Request, res: Response) => { startTimerFrom(db, Date.now(), Number(req.params.id)); afterMutation(res); });

  // Autosave the running editor. When the description changes to a known one,
  // fill still-empty details/task/tags from the most recent matching session
  // (autocomplete), without clobbering values the user already set.
  r.post('/timer/update', (req: Request, res: Response) => {
    const active = getActiveSession(db);
    if (active) {
      const body = req.body as Record<string, unknown>;
      const description = (body.description as string) ?? '';
      let details = (body.details as string) ?? '';
      let taskId = body.taskId ? Number(body.taskId) : null;
      let tagIds = (Array.isArray(body.tagId) ? body.tagId : body.tagId ? [body.tagId] : []).map(Number).filter(Boolean);
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
