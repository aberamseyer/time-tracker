# TypeScript Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the time tracker from JavaScript to TypeScript with `strict: true`, no behavior change, tests green throughout.

**Architecture:** `tsc` compiles the whole tree to `dist/`. A copy step makes `dist/` self-contained (EJS views + `public/`). During conversion `allowJs: true` lets a mixed `.js`/`.ts` tree still build and test at every step; the final task removes it. Deploy ships the CI-built `dist/` as an artifact.

**Tech Stack:** Node 24, TypeScript (NodeNext), Express, EJS, better-sqlite3, ws, express-session, node:test, supertest.

## Global Constraints

- Node `>=24`, npm `>=11` (unchanged `engines`).
- `strict: true`; `noUncheckedIndexedAccess` **off**.
- `module`/`moduleResolution`: `NodeNext`; `target`: `ES2022`.
- Source import specifiers keep `.js` extensions (TS resolves to sibling `.ts`).
- No behavior changes, no refactoring beyond what typing requires.
- EJS templates stay `.ejs` (untyped).
- `scripts/copy-assets.js` stays plain JS, excluded from the TS build.
- Never add `pull_request`/`pull_request_target` triggers to the self-hosted deploy job.
- Commit messages follow the repo convention: `<type>(<scope>): <subject>`, imperative, <=50 chars, no Claude co-author.

## Reference: SQL result typing pattern

better-sqlite3 typings return `unknown` from `.get()` and `unknown[]` from `.all()`. Cast at the call site:

```ts
const row = db.prepare('SELECT * FROM session WHERE id = ?').get(id) as SessionRow | undefined;
const rows = db.prepare('SELECT * FROM tag ...').all(id) as TagRow[];
const { lastInsertRowid } = db.prepare('INSERT ...').run(a, b);
return lastInsertRowid as number; // rowids fit in number (no safeIntegers)
```

Nullable-column arithmetic: `start_utc`/`end_utc` are `number | null` in the row type but never null for real sessions. Preserve JS coercion (`x - null === x`) with `?? 0` where the original relied on it (see Task 6 for `calc.ts`).

---

### Task 1: Toolchain, config, and shared types

**Files:**
- Create: `tsconfig.json`
- Create: `src/types.ts`
- Create: `src/express.d.ts`
- Create: `scripts/copy-assets.js` (plain JS)
- Modify: `package.json` (devDeps + scripts)
- Modify: `.gitignore` (add `dist/`)

**Interfaces:**
- Produces: all row/domain types and the `Hub` interface consumed by every later task; the `build`/`test`/`start`/`seed` scripts every later task's verification uses.

- [ ] **Step 1: Add dev dependencies**

```bash
npm install --save-dev typescript @types/node @types/express @types/express-session @types/ws @types/bcryptjs @types/ejs @types/supertest @types/better-sqlite3
```

Then verify which packages ship their own types and remove redundant `@types/*` if `npm ls` warns of duplicates. `better-sqlite3-session-store` has no types; it will be handled with a local `.d.ts` shim in Task 9 if needed — do not add a package for it here.

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "allowJs": true,
    "checkJs": false,
    "resolveJsonModule": true,
    "sourceMap": true,
    "declaration": false
  },
  "include": ["src/**/*", "test/**/*", "scripts/**/*"],
  "exclude": ["node_modules", "dist", "scripts/copy-assets.js"]
}
```

`allowJs: true` is temporary (removed in Task 12) so the mixed tree builds and tests at every step.

- [ ] **Step 3: Write `src/types.ts`**

```ts
import type { WebSocket } from 'ws';

export interface UserRow { id: number; username: string; password_hash: string; }

export interface ClientRow {
  id: number; name: string; address: string;
  default_rate_cents: number | null; currency: string; archived: number;
}

export interface TaskRow {
  id: number; name: string; details: string; color: string;
  hourly_rate_cents: number | null; client_id: number | null;
  is_default: number; archived: number;
}

export interface TagRow { id: number; name: string; color: string; archived: number; }

export interface SessionRow {
  id: number; description: string; details: string; task_id: number | null;
  created_at: number; start_utc: number | null; end_utc: number | null;
  paused_ms: number; pause_started_at: number | null;
}

