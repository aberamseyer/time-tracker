# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm test` — builds (`tsc` + copy assets), then runs the full suite (`node --test`) against `dist/test/**/*.test.js`.
- `npm run build` — compile `src/`/`test/`/`scripts/` (TypeScript) to `dist/` and copy `views`/`public`.
- `npm run typecheck` — `tsc --noEmit`, no build output.
- `node --test dist/test/timer.test.js` — run one compiled test file (run `npm run build` first).
- `node --test --test-name-pattern="pause then resume" "dist/test/**/*.test.js"` — run tests matching a name.
- `npm start` — run the server (`dist/src/server.js`), default port 3000.
- `npm run seed` — create/update the single login user (runs `dist/scripts/seed-user.js`; `npm run build` first); requires `TT_USERNAME` and `TT_PASSWORD` env vars.

Always pass an explicit `dist/test/...` path (or use `npm test`). Bare `node --test` auto-discovers the `.ts` sources, whose `.js` import specifiers Node cannot resolve without compiling — it errors with `ERR_MODULE_NOT_FOUND` and hangs.

Env: `DB_PATH` (default `data.sqlite`), `PORT`, `SESSION_SECRET` (required when `NODE_ENV=production`), `TT_USERNAME`/`TT_PASSWORD` (seed only). Loaded via `dotenv` from `.env`.

## Architecture

Single-user time tracker. Express + EJS server-rendered HTML, htmx for partial updates, vanilla JS for the running clock, WebSocket for live cross-tab sync. SQLite via `better-sqlite3` (synchronous). ES modules throughout (`"type": "module"`).

**TypeScript build.** Source is strict TypeScript (`src/`, `test/`, `scripts/`) compiled by `tsc` (NodeNext) to `dist/`; `views/` and `public/` are copied alongside so `dist/` is self-contained and runnable on its own. Import specifiers use the compiled `.js` extension (e.g. `import { openDb } from './db.js'`) even though the source files are `.ts` — NodeNext module resolution requires this. Never edit files under `dist/`; edit the `.ts` source and rebuild.

**TypeScript conventions.**

- Strict mode (`strict: true`). No implicit `any`; `noUncheckedIndexedAccess` is off.
- Edit `.ts` source and rebuild; never touch `dist/`.
- Imports use `.js` specifiers resolving to the `.ts` source (NodeNext). Keep this in new files.
- Domain and row types live in `src/types.ts`: one interface per table plus derived shapes (`HydratedSession`, `DecoratedSession`, `SessionFilter`, `ClientGroup`, `Report`, `Period`, `SessionGroup`, `Hub`). Nullable columns are `T | null`, integer flags are `number`.
- `better-sqlite3` returns `unknown`; cast at the call site: `.get() as SessionRow | undefined`, `.all() as TagRow[]`, `run().lastInsertRowid as number`. No runtime schema validation — types are compile-time only.
- Express augmentation (`req.session.userId`, `app.locals.db`/`hub`) lives in `src/express.d.ts`. An untyped dependency gets a local `.d.ts` shim (see `src/better-sqlite3-session-store.d.ts`).
- New data module: export functions taking `db: Database.Database` first; keep SQL inside; add any new row type to `types.ts`. New route: `xRouter(db, hub): Router`, handlers typed `(req: Request, res: Response)`.
- `scripts/copy-assets.js` stays plain JS — it is the build helper and is excluded from `tsc`.

**Two-layer structure.** Pure data modules take `db` as their first argument and hold all SQL and business logic: `sessions.js`, `catalog.js` (tasks/tags/clients), `timer.js`, `analytics.js`, `settings.js`, `calc.js`, `csv.js`. Thin routers in `src/routes/*` parse requests, call those modules, and render EJS. Keep SQL and logic in the data modules, not in routers — this is why every function threads `db` explicitly and tests exercise the modules directly against an in-memory DB.

**Request wiring.** `src/app.js` `createApp({ db, hub })` mounts routers behind `requireAuth`; `src/server.js` owns the HTTP server, opens the DB, creates the WS hub, and authenticates WS upgrades with the same session middleware. `createApp` is DB/hub-injected so tests build an app over `:memory:` (see `test/helpers.js`).

**Live sync.** Any mutation calls `hub.broadcast('changed')` (`src/ws.js`). The browser (`public/app.js`) receives it and dispatches a `tt:changed` DOM event; htmx elements listen for it (e.g. the Time-page filter form `hx-trigger="... tt:changed from:body"`) and refetch their partial. To make a change reflect live, broadcast after it and ensure a partial listens for `tt:changed`.

**htmx conventions.** Routes return either full pages (`res.render('tracking', ...)`) or fragments (`res.render('partials/...')`). Full pages wrap content by `include('layout', { title, nav, body })`. Errors: the global handler in `app.js` renders `partials/error` for `HX-Request` requests. New interactive UI = a partial route plus an htmx trigger.

**Sessions / timer model.** A "session" (work unit) is the core row. The active timer is the single session with `end_utc IS NULL`, enforced by a partial unique index (`one_active_session`). `timer.js` starts/pauses/resumes/stops by mutating that row; pausing accumulates into `paused_ms`. `calc.js` derives duration (minus pauses), rounding, and earnings; `sessions.decorateSession` attaches `active/paused/durationMs/roundedMs/earningsCents` for views. Rates resolve task → client default (`catalog.effectiveRateCents`).

**Analytics vs. Time-page grouping.** `analytics.js` provides period math (`periodOf`, `listPeriods`, week/month/quarter) reused by both the Analytics page and the Time page's session grouping (`routes/tracking.js` `groupSessions`). The Time page paginates one grouping period per htmx `revealed` load; `week_start` and `session_grouping` come from the `settings` row.

**Schema & migrations.** `src/db.js` holds the schema and runs on every `openDb()`. Additive migrations only: add the column to the `CREATE TABLE` for fresh DBs *and* an idempotent `addColumn()` call in `migrate()` for existing DBs. There is one `settings` row (`id = 1`); `updateSettings` patches only provided fields.

**Hygiene.** Update `types.ts` interfaces immediately when schema changes. Add `user_id` validation to linking tables (e.g., `task_tag`) to prevent cross-user associations. Verify conditional SQL array binding (`.get([...])`) after every `WHERE` change. When adding columns, add to `CREATE TABLE` and `migrate()` `addColumn()`.

## Deploy

CI (`.github/workflows/deploy.yml`) builds and tests in the cloud, uploads `dist/` as an artifact, then a self-hosted runner downloads it, rsyncs the tree to a VPS, and restarts a systemd unit running `dist/src/server.js`. Native deps (`better-sqlite3`) are rebuilt against an LTS node pinned by `.nvmrc`; node >=24 required. Full setup in `deploy/README.md`. Never add `pull_request`/`pull_request_target` triggers to the self-hosted deploy job.
