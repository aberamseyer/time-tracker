# Time Tracker v2 — Design Spec

Date: 2026-09-15
Status: Approved
Supersedes parts of: 2026-09-15-time-tracker-design.md

Changes on top of the shipped v1. v1 remains the base; this spec records the
deltas. No real user data exists yet, so the schema change is destructive.

## 1. Config via `.env`

- Add `dotenv`; load once at process start (before reading any `process.env`).
- All runtime config comes from env, documented in a committed `.env.sample`:
  - `PORT` — HTTP port (default 3000)
  - `DB_PATH` — SQLite file path (default `data.sqlite`)
  - `SESSION_SECRET` — session signing secret (required in production)
  - `COOKIE_SECURE` — `1` to set the secure cookie flag (behind TLS)
  - `NODE_ENV` — `production` enables the secret guard + secure default
  - `TT_USERNAME`, `TT_PASSWORD` — used only by `npm run seed`
- `.env` stays gitignored; `.env.sample` is committed with safe placeholder
  values and comments.

## 2. Data model — drop segments (destructive)

The multi-segment model is removed. A session is self-contained.

- Drop the `segment` table and its `one_open_segment` index.
- `session` columns: `id`, `description`, `details`, `task_id`, `created_at`,
  and new: `start_utc INTEGER`, `end_utc INTEGER` (null while active),
  `paused_ms INTEGER NOT NULL DEFAULT 0`, `pause_started_at INTEGER` (null
  unless currently paused).
- `session_tag` unchanged.
- New invariant: **at most one active session** — partial unique index on
  `session((1)) WHERE end_utc IS NULL`.

### States

- **running:** `end_utc IS NULL AND pause_started_at IS NULL`
- **paused:** `end_utc IS NULL AND pause_started_at IS NOT NULL`
- **stopped:** `end_utc IS NOT NULL`

### Duration

`duration = (end_utc ?? now) − start_utc − paused_ms − (paused ? now − pause_started_at : 0)`

Actual duration differs from `end − start` only when pause was used.

### Timer state machine (rewrite)

- **start(now, {taskId?, description?})** — stop any active session first, then
  insert `start_utc=now`, `end_utc=null`, `paused_ms=0`, `pause_started_at=null`.
- **pause(now)** — if running, set `pause_started_at=now`.
- **resume(now)** — if paused, `paused_ms += now − pause_started_at`, clear
  `pause_started_at`.
- **stop(now)** — if active: fold any open pause into `paused_ms`, clear
  `pause_started_at`, set `end_utc=now`.
- **timerState(now)** — `{ state: running|paused|stopped(none), session, since }`.

Manual create / edit set `start_utc`, `end_utc`, `paused_ms=0`,
`pause_started_at=null`; duration = end − start.

### Day view

One colored bar per session (task color) spanning start→end; day totals sum
rounded durations + earnings as before.

## 3. Rounding — round up (ceil)

Replace nearest-rounding with ceil to the next increment.

- `roundUpDurationMs(ms, minutes)` = `minutes ? Math.ceil(ms / (minutes*60000)) * (minutes*60000) : ms`.
- 0 → 0; 1 min → 15; 15 min → 15; 16 min → 30 (at 15).
- Applied to displayed duration and earnings for stopped sessions; running
  sessions display raw (unrounded).
- Settings label copy updated: "Round up to next …".

## 4. Editable while running + autocomplete

- The active-timer bar in the **Time** view supports inline editing of the
  running session's **description, task, and tags** (previously only via the
  Tasks page). Editing broadcasts the change like any mutation.
- **Autocomplete:** the **description** field autocompletes from distinct prior
  session descriptions. Selecting a suggestion prefills **details, task, and
  tags** from the most recent session with that description.
  - `GET /sessions/suggest?q=` → list of matching distinct descriptions
    (htmx active-search).
  - `GET /sessions/template?description=` → the details/task/tags of the most
    recent session with that exact description, as a fragment that fills the
    form fields.
  - Used on manual-add and the running/edit forms.

## 5. UI overhaul

Constraint: do NOT use the frontend-design skill. Hand-author CSS/markup.

- **Mobile (default):** fixed **bottom action bar** holding the primary timer
  control (Start, or Pause + Stop when active) within thumb reach, plus a
  bottom tab bar (Time / Tasks / Settings).
- **Wide screens (≥768px):** nav moves to a side rail; the timer control moves
  to the top of the content; nothing bottom-fixed.
- **Tags as chips:** rounded pills tinted with the tag color, everywhere they
  appear. In edit, a chip multi-select where each chip is a `<label>` wrapping
  a hidden checkbox (filled = selected, outline = not) — the whole chip toggles.
- **Inputs tied to labels:** every radio/checkbox row wrapped in a `<label>`
  (entire row clickable). Rounding options become a segmented control; list
  filters become toggle chips.
- **Tasks** shown with their color dot in the picker.
- **Dark mode:** CSS custom properties with a `@media (prefers-color-scheme:
  dark)` block. No manual toggle. Tag/task colors keep sufficient contrast in
  both themes.
- Tap targets ≥44px; card styling and spacing closer to WorkingHours.

## 6. Verification

Drive the running app with the chrome-devtools MCP:

- Login; start → pause → resume → stop; confirm duration reflects pause.
- Edit the running session's task/description/tags from the Time view.
- Autocomplete a description and confirm details/task/tags prefill.
- Add a manual entry; verify ceil rounding in totals.
- Tag chips render with color; chip multi-select toggles.
- Mobile viewport: primary control reachable at the bottom; emulate
  `prefers-color-scheme: dark` and confirm dark theme.
- Screenshot mobile + desktop in light + dark.

## 7. Testing

Update/extend the suite for the new model:

- Timer: start/pause/resume/stop transitions; duration with and without pause;
  single-active invariant.
- Calc: `roundUpDurationMs` (0, 1, 15, 16 at 15/30/60; off).
- Sessions/routes: manual create + edit set correct columns; running-edit
  route; autocomplete suggest + template endpoints.
- Remove segment-based tests; adapt decorate/day-grouping tests to one bar per
  session.

## Out of scope (unchanged from v1 future work)

CSV export, invoice/print-to-PDF, analytics charts, per-item rounding, tag
time/earning adjustments, pomodoro, calendar. Manual dark-mode toggle.