export interface SettingsRow {
  id: number; business_from: string; currency: string; week_start: number;
  timezone: string; rounding_minutes: number; session_grouping: string;
}

export interface HydratedSession extends SessionRow { tags: TagRow[]; task: TaskRow | null; }

export interface DecoratedSession extends HydratedSession {
  active: boolean; paused: boolean; running: boolean;
  durationMs: number; roundedMs: number; earningsCents: number;
  client?: ClientRow | null;
}

export interface SessionFilter {
  completedOnly?: boolean; q?: string; taskId?: number;
  unlabelled?: boolean; uncategorized?: boolean;
  clientId?: number | null; tagId?: number;
  taskIds?: number[]; tagIds?: number[];
  invertTask?: boolean; invertTag?: boolean;
  from?: number; to?: number;
}

export interface Hub {
  clients: Set<WebSocket>;
  handleConnection(ws: WebSocket): void;
  broadcast(type?: string): void;
}
```

- [ ] **Step 4: Write `src/express.d.ts`**

```ts
import 'express-session';
import type Database from 'better-sqlite3';
import type { Hub } from './types.js';

declare module 'express-session' {
  interface SessionData { userId?: number; }
}

declare global {
  namespace Express {
    interface Locals { db: Database.Database; hub: Hub; }
  }
}

export {};
```

- [ ] **Step 5: Write `scripts/copy-assets.js` (plain JS)**

```js
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');

// Views EJS live beside the compiled app at dist/src/views.
rmSync(path.join(dist, 'src', 'views'), { recursive: true, force: true });
cpSync(path.join(root, 'src', 'views'), path.join(dist, 'src', 'views'), { recursive: true });

// app.ts resolves static at ../public -> dist/public.
rmSync(path.join(dist, 'public'), { recursive: true, force: true });
cpSync(path.join(root, 'public'), path.join(dist, 'public'), { recursive: true });

console.log('assets copied to dist');
```

- [ ] **Step 6: Update `package.json` scripts**

```json
  "scripts": {
    "build": "tsc && node scripts/copy-assets.js",
    "start": "node dist/src/server.js",
    "test": "npm run build && node --test dist/test",
    "typecheck": "tsc --noEmit",
    "seed": "npm run build && node dist/scripts/seed-user.js",
    "seed:sample": "npm run build && node dist/scripts/seed-sample.js"
  }
