# Time Tracker — Design Spec

Date: 2026-09-15
Status: Approved

A self-hosted, single-user time-tracking web app modeled on WorkingHours.
Log in from anywhere; timer state syncs live across tabs/devices via WebSockets.

## Goals

- Start tracking time in one click, no labeling required up front.
- Live-synced timer state across every logged-in session.
- Minimal JavaScript: server-rendered HTML, htmx for interactions, Alpine only
  where a client-side tick or toggle is unavoidable.
- All data server-side in SQLite. No cloud sync, no native features.

## Non-Goals (v1)

Deferred to future work (see end): CSV export, invoice/print-to-PDF, analytics
charts, rounding, tag time/earning adjustments, focus/pomodoro, calendar sync,
menu-bar/GPS/NFC/idle native features.

## Stack

- Node.js + Express.
- `better-sqlite3` — synchronous, single file, fast.
- `ws` — WebSocket realtime broadcast.
- `express-session` with a SQLite-backed store; `bcrypt` for password hashing.
- EJS server templates.
- htmx for interactions; Alpine.js only for the running-clock tick and
  collapse/expand toggles.
- Static assets (htmx, Alpine, CSS) served from `public/`.

## Auth

- Single user. One `user` row: `username`, `password_hash` (bcrypt).
- No signup UI. Seed the user via a one-off script reading env vars.
- Cookie session via `express-session`, persisted in SQLite so restarts keep
  logins. All app routes gated behind auth; unauthenticated → login page.

## Data Model

Times stored as UTC. Display timezone from `settings`.

- `user` — single row: `id`, `username`, `password_hash`.
- `client` — `id`, `name`, `address`, `default_rate_cents` (nullable),
  `currency`, `archived`.
- `task` — `id`, `name`, `color`, `hourly_rate_cents` (nullable → inherits
  client default), `client_id` (nullable), `archived`.
- `tag` — `id`, `name`, `color`, `archived`. v1: label only.
- `session` — the "work unit": `id`, `description`, `details`, `task_id`
  (nullable), `created_at`.
- `segment` — `id`, `session_id`, `start_utc`, `end_utc` (nullable).
- `session_tag` — `(session_id, tag_id)` many-to-many.
- `settings` — single row: business "FROM" block, `currency`, `week_start`,
  `timezone`.

### Derived values

- Session duration = Σ(segment durations); an open segment counts to *now*.
- Session earnings = duration × effective task rate
  (`task.hourly_rate_cents` else `client.default_rate_cents` else 0).
- Session "in progress" iff it has an open segment (`end_utc IS NULL`).

## Timer State Machine

Invariant: at most one open segment exists across the whole DB (one timer at a
time).

- **Start** → create a `session` + one open `segment`. If a segment is already
  open, close it first.
- **Pause** → set `end_utc` on the open segment. A gap begins.
- **Resume** → add a new open `segment` to the *same* session.
- **Stop** → close the open segment. Session now has no open segment.

Manual entry: create a session with one or more closed segments directly,
bypassing the live timer.

## Realtime Sync

- `ws.js` maintains a broadcast hub of connected clients.
- Any timer transition or session edit broadcasts a lightweight "changed"
  event (with a hint of what changed) to all connected tabs.
- Each tab responds by triggering an htmx refresh of the active-timer bar and
  the affected list fragment.
- Between events, Alpine increments the visible running clock locally each
  second (no server round-trip per tick).
- WS auto-reconnects with backoff; on reconnect the client refetches state.

## Views (v1)

### Time tracking

- Sessions grouped collapsibly. Default grouping: day. Selector for
  week/month/quarter/year.
- Per-group header: total duration + total earnings.
- Colored segment bars laid along the day timeline, colored by task.
- Timer controls: Start / Pause / Stop; active-timer bar at top.
- "Add work unit" for manual entry.

### Tasks / sessions

- Flat list of sessions with inline edit: description, task, tags, start/end
  times.
- Filters: **unlabelled** (no description), **uncategorized** (no task),
  plus keyword / task / tag search.

## Module Boundaries

- `db.js` — schema + migrations, connection.
- `auth.js` — login, session middleware, password check, user seed.
- `timer.js` — timer state machine, single-open-segment invariant.
- `sessions.js` — session/segment CRUD, duration/earnings calculation.
- `ws.js` — broadcast hub.
- `routes/*` — Express routers: auth, tracking, tasks, sessions, tags, clients,
  settings.
- `views/*` — EJS templates and htmx fragments.
- `public/*` — htmx, Alpine, CSS.
- `test/*` — tests.

## Error Handling

- Server validates all mutations; invalid input returns an htmx-friendly
  fragment with an inline error message.
- Timer transitions that violate the invariant self-correct (close the stray
  open segment) rather than erroring.
- WS failures degrade gracefully: the app still works per-request; realtime
  resumes on reconnect.

## Testing

- `node:test` + `supertest`, each test against a temp SQLite file.
- Unit: timer state machine (all transitions, single-open invariant),
  duration/earnings math (open segments, multi-segment sessions, rate
  inheritance).
- Routes: auth-gating, session/task/tag CRUD.

## Future Work

- Export sessions to CSV (filtered).
- Invoice: styled HTML page with client + line items + VAT + subtotal;
  print-to-PDF in browser.
- Analytics: line/bar charts by task/tag, working time vs earnings, date range.
- Rounding: global and per-item (e.g. next 15 min).
- Tag adjustments: tags that modify time or earnings; standard hours/overtime.
- Focus / pomodoro sessions.
- Calendar import.
