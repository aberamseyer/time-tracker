# Time Tracker v3 — Design

Six features layered onto the existing Express + EJS + htmx + Alpine + SQLite app.
Server-rendered, zero build step. No new runtime dependencies.

## 1. Desktop layout fix

`main` caps at 760px, so on desktop the content sits in a narrow mobile column
beside the 220px rail. Raise the cap and let analytics use full width.

- `main`: max-width 1100px on wide screens, still centered with padding.
- Analytics page opts into full width (`main.wide`).

## 2. Mobile floating transport

Start / Pause / Resume / Stop must be thumb-reachable. Keep one DOM source
(the `active-timer` partial); reposition via CSS on mobile only.

- `<768px`: `.timer-controls` and the idle start form fix to bottom-right,
  above the tabbar (`bottom: calc(64px + safe-area)`), large tap targets, shadow.
- `>=768px`: unchanged inline controls.

## 3. Task/tag management

Full management on Settings; quick-add stays on Time and Tasks views.

- Settings gains Tasks and Tags sections: list existing, create, edit
  (name/color/rate for tasks, name/color for tags), archive.
- New routes under `/settings`: create/update/archive for task and tag,
  returning re-rendered management partials.
- Quick-add: keep the collapsible new-task/new-tag pickers on Tasks; add the
  same pickers to the Time view. Both post to existing `/tasks`, `/tags` and
  refresh via broadcast.

## 4. Resume from previous session

Play button on Time-view rows starts a new timer copying description, details,
task and tags from that session.

- `startTimerFrom(db, now, sourceId)` in timer.js: stop active, create new
  running session copying fields, copy tags.
- Route `POST /timer/start-from/:id` → renders `active-timer` partial,
  broadcasts. Row play button targets `#active-timer`.

## 5. Analytics page

New nav item and `/analytics` route. Hand-rolled SVG charts, no dependency.

- Controls: chart Bars/Lines, metric Working-time/Earnings, group by Tasks/Tags,
  14-day window with prev/next.
- `src/analytics.js`: `buildReport(db, {from,to,by,metric,rounding})` returns
  day buckets, per-series totals+per-day values, grand total. Series = task
  (or "No task") / tag (or "Untagged"); a session counts under each of its tags.
  Only completed sessions.
- `analytics-chart` partial renders stacked bars or lines + legend with totals.
  htmx GET `/partials/analytics-chart` on control change and `tt:changed`.

## 6. CSV export

On the Analytics page, sharing its date range and an optional task/tag filter.

- `GET /export.csv?from&to&taskId&tagId` streams `text/csv` with
  Content-Disposition attachment. Native GET form → browser download.
- Columns: Date, Start, End, Description, Details, Task, Tags,
  Duration (min), Earnings. RFC-4180 quoting. Completed sessions only.

## Testing

Add node:test coverage: `analytics.buildReport` aggregation, `startTimerFrom`
copy semantics, CSV route rows/quoting, settings task/tag CRUD routes.
Run with sandbox disabled (supertest binds a port).