```

- [ ] **Step 7: Add `dist/` to `.gitignore`**

Append `dist/` (create `.gitignore` if absent).

- [ ] **Step 8: Verify build + tests still pass (all source still `.js`)**

Run: `npm test`
Expected: build succeeds, `dist/` populated, all existing tests PASS.

- [ ] **Step 9: Commit**

```bash
git add tsconfig.json src/types.ts src/express.d.ts scripts/copy-assets.js package.json package-lock.json .gitignore
git commit -m "chore(ts): add typescript toolchain and shared types"
```

---

### Task 2: Convert leaf pure modules — `calc`, `colors`, `csv`

**Files:**
- Rename+edit: `src/calc.js` → `src/calc.ts`
- Rename+edit: `src/colors.js` → `src/colors.ts`
- Rename+edit: `src/csv.js` → `src/csv.ts`

**Interfaces:**
- Consumes: `SessionRow`, `DecoratedSession` from `./types.js`; `Database.Database`.
- Produces:
  - `roundUpDurationMs(ms: number, minutes: number): number`
  - `sessionDurationMs(s: Pick<SessionRow,'start_utc'|'end_utc'|'paused_ms'|'pause_started_at'>, now: number): number`
  - `earningsCents(durationMs: number, rateCents: number): number`
  - `TASK_COLORS: string[]`, `TAG_COLORS: string[]`
  - `suggestColor(db: Database.Database, kind: 'task' | 'tag'): string`
  - `sessionsToCsv(rows: DecoratedSession[]): string`

- [ ] **Step 1: Convert `calc.ts`**

`git mv src/calc.js src/calc.ts`. Add types per the Produces block. In `sessionDurationMs`, preserve null coercion: `const end = s.end_utc == null ? now : s.end_utc;` then `const start = s.start_utc ?? 0;` and use `start` in the subtraction. Keep `(s.paused_ms || 0)`.

- [ ] **Step 2: Convert `colors.ts`**

`git mv src/colors.js src/colors.ts`. Type `db: Database.Database`, `kind: 'task' | 'tag'`. The `counts` map is `Map<string, number>`. Cast the query rows: `(db.prepare(...).all() as { color: string }[])`. Guard `counts.get(c)` with `?? 0`.

- [ ] **Step 3: Convert `csv.ts`**

`git mv src/csv.js src/csv.ts`. Type `q(v: unknown): string` and `sessionsToCsv(rows: DecoratedSession[]): string`. `new Date(s.start_utc!)`/`new Date(s.end_utc!)` — these rows are completed, assert non-null.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: `calc.test.js`, `csv.test.js`, and all others PASS.

- [ ] **Step 6: Commit**

```bash
git add src/calc.ts src/colors.ts src/csv.ts
git commit -m "refactor(ts): convert calc, colors, csv to typescript"
```

---

### Task 3: Convert `db.ts`

**Files:**
- Rename+edit: `src/db.js` → `src/db.ts`

**Interfaces:**
- Produces:
  - `migrate(db: Database.Database): void`
  - `seedSettings(db: Database.Database): void`
  - `openDb(path?: string): Database.Database`

- [ ] **Step 1: Convert**

`git mv src/db.js src/db.ts`. `import Database from 'better-sqlite3';` and type `Database.Database` throughout. `addColumn(db: Database.Database, table: string, col: string, def: string): void`. `openDatabases: Set<Database.Database>`. Keep the `SCHEMA` string and exit-hook logic byte-identical.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: `db.test.js` and all others PASS.

- [ ] **Step 4: Commit**

```bash
git add src/db.ts
git commit -m "refactor(ts): convert db module to typescript"
```

---

### Task 4: Convert `settings.ts`

**Files:**
- Rename+edit: `src/settings.js` → `src/settings.ts`

**Interfaces:**
- Consumes: `SettingsRow` from `./types.js`.
- Produces:
  - `getSettings(db: Database.Database): SettingsRow`
  - `updateSettings(db: Database.Database, patch?: { roundingMinutes?: unknown; sessionGrouping?: unknown; weekStart?: unknown }): void`

- [ ] **Step 1: Convert**

`git mv src/settings.js src/settings.ts`. `getSettings` casts `.get()` result `as SettingsRow`. `ROUNDING: Set<number>`, `GROUPING: Set<string>`. Keep validation logic identical; params typed `unknown` since they arrive from request bodies and are coerced with `Number(...)`.

- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit` — Expected: no errors.
- [ ] **Step 3: Run tests** — Run: `npm test` — Expected: `settings.test.js` and all others PASS.
- [ ] **Step 4: Commit**

```bash
git add src/settings.ts
git commit -m "refactor(ts): convert settings module to typescript"
```

---

### Task 5: Convert `catalog.ts`

**Files:**
- Rename+edit: `src/catalog.js` → `src/catalog.ts`

**Interfaces:**
- Consumes: `suggestColor` from `./colors.js`; `TaskRow`, `TagRow`, `ClientRow` from `./types.js`.
- Produces (key signatures):
  - `createClient(db, args: { name: string; address?: string; defaultRateCents?: number | null; currency?: string }): number`
  - `createTask(db, args: { name: string; details?: string; color?: string; hourlyRateCents?: number | null; clientId?: number | null }): number`
  - `getTask(db, id: number): (TaskRow & { tags: TagRow[] }) | undefined`
  - `taskTags(db, taskId: number): TagRow[]`
  - `taskTagIds(db, taskId: number): number[]`
  - `addTaskTag/removeTaskTag(db, taskId: number, tagId: number): void`
  - `defaultTask(db): TaskRow | undefined`
  - `setTaskHidden(db, id: number, hidden: boolean): void`
  - `deleteTask(db, id: number): void`
  - `createTag(db, args: { name: string; color?: string }): number`
  - `getTag(db, id: number): TagRow | undefined`
  - `listTasks/listAllTasks(db): TaskRow[]`; `listTags(db): TagRow[]`; `listClients(db): ClientRow[]`
  - `getClient(db, id: number): ClientRow | undefined`
  - `updateClient(db, id: number, args: { name: string; defaultRateCents?: number | null; currency?: string; address?: string }): void`
  - `deleteClient(db, id: number): void`
  - `listTasksByClient(db): ClientGroup[]`; `listActiveTasksByClient(db): ClientGroup[]`
  - `updateTask(db, id: number, args: { name: string; details?: string; color: string; hourlyRateCents?: number | null; isDefault?: boolean; clientId?: number | null }): void`
  - `updateTag(db, id: number, args: { name: string; color: string }): void`
  - `archiveTask/archiveTag(db, id: number): void`
  - `effectiveRateCents(db, taskId: number | null): number`
