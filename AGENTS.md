# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm test` — run the full suite (`node --test`, all `test/*.test.js`).
- `node --test test/timer.test.js` — run one file.
- `node --test --test-name-pattern="pause then resume"` — run tests matching a name.
- `npm start` — run the server (`src/server.js`), default port 3000.
- `npm run seed` — create/update the single login user; requires `TT_USERNAME` and `TT_PASSWORD` env vars.

Env: `DB_PATH` (default `data.sqlite`), `PORT`, `SESSION_SECRET` (required when `NODE_ENV=production`), `TT_USERNAME`/`TT_PASSWORD` (seed only). Loaded via `dotenv` from `.env`.

## Architecture

Single-user time tracker. Express + EJS server-rendered HTML, htmx for partial updates, Alpine for the running clock, WebSocket for live cross-tab sync. SQLite via `better-sqlite3` (synchronous). ES modules throughout (`"type": "module"`).

**Two-layer structure.** Pure data modules take `db` as their first argument and hold all SQL and business logic: `sessions.js`, `catalog.js` (tasks/tags/clients), `timer.js`, `analytics.js`, `settings.js`, `calc.js`, `csv.js`. Thin routers in `src/routes/*` parse requests, call those modules, and render EJS. Keep SQL and logic in the data modules, not in routers — this is why every function threads `db` explicitly and tests exercise the modules directly against an in-memory DB.

**Request wiring.** `src/app.js` `createApp({ db, hub })` mounts routers behind `requireAuth`; `src/server.js` owns the HTTP server, opens the DB, creates the WS hub, and authenticates WS upgrades with the same session middleware. `createApp` is DB/hub-injected so tests build an app over `:memory:` (see `test/helpers.js`).

**Live sync.** Any mutation calls `hub.broadcast('changed')` (`src/ws.js`). The browser (`public/app.js`) receives it and dispatches a `tt:changed` DOM event; htmx elements listen for it (e.g. the Time-page filter form `hx-trigger="... tt:changed from:body"`) and refetch their partial. To make a change reflect live, broadcast after it and ensure a partial listens for `tt:changed`.

**htmx conventions.** Routes return either full pages (`res.render('tracking', ...)`) or fragments (`res.render('partials/...')`). Full pages wrap content by `include('layout', { title, nav, body })`. Errors: the global handler in `app.js` renders `partials/error` for `HX-Request` requests. New interactive UI = a partial route plus an htmx trigger.

**Sessions / timer model.** A "session" (work unit) is the core row. The active timer is the single session with `end_utc IS NULL`, enforced by a partial unique index (`one_active_session`). `timer.js` starts/pauses/resumes/stops by mutating that row; pausing accumulates into `paused_ms`. `calc.js` derives duration (minus pauses), rounding, and earnings; `sessions.decorateSession` attaches `active/paused/durationMs/roundedMs/earningsCents` for views. Rates resolve task → client default (`catalog.effectiveRateCents`).

**Analytics vs. Time-page grouping.** `analytics.js` provides period math (`periodOf`, `listPeriods`, week/month/quarter) reused by both the Analytics page and the Time page's session grouping (`routes/tracking.js` `groupSessions`). The Time page paginates one grouping period per htmx `revealed` load; `week_start` and `session_grouping` come from the `settings` row.

**Schema & migrations.** `src/db.js` holds the schema and runs on every `openDb()`. Additive migrations only: add the column to the `CREATE TABLE` for fresh DBs *and* an idempotent `addColumn()` call in `migrate()` for existing DBs. There is one `settings` row (`id = 1`); `updateSettings` patches only provided fields.

## Deploy

CI (`.github/workflows/deploy.yml`) tests in the cloud, then a self-hosted runner rsyncs to a VPS and restarts a systemd unit. Native deps (`better-sqlite3`) are rebuilt against an LTS node pinned by `.nvmrc`; node >=24 required. Full setup in `deploy/README.md`. Never add `pull_request`/`pull_request_target` triggers to the self-hosted deploy job.
