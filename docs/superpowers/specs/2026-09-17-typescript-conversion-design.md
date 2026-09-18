# TypeScript Conversion — Design

Date: 2026-09-17

## Goal

Convert the time tracker from JavaScript to TypeScript for type safety before
the codebase grows further. Behavior stays identical; tests stay green throughout.

## Decisions

- **Run strategy:** `tsc` compiles to `dist/`. No native type stripping.
- **Strictness:** `strict: true`. `noUncheckedIndexedAccess` omitted (too much
  friction with SQL row access for now).
- **Scope:** everything — `src/`, `src/routes/`, `scripts/`, `test/`. Typecheck
  enforced in CI via the build.

## Compilation model

`tsconfig.json`:
- `strict: true`
- `module: NodeNext`, `moduleResolution: NodeNext`
- `target: ES2022`
- `rootDir: "."`, `outDir: "dist"`
- `include: ["src/**/*", "test/**/*", "scripts/**/*"]`

Output mirrors the tree: `dist/src/`, `dist/test/`, `dist/scripts/`.

Source imports keep `.js` extensions (TS convention: `./db.js` resolves to
`db.ts`, emits `./db.js`). Native type stripping was ruled out because Node does
not resolve `.js` specifiers to sibling `.ts` files (verified empirically).

The build is the typecheck — no separate `--noEmit` step. Type errors fail CI.

## Self-contained dist/

`tsc` emits only `.js`. EJS views and `public/` assets are copied in by a build
step: `node scripts/copy-assets.js` copies `src/views` → `dist/src/views` and
`public` → `dist/public`. `copy-assets.js` stays a plain `.js` build helper
(excluded from the TS build) to avoid a chicken-and-egg with the compile step.

Path resolution needs no code change: `app.ts` at `dist/src/app.js` resolves
views at `./views` and static assets at `../public` → `dist/public`.

## npm scripts

- `build`: `tsc && node scripts/copy-assets.js`
- `start`: `node dist/src/server.js`
- `test`: `npm run build && node --test` (runs `dist/test/*.test.js`)
- `seed`: `node dist/scripts/seed-user.js`
- `seed:sample`: `node dist/scripts/seed-sample.js`

## Types

`src/types.ts` — domain types:
- Table rows: `UserRow`, `ClientRow`, `TaskRow`, `TagRow`, `SessionRow`,
  `SettingsRow`, join rows as needed.
- `DecoratedSession` (adds `active/paused/running/durationMs/roundedMs/earningsCents`).
- `SessionFilter` (the `listSessions` filter shape).
- `Hub` interface (`broadcast`, `handleConnection`) so the `test/helpers` stub
  typechecks.

`src/express.d.ts` — module augmentation:
- `req.session.userId`
- `app.locals.db`, `app.locals.hub`

Data modules type `db: Database.Database` (from `better-sqlite3`) as the first
argument. `db.prepare(...).get()/all()` results are cast to row types.

devDeps to add (verify built-in types before adding a `@types` package):
`typescript`, `@types/node`, `@types/express`, `@types/express-session`,
`@types/ws`, `@types/bcryptjs`, `@types/ejs`, `@types/supertest`.
`better-sqlite3` ships its own types.

## Deploy changes

- VPS runs `npm ci --omit=dev`, so `tsc` is absent there. Build on the
  self-hosted runner before rsync: add `npm ci && npm run build` to the deploy
  job; rsync then includes `dist/`.
- `deploy/time-tracker.service` `ExecStart` → `node dist/src/server.js`.
- Cloud `test` job already runs `npm test`, which now builds first — typecheck
  enforced automatically.
- `.gitignore` adds `dist/`.

## Conversion order

Bottom-up, running `tsc` continuously; tests are the safety net:

1. Tooling: `tsconfig.json`, devDeps, `types.ts`, `express.d.ts`,
   `scripts/copy-assets.js` (plain JS, excluded from tsc).
2. Leaf data modules: `calc`, `colors`, `csv`, `db`, `settings`, `catalog`,
   `sessions`, `timer`, `analytics`, `auth`, `ws`.
3. Routes: `routes/*`.
4. Wiring: `app`, `server`.
5. Scripts: `scripts/*`.
6. Tests: `test/*`.
7. Deploy: workflow, service unit, `.gitignore`, `AGENTS.md`.

## Non-goals

- No behavior changes, no refactoring beyond what typing requires.
- No runtime schema validation (types are compile-time only).
- EJS templates stay untyped `.ejs`.