- Add and export `ClientGroup` in `types.ts`: `export interface ClientGroup { client: ClientRow | null; tasks: TaskRow[]; }` (do this in this task since it is catalog-specific).

- [ ] **Step 1: Add `ClientGroup` to `src/types.ts`** (interface above).

- [ ] **Step 2: Convert `catalog.ts`**

`git mv src/catalog.js src/catalog.ts`. Apply the signatures above. Cast every `.get()`/`.all()` to the row type. `db: Database.Database` first arg everywhere. In `groupByClient`, type `buckets: Map<number, TaskRow[]>`, `none: TaskRow[]`; guard `buckets.get(...)` reads with `!` or a local const (values are seeded from the same clients list). `taskTagIds` casts `.all() as { tag_id: number }[]`.

- [ ] **Step 3: Typecheck** — Run: `npx tsc --noEmit` — Expected: no errors.
- [ ] **Step 4: Run tests** — Run: `npm test` — Expected: `catalog.test.js` and all others PASS.
- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/catalog.ts
git commit -m "refactor(ts): convert catalog module to typescript"
```

---

### Task 6: Convert `sessions.ts`

**Files:**
- Rename+edit: `src/sessions.js` → `src/sessions.ts`

**Interfaces:**
- Consumes: `calc.ts` exports; `effectiveRateCents` from `./catalog.js`; `SessionRow`, `HydratedSession`, `DecoratedSession`, `SessionFilter`, `TagRow`, `TaskRow` from `./types.js`.
- Produces:
  - `createSession(db, args?: { description?: string; details?: string; taskId?: number | null; startUtc?: number | null; endUtc?: number | null; pausedMs?: number; pauseStartedAt?: number | null; createdAt?: number }): number`
  - `updateSession(db, id: number, fields: Partial<Record<'description'|'details'|'taskId'|'startUtc'|'endUtc'|'pausedMs'|'pauseStartedAt', unknown>>): void`
  - `setSessionTags(db, id: number, tagIds: number[]): void`
  - `deleteSession(db, id: number): void`
  - `getSession(db, id: number): HydratedSession | undefined`
  - `listSessions(db, filter?: SessionFilter): HydratedSession[]`
  - `decorateSession(db, session: HydratedSession, now: number, roundingMinutes: number): DecoratedSession`
  - `distinctDescriptions(db, q?: string, limit?: number): string[]`
  - `latestByDescription(db, description: string): { details: string; task_id: number | null; task: TaskRow | null; tags: TagRow[] } | null`

- [ ] **Step 1: Convert**

`git mv src/sessions.js src/sessions.ts`. Apply signatures. `hydrate(db, row: SessionRow): HydratedSession` casts tag/task queries. `updateSession` `COLS` typed `Record<string, string>`; `sets: string[]`, `vals: unknown[]`. `listSessions` `where: string[]`, `vals: unknown[]`; the `filter.taskIds`/`tagIds` branches keep the exact SQL. `decorateSession` returns the `DecoratedSession` object exactly as today.

- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit` — Expected: no errors.
- [ ] **Step 3: Run tests** — Run: `npm test` — Expected: `sessions.test.js` and all others PASS.
- [ ] **Step 4: Commit**

```bash
git add src/sessions.ts
git commit -m "refactor(ts): convert sessions module to typescript"
```

---

### Task 7: Convert `timer.ts` and `analytics.ts`

**Files:**
- Rename+edit: `src/timer.js` → `src/timer.ts`
- Rename+edit: `src/analytics.js` → `src/analytics.ts`

**Interfaces:**
- Produces (timer):
  - `getActiveSession(db): SessionRow | undefined`
  - `stopTimer(db, now: number): number | null`
  - `startTimer(db, now: number, opts?: { taskId?: number | null; description?: string }): number`
  - `startTimerFrom(db, now: number, sourceId: number): number | null`
  - `pauseTimer/resumeTimer(db, now: number): number | null`
  - `timerState(db, now: number): { state: 'none' | 'paused' | 'running'; session: DecoratedSession | null; elapsedMs: number }`
- Produces (analytics):
  - `dayStartUTC(ms: number): number`
  - `buildReport(db, args: { from: number; to: number; unit?: 'day' | 'week'; by?: 'task' | 'tag'; metric?: 'time' | 'earnings'; rounding?: number; clientId?: number | null; taskIds?: number[]; tagIds?: number[] }): Report`
  - `periodOf(type: string, ms: number, weekStart?: number): Period`
  - `listPeriods(db, type: string, weekStart?: number): { ps: number; label: string; selected?: boolean }[]`
- Add to `types.ts`: `Series`, `Bucket`, `Report`, `Period` (see step 1).

- [ ] **Step 1: Add analytics types to `src/types.ts`**

```ts
export interface Bucket { start: number; label: string; }
export interface Series { key: string; name: string; color: string; values: number[]; total: number; }
export interface Report { buckets: Bucket[]; series: Series[]; grandTotal: number; metric: string; by: string; }
export interface Period { type: string; start: number; from: number; to: number; unit: 'day' | 'week'; label: string; }
```

- [ ] **Step 2: Convert `timer.ts`**

`git mv src/timer.js src/timer.ts`. Apply signatures. `getActiveSession` casts `.get() as SessionRow | undefined`. In `startTimer`/`startTimerFrom`, `db.transaction(() => {...})` returns a callable; typing flows from the closure. `foldPause(active: SessionRow, now: number): number`.

- [ ] **Step 3: Convert `analytics.ts`**

`git mv src/analytics.js src/analytics.ts`. Apply signatures. `seriesMap: Map<string, Series>`; `ensure(key: string, name: string, color: string): Series`. `filter: SessionFilter`. `listPeriods` casts the MIN/MAX row `as { a: number | null; b: number | null }`. Keep the `guard` loop and reverse exactly.

- [ ] **Step 4: Typecheck** — Run: `npx tsc --noEmit` — Expected: no errors.
- [ ] **Step 5: Run tests** — Run: `npm test` — Expected: `timer.test.js`, `timer-resume.test.js`, `analytics.test.js` and all others PASS.
- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/timer.ts src/analytics.ts
git commit -m "refactor(ts): convert timer and analytics to typescript"
```

---

### Task 8: Convert `ws.ts`

**Files:**
- Rename+edit: `src/ws.js` → `src/ws.ts`

**Interfaces:**
- Consumes: `Hub` from `./types.js`; `WebSocket` from `ws`.
- Produces: `createHub(): Hub`.

- [ ] **Step 1: Convert**

`git mv src/ws.js src/ws.ts`. `import type { WebSocket } from 'ws';` `clients: Set<WebSocket>`. `handleConnection(ws: WebSocket): void`. `broadcast(type = 'changed'): void`. Return typed as `Hub`.

- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit` — Expected: no errors.
- [ ] **Step 3: Run tests** — Run: `npm test` — Expected: `ws.test.js` and all others PASS.
- [ ] **Step 4: Commit**

```bash
git add src/ws.ts
git commit -m "refactor(ts): convert ws hub to typescript"
```

---

### Task 9: Convert `auth.ts`

**Files:**
- Rename+edit: `src/auth.js` → `src/auth.ts`
- Create (only if needed): `src/better-sqlite3-session-store.d.ts`

**Interfaces:**
- Consumes: `UserRow` from `./types.js`; `RequestHandler` from `express`.
- Produces:
  - `hashPassword(pw: string): string`
  - `verifyPassword(pw: string, hash: string): boolean`
  - `seedUser(db, username: string, password: string): void`
  - `getUser(db, username: string): UserRow | undefined`
  - `buildSessionMiddleware(db): RequestHandler`
  - `requireAuth: RequestHandler`

- [ ] **Step 1: Handle the untyped session-store package**

Try converting first; if `tsc` errors that `better-sqlite3-session-store` has no declaration, create `src/better-sqlite3-session-store.d.ts`:

```ts
declare module 'better-sqlite3-session-store' {
  import type { Store } from 'express-session';
  interface Options { client: unknown; expired?: { clear?: boolean; intervalMs?: number }; }
  function factory(session: unknown): new (opts: Options) => Store;
  export default factory;
}
```

- [ ] **Step 2: Convert `auth.ts`**

`git mv src/auth.js src/auth.ts`. Apply signatures. `getUser` casts `.get() as UserRow | undefined`. In `createUnrefdSqliteStore`, type `timers: NodeJS.Timeout[]`; keep the `global.setInterval` capture/`unref` logic identical. `requireAuth(req, res, next)` typed via `RequestHandler`.

- [ ] **Step 3: Typecheck** — Run: `npx tsc --noEmit` — Expected: no errors.
- [ ] **Step 4: Run tests** — Run: `npm test` — Expected: `auth.test.js`, `routes-auth.test.js` and all others PASS.
- [ ] **Step 5: Commit**

```bash
git add src/auth.ts src/better-sqlite3-session-store.d.ts 2>/dev/null; git add -A
git commit -m "refactor(ts): convert auth module to typescript"
```

---

### Task 10: Convert routers — `tracking`, `sessions`, `tasks`, `settings`, `analytics`, `auth`

**Files:**
- Rename+edit: `src/routes/tracking.js` → `.ts`
- Rename+edit: `src/routes/sessions.js` → `.ts`
- Rename+edit: `src/routes/tasks.js` → `.ts`
- Rename+edit: `src/routes/settings.js` → `.ts`
- Rename+edit: `src/routes/analytics.js` → `.ts`
- Rename+edit: `src/routes/auth.js` → `.ts`

**Interfaces:**
- Consumes: converted data modules; `Router`, `Request`, `Response` from `express`; `Database`, `Hub`.
- Produces (each factory): `xRouter(db: Database.Database, hub: Hub): Router` (auth: `authRouter(db): Router`; analytics: `analyticsRouter(db): Router`).
- Also exported helpers from `tracking.ts`: `fmtDuration(ms: number): string`, `fmtMoney(cents: number): string`, `escapeHtml(str: unknown): string`, `groupSessions(db, sessions: HydratedSession[], now: number, rounding: number, unit?: string, weekStart?: number): SessionGroup[]`.
- Add to `types.ts`: `export interface SessionGroup { key: string; anchor: number; label: string; sessions: DecoratedSession[]; totalMs: number; totalCents: number; }`.

- [ ] **Step 1: Add `SessionGroup` to `src/types.ts`.**

- [ ] **Step 2: Convert `tracking.ts`**

`git mv`. Factory typed `trackingRouter(db: Database.Database, hub: Hub): Router`. Handlers `(req: Request, res: Response) => ...`. Local helpers (`idsFrom(v: unknown)`, `filterFrom(q)`, `pageCtx(q)` etc.) accept `q: Record<string, unknown>` or `req.query`-compatible types; cast `req.body`/`req.query` fields where coerced with `Number(...)`. `groupSessions` uses `SessionGroup`. Keep all render calls and route paths identical.

- [ ] **Step 3: Convert `sessions.ts` router**

`git mv`. `parseLocal(v: unknown): number | null`; `idsFrom(body, key: string): number[]`. Handlers typed. Import `fmtDuration` from `./tracking.js`. Keep validation/broadcast/render logic identical.

- [ ] **Step 4: Convert `tasks.ts`, `settings.ts`, `analytics.ts`, `auth.ts` routers**

`git mv` each. Apply factory signatures. `rateCents(v: unknown): number | null`. For `auth.ts` login handler, `req.session.userId = user.id` typechecks via `express.d.ts` augmentation. Cast `req.query`/`req.body` where numeric coercion happens. In `analytics.ts` `ctx`, keep `periods.forEach(x => { x.selected = ... })` — `selected?` is on the `listPeriods` return type.

- [ ] **Step 5: Typecheck** — Run: `npx tsc --noEmit` — Expected: no errors.
- [ ] **Step 6: Run tests** — Run: `npm test` — Expected: all `routes-*.test.js` and others PASS.
- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/routes
git commit -m "refactor(ts): convert routers to typescript"
```

---

### Task 11: Convert wiring (`app`, `server`) and scripts

**Files:**
- Rename+edit: `src/app.js` → `src/app.ts`
- Rename+edit: `src/server.js` → `src/server.ts`
- Rename+edit: `scripts/seed-user.js` → `scripts/seed-user.ts`
- Rename+edit: `scripts/seed-sample.js` → `scripts/seed-sample.ts`

**Interfaces:**
- Produces: `createApp(deps: { db: Database.Database; hub: Hub }): express.Express`.

- [ ] **Step 1: Convert `app.ts`**

`git mv`. `createApp({ db, hub }: { db: Database.Database; hub: Hub })`. `app.locals.db`/`hub` typecheck via `express.d.ts`. The error handler keeps its 4-arg signature: `(err: any, req: Request, res: Response, next: NextFunction)`; `err.status` accessed via `(err as { status?: number }).status`. Views/static paths unchanged.

- [ ] **Step 2: Convert `server.ts`**

`git mv`. Type the `upgrade` handler params (`req: IncomingMessage & { url?: string; session?: ... }`, `socket: Duplex`, `head: Buffer`). `sessionMw(req, {} as Response, () => {...})` — cast the empty response object. `req.session?.userId` guarded. Keep the production `SESSION_SECRET` throw and listen logic identical.

- [ ] **Step 3: Convert scripts**

`git mv` both. Import from `../src/*.js`. `seed-sample.ts`: type `taskSpecs` tuples explicitly — `const taskSpecs: [string, string, number | null, number | null, number[], string[]][]`; `tasks` map result `{ id: number; defTags: number[]; descs: string[] }[]`. Keep the RNG and insert transaction byte-identical.

- [ ] **Step 4: Typecheck** — Run: `npx tsc --noEmit` — Expected: no errors.
- [ ] **Step 5: Run tests + smoke the server**

Run: `npm test`
Expected: `smoke.test.js`, `scaffold.test.js`, and all others PASS.
Run: `npm start &` then `curl -s localhost:3000/health` → `{"ok":true}`; kill the server.

- [ ] **Step 6: Commit**

```bash
git add src/app.ts src/server.ts scripts/seed-user.ts scripts/seed-sample.ts
git commit -m "refactor(ts): convert app, server, and scripts"
```

---

### Task 12: Convert tests, drop `allowJs`, finalize

**Files:**
- Rename+edit: `test/*.js` → `test/*.ts` (all 23 files incl. `helpers.js`)
- Modify: `tsconfig.json` (remove `allowJs`/`checkJs`)

**Interfaces:**
- Consumes: every converted module via `../src/*.js` specifiers.
- Produces: `helpers.ts` — `makeTestDb(): Database.Database`, `makeApp(overrides?: { db?: Database.Database; hub?: Hub }): { app: Express; db: Database.Database; hub: Hub }`, `login(agent, db, username?, password?): Promise<void>`.

- [ ] **Step 1: Convert `test/helpers.ts` first**

`git mv test/helpers.js test/helpers.ts`. Apply signatures. The default hub stub `{ broadcast() {} }` must satisfy `Hub` — widen the param type to `{ db?: Database.Database; hub?: Partial<Hub> }` and cast, or give the stub `clients`/`handleConnection` no-ops. Prefer the full stub to keep `Hub` intact:

```ts
const hub: Hub = overrides.hub ?? { clients: new Set(), handleConnection() {}, broadcast() {} };
```

- [ ] **Step 2: Convert the remaining `test/*.js` → `.ts`**

`git mv` each. Add annotations only where `tsc` complains (test bodies are mostly inference-friendly). Cast supertest/response bodies as needed. Do not change any assertion or test name.

- [ ] **Step 3: Remove `allowJs`/`checkJs` from `tsconfig.json`**

Delete the two lines. Confirm no `.js` remain under `src/`, `test/`, `scripts/` except `scripts/copy-assets.js`:

Run: `git ls-files 'src/*.js' 'src/**/*.js' 'test/*.js' 'scripts/*.js'`
Expected: only `scripts/copy-assets.js`.

- [ ] **Step 4: Typecheck (strict, no JS)** — Run: `npx tsc --noEmit` — Expected: no errors.
- [ ] **Step 5: Full test run** — Run: `npm test` — Expected: every test PASS.
- [ ] **Step 6: Commit**

```bash
git add test tsconfig.json
git commit -m "refactor(ts): convert tests and finalize strict build"
```

---

### Task 13: Deploy pipeline + docs

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `deploy/time-tracker.service`
- Modify: `deploy/README.md`
- Modify: `AGENTS.md`

**Interfaces:** none (ops config).

- [ ] **Step 1: Upload `dist/` from the cloud `test` job**

In the `test` job, after `npm test`, add:

```yaml
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist
          retention-days: 1
```

- [ ] **Step 2: Download `dist/` in the `deploy` job before rsync**

After `actions/checkout@v4` in the `deploy` job, add:

```yaml
      - uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist
```

The existing rsync includes `dist/` automatically (whole-tree sync). Do not exclude it. Leave the `npm ci --omit=dev` remote step as-is (runtime deps only; no build on server).

- [ ] **Step 3: Update the systemd unit**

In `deploy/time-tracker.service`, change `ExecStart` to run `node dist/src/server.js` (keep the `tt-node` path prefix used today).

- [ ] **Step 4: Update docs**

`deploy/README.md`: note that CI builds `dist/` and ships it as an artifact; the server runs `dist/src/server.js`; one-time VPS setup no longer needs a build step. `AGENTS.md`: update Commands (`npm test` now builds first; add `npm run build`, `npm run typecheck`) and note the `.ts`/`dist` layout and `.js`-specifier convention in Architecture.

- [ ] **Step 5: Verify workflow YAML + rsync exclusions**

Run: `git grep -n "pull_request" .github/workflows/deploy.yml`
Expected: `pull_request` appears only as the top-level cloud trigger and the deploy-job `if` guard — never as a trigger on the self-hosted job. Confirm the rsync `--exclude` list has no `dist`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/deploy.yml deploy/time-tracker.service deploy/README.md AGENTS.md
git commit -m "ci(ts): build in cloud, ship dist artifact to deploy"
```

---

## Self-Review

**Spec coverage:**
- Compilation model (tsc→dist, NodeNext, strict, `.js` specifiers) → Task 1.
- Self-contained dist (copy views + public) → Task 1 (`copy-assets.js`), verified Task 11.
- npm scripts → Task 1.
- Types (`types.ts`, `express.d.ts`, row/domain/Hub types) → Task 1, extended in Tasks 5/7/10.
- Every module converted → Tasks 2–12.
- Deploy artifact model, service `ExecStart`, `.gitignore` → Tasks 1 (gitignore) + 13.
- Bottom-up order with green tests → task sequencing + `allowJs` bridge.
- Non-goals respected (no behavior change; `.ejs` untyped; no runtime validation).

**Placeholder scan:** No TBD/TODO. Conversion tasks specify exact signatures (the typing delta) plus verification commands; the executor edits existing JS in place.

**Type consistency:** Row/domain type names (`SessionRow`, `HydratedSession`, `DecoratedSession`, `SessionFilter`, `ClientGroup`, `SessionGroup`, `Report`, `Period`, `Hub`) are defined before first use (Tasks 1/5/7/10) and referenced consistently. Factory signatures match `app.ts` wiring in Task 11.
