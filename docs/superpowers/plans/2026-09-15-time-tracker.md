# Time Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted single-user time tracker (WorkingHours clone) with live timer sync across tabs.

**Architecture:** Express serves EJS pages; htmx drives interactions; Alpine only ticks the running clock and toggles collapse. `better-sqlite3` holds all data. A `ws` broadcast hub notifies every open tab of changes; tabs respond with htmx-triggered fragment refreshes. Pure calculation helpers (duration/earnings/rounding) are separated from persistence so they unit-test without a DB.

**Tech Stack:** Node 20+ (ESM, `node:test`), Express, better-sqlite3, better-sqlite3-session-store, express-session, bcryptjs, ws, ejs. Dev: supertest.

## Global Constraints

- Node 20+, ESM only (`"type": "module"`). No TypeScript, no bundler, no Vite.
- Minimal client JS: htmx + Alpine only. No SPA framework.
- All persistence in one SQLite file. No cloud sync.
- Times stored as **INTEGER epoch milliseconds** (UTC). Money as **INTEGER cents**.
- Single user; one `user` row. No signup UI — user seeded via script.
- Invariant: at most one open segment (`end_utc IS NULL`) exists at any time.
- Every logic module takes an injected `db` handle; tests use a temp DB file.
- Every task ends by running its tests green, then a commit.
- Commit style: `<type>(<scope>): <subject>`, imperative, ≤50 chars, no Claude co-author.

## File Structure

```
package.json
src/
  db.js          connection, schema/migrations, settings seed
  auth.js        hashing, seed user, session middleware, requireAuth
  calc.js        pure: rounding, duration, earnings
  sessions.js    session/segment CRUD, listing/filters, tags
  catalog.js     clients/tasks/tags CRUD
  settings.js    get/update settings
  timer.js       start/pause/resume/stop state machine
  ws.js          broadcast hub
  app.js         express app factory (routers, session, static, views)
  server.js      entrypoint: open db, hub, http+ws, listen
  routes/
    auth.js      login/logout
    tracking.js  time-tracking view + timer controls + partials
    sessions.js  tasks/sessions view, edit, manual entry, catalog create
    settings.js  settings view + update
  views/
    layout.ejs  login.ejs  tracking.ejs  tasks.ejs  settings.ejs
    partials/ active-timer.ejs day-group.ejs session-row.ejs
              session-edit.ejs task-tag-pickers.ejs
scripts/
  seed-user.js   reads env, creates/updates the user
public/
  app.css  app.js  vendor/htmx.min.js  vendor/alpine.min.js
test/
  helpers.js  db.test.js  auth.test.js  calc.test.js  sessions.test.js
  catalog.test.js  settings.test.js  timer.test.js  ws.test.js
  routes-auth.test.js  routes-tracking.test.js  routes-sessions.test.js
  routes-settings.test.js
```

---

## Task 1: Project scaffold + app factory skeleton

**Files:**
- Create: `package.json`, `src/app.js`, `src/db.js` (stub), `test/helpers.js`, `test/scaffold.test.js`

**Interfaces:**
- Produces: `createApp({ db, hub })` → Express app. `openDb(path)` → better-sqlite3 handle (full impl in Task 2; a minimal version here). `makeTestDb()` and `makeApp()` test helpers.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "time-tracker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test",
    "seed": "node scripts/seed-user.js"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "better-sqlite3": "^11.0.0",
    "better-sqlite3-session-store": "^0.1.0",
    "ejs": "^3.1.10",
    "express": "^4.19.2",
    "express-session": "^1.18.0",
    "ws": "^8.17.0"
  },
  "devDependencies": {
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: dependencies install, `node_modules/` created.

- [ ] **Step 3: Minimal `src/db.js`**

```js
import Database from 'better-sqlite3';

export function openDb(path = ':memory:') {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
```

- [ ] **Step 4: `src/app.js` skeleton with health route**

```js
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ db, hub }) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(dir, 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(dir, '..', 'public')));
  app.locals.db = db;
  app.locals.hub = hub;
  app.get('/health', (req, res) => res.json({ ok: true }));
  return app;
}
```

- [ ] **Step 5: `test/helpers.js`**

```js
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

export function makeTestDb() {
  return openDb(':memory:');
}

export function makeApp(overrides = {}) {
  const db = overrides.db || makeTestDb();
  const hub = overrides.hub || { broadcast() {} };
  return { app: createApp({ db, hub }), db, hub };
}
```

- [ ] **Step 6: `test/scaffold.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp } from './helpers.js';

test('health route responds ok', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});
```

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(scaffold): add express app, db handle, test harness"
```

---

## Task 2: Database schema + migrations + settings seed

**Files:**
- Modify: `src/db.js`
- Test: `test/db.test.js`

**Interfaces:**
- Produces: `openDb(path)` now runs `migrate(db)` + `seedSettings(db)`. Tables: `user, client, task, tag, session, segment, session_tag, settings`. Partial unique index `one_open_segment`. `settings` always has row `id=1`.

- [ ] **Step 1: Write `test/db.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';

test('migrations create all tables', () => {
  const db = openDb(':memory:');
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'"
  ).all().map(r => r.name);
  for (const t of ['user','client','task','tag','session','segment','session_tag','settings']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
});

test('settings row seeded with defaults', () => {
  const db = openDb(':memory:');
  const s = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  assert.equal(s.rounding_minutes, 0);
  assert.equal(s.currency, 'USD');
});

test('only one open segment allowed', () => {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO session (created_at) VALUES (?)').run(1);
  const sid = db.prepare('SELECT id FROM session').get().id;
  db.prepare('INSERT INTO segment (session_id, start_utc) VALUES (?, ?)').run(sid, 10);
  assert.throws(() =>
    db.prepare('INSERT INTO segment (session_id, start_utc) VALUES (?, ?)').run(sid, 20)
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/db.test.js`
Expected: FAIL (no tables / no seed).

- [ ] **Step 3: Implement schema in `src/db.js`**

```js
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS client (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  default_rate_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS task (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  hourly_rate_cents INTEGER,
  client_id INTEGER REFERENCES client(id) ON DELETE SET NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tag (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS session (
  id INTEGER PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  task_id INTEGER REFERENCES task(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS segment (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  start_utc INTEGER NOT NULL,
  end_utc INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_segment
  ON segment((1)) WHERE end_utc IS NULL;
CREATE TABLE IF NOT EXISTS session_tag (
  session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, tag_id)
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  business_from TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  week_start INTEGER NOT NULL DEFAULT 1,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  rounding_minutes INTEGER NOT NULL DEFAULT 0
);
`;

export function migrate(db) {
  db.exec(SCHEMA);
}

export function seedSettings(db) {
  db.prepare('INSERT OR IGNORE INTO settings (id) VALUES (1)').run();
}

export function openDb(path = ':memory:') {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seedSettings(db);
  return db;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/db.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): add schema, migrations, settings seed"
```

---

## Task 3: Pure calculation helpers (rounding, duration, earnings)

**Files:**
- Create: `src/calc.js`, `test/calc.test.js`

**Interfaces:**
- Produces:
  - `roundDurationMs(ms, roundingMinutes)` → number. `roundingMinutes===0` returns `ms` unchanged; else rounds to nearest interval.
  - `segmentsDurationMs(segments, now)` → number. `segments`: `[{start_utc, end_utc}]`; `end_utc==null` counts to `now`.
  - `earningsCents(durationMs, rateCents)` → integer = `Math.round(durationMs / 3600000 * rateCents)`.

- [ ] **Step 1: Write `test/calc.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundDurationMs, segmentsDurationMs, earningsCents } from '../src/calc.js';

const MIN = 60000;

test('rounding off returns raw ms', () => {
  assert.equal(roundDurationMs(7 * MIN, 0), 7 * MIN);
});

test('rounds to nearest 15 minutes', () => {
  assert.equal(roundDurationMs(7 * MIN, 15), 0);
  assert.equal(roundDurationMs(8 * MIN, 15), 15 * MIN);
  assert.equal(roundDurationMs(23 * MIN, 15), 30 * MIN);
});

test('rounds to nearest 30 and 60', () => {
  assert.equal(roundDurationMs(20 * MIN, 30), 30 * MIN);
  assert.equal(roundDurationMs(31 * MIN, 60), 60 * MIN);
});

test('sums closed segments', () => {
  const segs = [{ start_utc: 0, end_utc: 10 * MIN }, { start_utc: 20 * MIN, end_utc: 25 * MIN }];
  assert.equal(segmentsDurationMs(segs, 999), 15 * MIN);
});

test('open segment counts to now', () => {
  const segs = [{ start_utc: 0, end_utc: null }];
  assert.equal(segmentsDurationMs(segs, 5 * MIN), 5 * MIN);
});

test('earnings from duration and rate', () => {
  assert.equal(earningsCents(3600000, 4000), 4000);
  assert.equal(earningsCents(1800000, 4000), 2000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/calc.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/calc.js`**

```js
export function roundDurationMs(ms, roundingMinutes) {
  if (!roundingMinutes) return ms;
  const interval = roundingMinutes * 60000;
  return Math.round(ms / interval) * interval;
}

export function segmentsDurationMs(segments, now) {
  let total = 0;
  for (const s of segments) {
    const end = s.end_utc == null ? now : s.end_utc;
    total += end - s.start_utc;
  }
  return total;
}

export function earningsCents(durationMs, rateCents) {
  return Math.round((durationMs / 3600000) * rateCents);
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/calc.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(calc): add rounding, duration, earnings helpers"
```

---

## Task 4: Auth (hashing, seed user, session middleware, guard)

**Files:**
- Create: `src/auth.js`, `scripts/seed-user.js`, `test/auth.test.js`

**Interfaces:**
- Consumes: `openDb` (Task 2).
- Produces:
  - `hashPassword(pw)` → string; `verifyPassword(pw, hash)` → bool.
  - `seedUser(db, username, password)` → inserts/replaces the single user row.
  - `getUser(db, username)` → row or undefined.
  - `buildSessionMiddleware(db)` → express-session middleware backed by the sqlite store.
  - `requireAuth(req, res, next)` → calls `next()` if `req.session.userId`, else `HX-Redirect`/redirect to `/login`.

- [ ] **Step 1: Write `test/auth.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { hashPassword, verifyPassword, seedUser, getUser, requireAuth } from '../src/auth.js';

test('hash and verify round-trip', () => {
  const h = hashPassword('secret');
  assert.ok(verifyPassword('secret', h));
  assert.ok(!verifyPassword('wrong', h));
});

test('seedUser creates one user, replace updates it', () => {
  const db = openDb(':memory:');
  seedUser(db, 'abe', 'pw1');
  seedUser(db, 'abe', 'pw2');
  const count = db.prepare('SELECT COUNT(*) c FROM user').get().c;
  assert.equal(count, 1);
  assert.ok(verifyPassword('pw2', getUser(db, 'abe').password_hash));
});

test('requireAuth blocks anonymous, allows session', () => {
  const calls = [];
  const next = () => calls.push('next');
  const res = { redirect: (u) => calls.push('redirect:' + u), set() {}, status() { return res; }, end() {} };
  requireAuth({ session: {}, get: () => undefined }, res, next);
  requireAuth({ session: { userId: 1 }, get: () => undefined }, res, next);
  assert.deepEqual(calls, ['redirect:/login', 'next']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/auth.js`**

```js
import bcrypt from 'bcryptjs';
import session from 'express-session';
import SqliteStoreFactory from 'better-sqlite3-session-store';

const SqliteStore = SqliteStoreFactory(session);

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

export function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}

export function seedUser(db, username, password) {
  db.prepare(
    `INSERT INTO user (id, username, password_hash) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username,
     password_hash = excluded.password_hash`
  ).run(username, hashPassword(password));
}

export function getUser(db, username) {
  return db.prepare('SELECT * FROM user WHERE username = ?').get(username);
}

export function buildSessionMiddleware(db) {
  return session({
    store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 900000 } }),
    secret: process.env.SESSION_SECRET || 'dev-insecure-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 },
  });
}

export function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.get('HX-Request')) {
    res.set('HX-Redirect', '/login');
    return res.status(401).end();
  }
  return res.redirect('/login');
}
```

- [ ] **Step 4: Implement `scripts/seed-user.js`**

```js
import { openDb } from '../src/db.js';
import { seedUser } from '../src/auth.js';

const username = process.env.TT_USERNAME;
const password = process.env.TT_PASSWORD;
if (!username || !password) {
  console.error('Set TT_USERNAME and TT_PASSWORD');
  process.exit(1);
}
const db = openDb(process.env.DB_PATH || 'data.sqlite');
seedUser(db, username, password);
console.log(`Seeded user ${username}`);
```

- [ ] **Step 5: Run tests**

Run: `node --test test/auth.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): add hashing, user seed, session guard"
```

---

## Task 5: Catalog (clients, tasks, tags) + effective rate

**Files:**
- Create: `src/catalog.js`, `test/catalog.test.js`

**Interfaces:**
- Consumes: `openDb`, `calc.js`.
- Produces:
  - `createClient(db, {name, address='', defaultRateCents=null, currency='USD'})` → id.
  - `createTask(db, {name, color='#3b82f6', hourlyRateCents=null, clientId=null})` → id.
  - `createTag(db, {name, color='#6b7280'})` → id.
  - `listTasks(db)` / `listTags(db)` / `listClients(db)` → rows where `archived=0`, ordered by name.
  - `archiveTask(db, id)` / `archiveTag(db, id)` → set `archived=1`.
  - `effectiveRateCents(db, taskId)` → task rate, else client default, else 0.

- [ ] **Step 1: Write `test/catalog.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createClient, createTask, createTag, listTasks, listTags,
  archiveTask, effectiveRateCents } from '../src/catalog.js';

test('create and list tasks (archived hidden)', () => {
  const db = openDb(':memory:');
  const a = createTask(db, { name: 'App dev' });
  createTask(db, { name: 'Zebra' });
  archiveTask(db, a);
  const names = listTasks(db).map(t => t.name);
  assert.deepEqual(names, ['Zebra']);
});

test('effective rate: task rate wins', () => {
  const db = openDb(':memory:');
  const c = createClient(db, { name: 'Acme', defaultRateCents: 5000 });
  const t = createTask(db, { name: 'Paid', hourlyRateCents: 8000, clientId: c });
  assert.equal(effectiveRateCents(db, t), 8000);
});

test('effective rate: falls back to client default then zero', () => {
  const db = openDb(':memory:');
  const c = createClient(db, { name: 'Acme', defaultRateCents: 5000 });
  const t = createTask(db, { name: 'NoRate', clientId: c });
  assert.equal(effectiveRateCents(db, t), 5000);
  const t2 = createTask(db, { name: 'Bare' });
  assert.equal(effectiveRateCents(db, t2), 0);
  assert.equal(effectiveRateCents(db, null), 0);
});

test('tags create and list', () => {
  const db = openDb(':memory:');
  createTag(db, { name: 'Bug fixes', color: '#2563eb' });
  assert.equal(listTags(db).length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/catalog.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/catalog.js`**

```js
export function createClient(db, { name, address = '', defaultRateCents = null, currency = 'USD' }) {
  return db.prepare(
    'INSERT INTO client (name, address, default_rate_cents, currency) VALUES (?, ?, ?, ?)'
  ).run(name, address, defaultRateCents, currency).lastInsertRowid;
}

export function createTask(db, { name, color = '#3b82f6', hourlyRateCents = null, clientId = null }) {
  return db.prepare(
    'INSERT INTO task (name, color, hourly_rate_cents, client_id) VALUES (?, ?, ?, ?)'
  ).run(name, color, hourlyRateCents, clientId).lastInsertRowid;
}

export function createTag(db, { name, color = '#6b7280' }) {
  return db.prepare('INSERT INTO tag (name, color) VALUES (?, ?)').run(name, color).lastInsertRowid;
}

export function listTasks(db) {
  return db.prepare('SELECT * FROM task WHERE archived = 0 ORDER BY name').all();
}
export function listTags(db) {
  return db.prepare('SELECT * FROM tag WHERE archived = 0 ORDER BY name').all();
}
export function listClients(db) {
  return db.prepare('SELECT * FROM client WHERE archived = 0 ORDER BY name').all();
}

export function archiveTask(db, id) {
  db.prepare('UPDATE task SET archived = 1 WHERE id = ?').run(id);
}
export function archiveTag(db, id) {
  db.prepare('UPDATE tag SET archived = 1 WHERE id = ?').run(id);
}

export function effectiveRateCents(db, taskId) {
  if (!taskId) return 0;
  const task = db.prepare('SELECT hourly_rate_cents, client_id FROM task WHERE id = ?').get(taskId);
  if (!task) return 0;
  if (task.hourly_rate_cents != null) return task.hourly_rate_cents;
  if (task.client_id) {
    const c = db.prepare('SELECT default_rate_cents FROM client WHERE id = ?').get(task.client_id);
    if (c && c.default_rate_cents != null) return c.default_rate_cents;
  }
  return 0;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/catalog.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(catalog): add clients, tasks, tags, effective rate"
```

---

## Task 6: Sessions persistence (CRUD, segments, tags, listing/filters)

**Files:**
- Create: `src/sessions.js`, `test/sessions.test.js`

**Interfaces:**
- Consumes: `calc.js`, `catalog.js`.
- Produces:
  - `createSession(db, {description='', details='', taskId=null, createdAt=Date.now(), segments=[]})` → id. `segments`: `[{start, end}]` (end optional).
  - `getSession(db, id)` → `{...row, segments:[...], tags:[...], task}` or undefined.
  - `updateSession(db, id, {description, details, taskId})` → applies provided keys only.
  - `setSessionTags(db, id, tagIds)` → replaces tag set.
  - `addSegment(db, sessionId, start, end=null)` → id.
  - `updateSegment(db, id, {start, end})` → applies provided keys.
  - `deleteSession(db, id)` → void.
  - `listSessions(db, filter={})` → array of `getSession`-shaped objects. Filter keys: `from, to` (ms range on any segment), `q` (description LIKE), `taskId`, `tagId`, `unlabelled` (description==''), `uncategorized` (task_id IS NULL). Ordered by earliest segment start desc; sessions with no segments sort last.
  - `decorateSession(db, session, now, roundingMinutes)` → adds `durationMs, roundedMs, earningsCents` (running session uses raw `durationMs` for `roundedMs`).

- [ ] **Step 1: Write `test/sessions.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createTask } from '../src/catalog.js';
import { createSession, getSession, updateSession, setSessionTags,
  addSegment, deleteSession, listSessions, decorateSession } from '../src/sessions.js';

const MIN = 60000;

test('create with segments, read back', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { description: 'Work', segments: [{ start: 0, end: 10 * MIN }] });
  const s = getSession(db, id);
  assert.equal(s.description, 'Work');
  assert.equal(s.segments.length, 1);
});

test('update applies only given fields', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { description: 'A', details: 'keep' });
  updateSession(db, id, { description: 'B' });
  const s = getSession(db, id);
  assert.equal(s.description, 'B');
  assert.equal(s.details, 'keep');
});

test('setSessionTags replaces set', () => {
  const db = openDb(':memory:');
  const id = createSession(db, {});
  db.prepare("INSERT INTO tag (id,name) VALUES (1,'x'),(2,'y')").run();
  setSessionTags(db, id, [1, 2]);
  setSessionTags(db, id, [2]);
  assert.deepEqual(getSession(db, id).tags.map(t => t.id), [2]);
});

test('decorate computes duration, rounded, earnings', () => {
  const db = openDb(':memory:');
  const t = createTask(db, { name: 'Paid', hourlyRateCents: 6000 });
  const id = createSession(db, { taskId: t, segments: [{ start: 0, end: 23 * MIN }] });
  const d = decorateSession(db, getSession(db, id), 999, 15);
  assert.equal(d.durationMs, 23 * MIN);
  assert.equal(d.roundedMs, 30 * MIN);
  assert.equal(d.earningsCents, 3000);
});

test('filters: unlabelled and uncategorized', () => {
  const db = openDb(':memory:');
  const t = createTask(db, { name: 'T' });
  createSession(db, { description: 'has label', taskId: t, segments: [{ start: 1, end: 2 }] });
  const bare = createSession(db, { segments: [{ start: 3, end: 4 }] });
  assert.deepEqual(listSessions(db, { unlabelled: true }).map(s => s.id), [bare]);
  assert.deepEqual(listSessions(db, { uncategorized: true }).map(s => s.id), [bare]);
});

test('delete cascades segments', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { segments: [{ start: 0, end: 1 }] });
  deleteSession(db, id);
  assert.equal(getSession(db, id), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM segment').get().c, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sessions.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/sessions.js`**

```js
import { segmentsDurationMs, roundDurationMs, earningsCents } from './calc.js';
import { effectiveRateCents } from './catalog.js';

export function createSession(db, { description = '', details = '', taskId = null, createdAt = Date.now(), segments = [] } = {}) {
  const id = db.prepare(
    'INSERT INTO session (description, details, task_id, created_at) VALUES (?, ?, ?, ?)'
  ).run(description, details, taskId, createdAt).lastInsertRowid;
  for (const seg of segments) addSegment(db, id, seg.start, seg.end ?? null);
  return id;
}

export function addSegment(db, sessionId, start, end = null) {
  return db.prepare(
    'INSERT INTO segment (session_id, start_utc, end_utc) VALUES (?, ?, ?)'
  ).run(sessionId, start, end).lastInsertRowid;
}

export function updateSegment(db, id, fields) {
  const sets = [], vals = [];
  if ('start' in fields) { sets.push('start_utc = ?'); vals.push(fields.start); }
  if ('end' in fields) { sets.push('end_utc = ?'); vals.push(fields.end); }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE segment SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function updateSession(db, id, fields) {
  const sets = [], vals = [];
  if ('description' in fields) { sets.push('description = ?'); vals.push(fields.description); }
  if ('details' in fields) { sets.push('details = ?'); vals.push(fields.details); }
  if ('taskId' in fields) { sets.push('task_id = ?'); vals.push(fields.taskId); }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE session SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function setSessionTags(db, id, tagIds) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM session_tag WHERE session_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO session_tag (session_id, tag_id) VALUES (?, ?)');
    for (const t of tagIds) ins.run(id, t);
  });
  tx();
}

export function deleteSession(db, id) {
  db.prepare('DELETE FROM session WHERE id = ?').run(id);
}

export function getSession(db, id) {
  const row = db.prepare('SELECT * FROM session WHERE id = ?').get(id);
  if (!row) return undefined;
  return hydrate(db, row);
}

function hydrate(db, row) {
  const segments = db.prepare(
    'SELECT * FROM segment WHERE session_id = ? ORDER BY start_utc'
  ).all(row.id);
  const tags = db.prepare(
    `SELECT tag.* FROM tag JOIN session_tag st ON st.tag_id = tag.id
     WHERE st.session_id = ? ORDER BY tag.name`
  ).all(row.id);
  const task = row.task_id ? db.prepare('SELECT * FROM task WHERE id = ?').get(row.task_id) : null;
  return { ...row, segments, tags, task };
}

export function listSessions(db, filter = {}) {
  const where = [], vals = [];
  if (filter.q) { where.push('s.description LIKE ?'); vals.push('%' + filter.q + '%'); }
  if (filter.taskId) { where.push('s.task_id = ?'); vals.push(filter.taskId); }
  if (filter.unlabelled) where.push("s.description = ''");
  if (filter.uncategorized) where.push('s.task_id IS NULL');
  if (filter.tagId) {
    where.push('EXISTS (SELECT 1 FROM session_tag st WHERE st.session_id = s.id AND st.tag_id = ?)');
    vals.push(filter.tagId);
  }
  if (filter.from != null) {
    where.push('EXISTS (SELECT 1 FROM segment g WHERE g.session_id = s.id AND COALESCE(g.end_utc, g.start_utc) >= ?)');
    vals.push(filter.from);
  }
  if (filter.to != null) {
    where.push('EXISTS (SELECT 1 FROM segment g WHERE g.session_id = s.id AND g.start_utc <= ?)');
    vals.push(filter.to);
  }
  const sql = `
    SELECT s.*, (SELECT MIN(start_utc) FROM segment g WHERE g.session_id = s.id) AS first_start
    FROM session s
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY first_start IS NULL, first_start DESC, s.id DESC`;
  return db.prepare(sql).all(...vals).map(row => hydrate(db, row));
}

export function decorateSession(db, session, now, roundingMinutes) {
  const running = session.segments.some(s => s.end_utc == null);
  const durationMs = segmentsDurationMs(session.segments, now);
  const roundedMs = running ? durationMs : roundDurationMs(durationMs, roundingMinutes);
  const rate = effectiveRateCents(db, session.task_id);
  return { ...session, running, durationMs, roundedMs, earningsCents: earningsCents(roundedMs, rate) };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/sessions.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sessions): add CRUD, segments, tags, listing, decorate"
```

---

## Task 7: Settings module

**Files:**
- Create: `src/settings.js`, `test/settings.test.js`

**Interfaces:**
- Produces:
  - `getSettings(db)` → the row `id=1`.
  - `updateSettings(db, {roundingMinutes})` → validates `roundingMinutes ∈ {0,15,30,60}`; throws `Error('invalid rounding')` otherwise.

- [ ] **Step 1: Write `test/settings.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { getSettings, updateSettings } from '../src/settings.js';

test('defaults then update rounding', () => {
  const db = openDb(':memory:');
  assert.equal(getSettings(db).rounding_minutes, 0);
  updateSettings(db, { roundingMinutes: 30 });
  assert.equal(getSettings(db).rounding_minutes, 30);
});

test('rejects invalid rounding', () => {
  const db = openDb(':memory:');
  assert.throws(() => updateSettings(db, { roundingMinutes: 7 }), /invalid rounding/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/settings.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/settings.js`**

```js
const ALLOWED = new Set([0, 15, 30, 60]);

export function getSettings(db) {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get();
}

export function updateSettings(db, { roundingMinutes }) {
  const r = Number(roundingMinutes);
  if (!ALLOWED.has(r)) throw new Error('invalid rounding');
  db.prepare('UPDATE settings SET rounding_minutes = ? WHERE id = 1').run(r);
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/settings.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(settings): add get/update with rounding validation"
```

---

## Task 8: Timer state machine

**Files:**
- Create: `src/timer.js`, `test/timer.test.js`

**Interfaces:**
- Consumes: `sessions.js` (`createSession`, `addSegment`, `getSession`, `decorateSession`), `settings.js`.
- Produces:
  - `getOpenSegment(db)` → open segment row or undefined.
  - `startTimer(db, now, {taskId=null, description=''}={})` → new session id (closes any open segment first).
  - `pauseTimer(db, now)` → session id of the paused session, or null if none running.
  - `resumeTimer(db, now, sessionId)` → adds an open segment to `sessionId` (closes any open first); returns `sessionId`.
  - `stopTimer(db, now)` → session id stopped, or null.
  - `timerState(db, now)` → `{running: bool, session: <decorated>|null, since: <ms>|null}`.

- [ ] **Step 1: Write `test/timer.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { getSession } from '../src/sessions.js';
import { startTimer, pauseTimer, resumeTimer, stopTimer, getOpenSegment, timerState } from '../src/timer.js';

const MIN = 60000;

test('start creates running session with open segment', () => {
  const db = openDb(':memory:');
  const id = startTimer(db, 1000);
  const seg = getOpenSegment(db);
  assert.equal(seg.session_id, id);
  assert.equal(seg.end_utc, null);
  assert.ok(timerState(db, 2000).running);
});

test('starting again closes the previous open segment', () => {
  const db = openDb(':memory:');
  const first = startTimer(db, 0);
  startTimer(db, 5 * MIN);
  const firstSegs = getSession(db, first).segments;
  assert.equal(firstSegs[0].end_utc, 5 * MIN);
});

test('pause then resume creates a gap in same session', () => {
  const db = openDb(':memory:');
  const id = startTimer(db, 0);
  pauseTimer(db, 10 * MIN);
  assert.equal(getOpenSegment(db), undefined);
  resumeTimer(db, 20 * MIN, id);
  const segs = getSession(db, id).segments;
  assert.equal(segs.length, 2);
  assert.equal(segs[0].end_utc, 10 * MIN);
  assert.equal(segs[1].end_utc, null);
});

test('stop closes open segment', () => {
  const db = openDb(':memory:');
  startTimer(db, 0);
  const id = stopTimer(db, 30 * MIN);
  assert.equal(getOpenSegment(db), undefined);
  assert.equal(getSession(db, id).segments[0].end_utc, 30 * MIN);
});

test('pause/stop with nothing running returns null', () => {
  const db = openDb(':memory:');
  assert.equal(pauseTimer(db, 1), null);
  assert.equal(stopTimer(db, 1), null);
  assert.equal(timerState(db, 1).running, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/timer.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/timer.js`**

```js
import { createSession, addSegment, getSession, decorateSession } from './sessions.js';
import { getSettings } from './settings.js';

export function getOpenSegment(db) {
  return db.prepare('SELECT * FROM segment WHERE end_utc IS NULL').get();
}

function closeOpen(db, now) {
  const open = getOpenSegment(db);
  if (open) {
    db.prepare('UPDATE segment SET end_utc = ? WHERE id = ?').run(now, open.id);
    return open.session_id;
  }
  return null;
}

export function startTimer(db, now, { taskId = null, description = '' } = {}) {
  const tx = db.transaction(() => {
    closeOpen(db, now);
    const id = createSession(db, { taskId, description, createdAt: now });
    addSegment(db, id, now, null);
    return id;
  });
  return tx();
}

export function pauseTimer(db, now) {
  return closeOpen(db, now);
}

export function resumeTimer(db, now, sessionId) {
  const tx = db.transaction(() => {
    closeOpen(db, now);
    addSegment(db, sessionId, now, null);
    return sessionId;
  });
  return tx();
}

export function stopTimer(db, now) {
  return closeOpen(db, now);
}

export function timerState(db, now) {
  const open = getOpenSegment(db);
  if (!open) return { running: false, session: null, since: null };
  const session = decorateSession(db, getSession(db, open.session_id), now, getSettings(db).rounding_minutes);
  return { running: true, session, since: open.start_utc };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/timer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(timer): add start/pause/resume/stop state machine"
```

---

## Task 9: WebSocket broadcast hub

**Files:**
- Create: `src/ws.js`, `test/ws.test.js`

**Interfaces:**
- Produces: `createHub()` → `{ clients, handleConnection(ws), broadcast(type='changed') }`. `broadcast` sends `JSON.stringify({type})` to every client with `readyState===1`. `handleConnection` registers the socket and removes it on `'close'`.

- [ ] **Step 1: Write `test/ws.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../src/ws.js';

function fakeWs() {
  const sent = [];
  const handlers = {};
  return {
    readyState: 1, sent,
    send: (m) => sent.push(m),
    on: (e, f) => { handlers[e] = f; },
    fire: (e) => handlers[e] && handlers[e](),
  };
}

test('broadcast reaches open clients only', () => {
  const hub = createHub();
  const a = fakeWs(), b = fakeWs();
  b.readyState = 3;
  hub.handleConnection(a);
  hub.handleConnection(b);
  hub.broadcast('changed');
  assert.deepEqual(a.sent, ['{"type":"changed"}']);
  assert.deepEqual(b.sent, []);
});

test('closed client is removed', () => {
  const hub = createHub();
  const a = fakeWs();
  hub.handleConnection(a);
  a.fire('close');
  hub.broadcast('changed');
  assert.deepEqual(a.sent, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ws.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/ws.js`**

```js
export function createHub() {
  const clients = new Set();
  function handleConnection(ws) {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  }
  function broadcast(type = 'changed') {
    const msg = JSON.stringify({ type });
    for (const ws of clients) if (ws.readyState === 1) ws.send(msg);
  }
  return { clients, handleConnection, broadcast };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/ws.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ws): add broadcast hub"
```

---

## Task 10: Auth routes + views (layout, login) + wire session

**Files:**
- Create: `src/routes/auth.js`, `src/views/layout.ejs`, `src/views/login.ejs`, `test/routes-auth.test.js`
- Modify: `src/app.js`, `test/helpers.js`

**Interfaces:**
- Consumes: `auth.js`, `catalog.js`.
- Produces: `authRouter(db)` mounts `GET /login`, `POST /login`, `POST /logout`. `createApp` now installs `buildSessionMiddleware(db)`, mounts `authRouter`, and exposes `res.locals` nav helper. Test helper gains `login(agent)`.

- [ ] **Step 1: Write `test/routes-auth.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp } from './helpers.js';
import { seedUser } from '../src/auth.js';

test('login page renders', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/login');
  assert.equal(res.status, 200);
  assert.match(res.text, /name="password"/);
});

test('wrong password rejected, protected route redirects', async () => {
  const { app, db } = makeApp();
  seedUser(db, 'abe', 'pw');
  const bad = await request(app).post('/login').type('form').send({ username: 'abe', password: 'no' });
  assert.equal(bad.status, 200);
  assert.match(bad.text, /Invalid/);
  const prot = await request(app).get('/');
  assert.equal(prot.status, 302);
  assert.equal(prot.headers.location, '/login');
});

test('valid login reaches home', async () => {
  const { app, db } = makeApp();
  seedUser(db, 'abe', 'pw');
  const agent = request.agent(app);
  const ok = await agent.post('/login').type('form').send({ username: 'abe', password: 'pw' });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, '/');
  const home = await agent.get('/');
  assert.equal(home.status, 200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/routes-auth.test.js`
Expected: FAIL (no `/login`, no home route).

- [ ] **Step 3: Implement `src/routes/auth.js`**

```js
import express from 'express';
import { getUser, verifyPassword } from '../auth.js';

export function authRouter(db) {
  const r = express.Router();
  r.get('/login', (req, res) => res.render('login', { error: null }));
  r.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = getUser(db, username);
    if (user && verifyPassword(password, user.password_hash)) {
      req.session.userId = user.id;
      return res.redirect('/');
    }
    res.render('login', { error: 'Invalid username or password' });
  });
  r.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));
  return r;
}
```

- [ ] **Step 4: Create `src/views/layout.ejs`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><%= title %></title>
  <link rel="stylesheet" href="/app.css">
  <script src="/vendor/htmx.min.js" defer></script>
  <script src="/vendor/alpine.min.js" defer></script>
  <script src="/app.js" defer></script>
</head>
<body>
  <% if (typeof nav !== 'undefined' && nav) { %>
  <nav class="topnav">
    <a href="/" class="<%= nav==='tracking'?'active':'' %>">Time</a>
    <a href="/tasks" class="<%= nav==='tasks'?'active':'' %>">Tasks</a>
    <a href="/settings" class="<%= nav==='settings'?'active':'' %>">Settings</a>
    <form method="post" action="/logout" class="logout"><button>Logout</button></form>
  </nav>
  <% } %>
  <main><%- body %></main>
</body>
</html>
```

- [ ] **Step 5: Create `src/views/login.ejs`**

```html
<% body = `
  <form class="login" method="post" action="/login">
    <h1>Time Tracker</h1>
    ${error ? `<p class="err">${error}</p>` : ''}
    <input name="username" placeholder="Username" autofocus required>
    <input name="password" type="password" placeholder="Password" required>
    <button type="submit">Log in</button>
  </form>` %>
<%- include('layout', { title: 'Login', body, nav: null }) %>
```

- [ ] **Step 6: Update `src/app.js` to install session + auth + home guard**

Replace the body of `createApp` with:

```js
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildSessionMiddleware, requireAuth } from './auth.js';
import { authRouter } from './routes/auth.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ db, hub }) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(dir, 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(dir, '..', 'public')));
  app.use(buildSessionMiddleware(db));
  app.locals.db = db;
  app.locals.hub = hub;

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use(authRouter(db));

  // Placeholder home; replaced in Task 11.
  app.get('/', requireAuth, (req, res) => res.send('home'));
  return app;
}
```

- [ ] **Step 7: Add `login(agent)` to `test/helpers.js`**

```js
import { seedUser } from '../src/auth.js';

export async function login(agent, db, username = 'abe', password = 'pw') {
  seedUser(db, username, password);
  await agent.post('/login').type('form').send({ username, password });
}
```

- [ ] **Step 8: Run tests**

Run: `node --test test/routes-auth.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(routes): add login/logout, layout, session wiring"
```

---

## Task 11: Time-tracking view + timer control routes + partials

**Files:**
- Create: `src/routes/tracking.js`, `src/views/tracking.ejs`, `src/views/partials/active-timer.ejs`, `src/views/partials/day-group.ejs`, `src/views/partials/session-row.ejs`, `test/routes-tracking.test.js`
- Modify: `src/app.js` (mount `trackingRouter`, remove placeholder home)

**Interfaces:**
- Consumes: `timer.js`, `sessions.js`, `settings.js`, `catalog.js`, `hub`.
- Produces: `trackingRouter(db, hub)`:
  - `GET /` → full tracking page.
  - `GET /partials/active-timer` → active-timer fragment.
  - `GET /partials/tracking-list` → grouped list fragment (query `from`,`to` optional; default: last 14 days).
  - `POST /timer/start`, `POST /timer/pause`, `POST /timer/stop`, `POST /timer/resume/:id` → mutate, `hub.broadcast()`, return active-timer fragment.
  - Helper `groupByDay(db, sessions, now, rounding)` → `[{key, label, sessions, totalMs, totalCents}]`, days sorted desc.
- Rendering helpers `fmtDuration(ms)` and `fmtMoney(cents)` are defined in `tracking.js` and passed to views via `res.locals`.

- [ ] **Step 1: Write `test/routes-tracking.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { getOpenSegment } from '../src/timer.js';

test('start creates a running timer and broadcasts', async () => {
  const events = [];
  const { app, db } = makeApp({ hub: { broadcast: (t) => events.push(t || 'changed'), handleConnection() {} } });
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/timer/start');
  assert.equal(res.status, 200);
  assert.ok(getOpenSegment(db));
  assert.deepEqual(events, ['changed']);
});

test('stop closes the open segment', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  await agent.post('/timer/start');
  await agent.post('/timer/stop');
  assert.equal(getOpenSegment(db), undefined);
});

test('tracking page shows a stopped session description', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  await agent.post('/timer/start');
  await agent.post('/timer/stop');
  const res = await agent.get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /Start work|Stop/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/routes-tracking.test.js`
Expected: FAIL (no timer routes).

- [ ] **Step 3: Implement `src/routes/tracking.js`**

```js
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
```

- [ ] **Step 4: Create `src/views/partials/active-timer.ejs`**

```html
<div id="active-timer" class="active-timer"
     hx-get="/partials/active-timer" hx-trigger="tt:changed from:body" hx-swap="outerHTML">
  <% if (state.running) { %>
    <div class="running" x-data="clock(<%= state.since %>)">
      <span class="dot"></span>
      <span class="label"><%= state.session.description || 'Working…' %></span>
      <span class="elapsed" x-text="text"></span>
      <form method="post" action="/timer/pause" hx-post="/timer/pause" hx-target="#active-timer" hx-swap="outerHTML">
        <button class="pause">Pause</button></form>
      <form method="post" action="/timer/stop" hx-post="/timer/stop" hx-target="#active-timer" hx-swap="outerHTML">
        <button class="stop">Stop</button></form>
    </div>
  <% } else { %>
    <form method="post" action="/timer/start" hx-post="/timer/start" hx-target="#active-timer" hx-swap="outerHTML">
      <button class="start">Start work</button>
    </form>
  <% } %>
</div>
```

- [ ] **Step 5: Create `src/views/partials/session-row.ejs`**

```html
<div class="session-row">
  <span class="bar" style="background: <%= s.task ? s.task.color : '#cbd5e1' %>"></span>
  <div class="meta">
    <div class="title">
      <%= s.description || '(no description)' %><% if (s.task) { %> · <span class="task"><%= s.task.name %></span><% } %>
    </div>
    <div class="tags">
      <% s.tags.forEach(t => { %><span class="tag" style="background: <%= t.color %>"><%= t.name %></span><% }) %>
    </div>
  </div>
  <span class="dur"><%= fmtDuration(s.roundedMs) %></span>
</div>
```

- [ ] **Step 6: Create `src/views/partials/day-group.ejs`**

```html
<section class="day-group" x-data="{ open: true }">
  <header @click="open = !open">
    <span class="chev" x-text="open ? '▾' : '▸'"></span>
    <span class="label"><%= g.label %></span>
    <span class="totals"><%= fmtMoney(g.totalCents) %> · <%= fmtDuration(g.totalMs) %></span>
  </header>
  <div class="rows" x-show="open">
    <% g.sessions.forEach(s => { %><%- include('session-row', { s, fmtDuration }) %><% }) %>
  </div>
</section>
```

- [ ] **Step 7: Create `src/views/tracking.ejs`**

Composes fragments into `body`, then renders the layout. `include(...)` returns the rendered partial as a string.

```html
<%
  const active = include('partials/active-timer', { state, fmtDuration });
  const list = include('partials/tracking-list', { groups, fmtDuration, fmtMoney });
  const body = `${active}
    <div id="tracking-list" hx-get="/partials/tracking-list" hx-trigger="tt:changed from:body" hx-swap="innerHTML">${list}</div>`;
%>
<%- include('layout', { title, nav, body }) %>
```

- [ ] **Step 8: Create `src/views/partials/tracking-list.ejs`**

```html
<% if (!groups.length) { %>
  <p class="empty">No sessions yet. Press “Start work”.</p>
<% } else { groups.forEach(g => { %>
  <%- include('day-group', { g, fmtDuration, fmtMoney }) %>
<% }) } %>
```

- [ ] **Step 9: Mount router in `src/app.js`**

Remove the placeholder `app.get('/', ...)` and add:

```js
import { trackingRouter } from './routes/tracking.js';
// ...after authRouter mount:
app.use(requireAuth, trackingRouter(db, hub));
```

- [ ] **Step 10: Run tests**

Run: `node --test test/routes-tracking.test.js`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(tracking): add view, timer controls, day grouping"
```

---

## Task 12: Tasks/sessions view (list, filters, edit, manual entry) + catalog create

**Files:**
- Create: `src/routes/sessions.js`, `src/views/tasks.ejs`, `src/views/partials/session-edit.ejs`, `src/views/partials/task-tag-pickers.ejs`, `test/routes-sessions.test.js`
- Modify: `src/app.js` (mount `sessionsRouter`)

**Interfaces:**
- Consumes: `sessions.js`, `catalog.js`, `settings.js`, `hub`, `fmtDuration`/`fmtMoney` from `tracking.js`.
- Produces: `sessionsRouter(db, hub)`:
  - `GET /tasks` → flat list page with filter controls.
  - `GET /partials/session-list` → filtered list fragment (query: `q, taskId, tagId, unlabelled, uncategorized`).
  - `GET /sessions/:id/edit` → edit form fragment.
  - `POST /sessions/:id` → update description/details/taskId/tags/segment times; broadcast; return row fragment.
  - `POST /sessions` → manual create (description, taskId, start, end ISO local → ms); broadcast; return list fragment.
  - `POST /sessions/:id/delete` → delete; broadcast; return empty.
  - `POST /tasks` → create task (name, color, rate). `POST /tags` → create tag. Return updated pickers fragment.
  - Helper `parseLocal(v)` → ms from `datetime-local` string.

- [ ] **Step 1: Write `test/routes-sessions.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { createSession, getSession } from '../src/sessions.js';
import { createTask, createTag } from '../src/catalog.js';

test('unlabelled filter lists only bare sessions', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  createSession(db, { description: 'labeled', segments: [{ start: 1, end: 2 }] });
  createSession(db, { segments: [{ start: 3, end: 4 }] });
  const res = await agent.get('/partials/session-list?unlabelled=1');
  assert.equal(res.status, 200);
  assert.match(res.text, /no description/);
  assert.doesNotMatch(res.text, /labeled/);
});

test('update session sets description, task, tags', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const t = createTask(db, { name: 'Paid' });
  const tag = createTag(db, { name: 'Bug' });
  const id = createSession(db, { segments: [{ start: 1, end: 2 }] });
  const res = await agent.post('/sessions/' + id).type('form')
    .send({ description: 'Fixed', taskId: String(t), tagId: String(tag) });
  assert.equal(res.status, 200);
  const s = getSession(db, id);
  assert.equal(s.description, 'Fixed');
  assert.equal(s.task_id, t);
  assert.deepEqual(s.tags.map(x => x.id), [tag]);
});

test('manual create adds a session', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  await agent.post('/sessions').type('form').send({
    description: 'Call', start: '2026-09-15T09:00', end: '2026-09-15T10:00',
  });
  const rows = db.prepare('SELECT COUNT(*) c FROM session').get().c;
  assert.equal(rows, 1);
});

test('delete removes session', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const id = createSession(db, { segments: [{ start: 1, end: 2 }] });
  await agent.post('/sessions/' + id + '/delete');
  assert.equal(getSession(db, id), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/routes-sessions.test.js`
Expected: FAIL (no routes).

- [ ] **Step 3: Implement `src/routes/sessions.js`**

```js
import express from 'express';
import { listSessions, getSession, updateSession, setSessionTags,
  createSession, deleteSession, updateSegment, decorateSession } from '../sessions.js';
import { listTasks, listTags, createTask, createTag } from '../catalog.js';
import { getSettings } from '../settings.js';
import { fmtDuration, fmtMoney } from './tracking.js';

function parseLocal(v) {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

function idsFrom(body, key) {
  const v = body[key];
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).map(Number).filter(Boolean);
}

export function sessionsRouter(db, hub) {
  const r = express.Router();
  const rounding = () => getSettings(db).rounding_minutes;

  function filterFrom(q) {
    return {
      q: q.q || undefined,
      taskId: q.taskId ? Number(q.taskId) : undefined,
      tagId: q.tagId ? Number(q.tagId) : undefined,
      unlabelled: q.unlabelled ? true : undefined,
      uncategorized: q.uncategorized ? true : undefined,
    };
  }

  function renderList(res, q) {
    const sessions = listSessions(db, filterFrom(q))
      .map(s => decorateSession(db, s, Date.now(), rounding()));
    res.render('partials/session-list', { sessions, fmtDuration, fmtMoney });
  }

  r.get('/tasks', (req, res) => {
    const sessions = listSessions(db, filterFrom(req.query))
      .map(s => decorateSession(db, s, Date.now(), rounding()));
    res.render('tasks', {
      title: 'Tasks', nav: 'tasks', sessions,
      tasks: listTasks(db), tags: listTags(db), q: req.query, fmtDuration, fmtMoney,
    });
  });

  r.get('/partials/session-list', (req, res) => renderList(res, req.query));

  r.get('/sessions/:id/edit', (req, res) => {
    const s = getSession(db, Number(req.params.id));
    res.render('partials/session-edit', { s, tasks: listTasks(db), tags: listTags(db) });
  });

  r.post('/sessions/:id', (req, res) => {
    const id = Number(req.params.id);
    updateSession(db, id, {
      description: req.body.description ?? '',
      details: req.body.details ?? '',
      taskId: req.body.taskId ? Number(req.body.taskId) : null,
    });
    setSessionTags(db, id, idsFrom(req.body, 'tagId'));
    const s = getSession(db, id);
    if (req.body.start && s.segments[0]) {
      updateSegment(db, s.segments[0].id, {
        start: parseLocal(req.body.start),
        end: parseLocal(req.body.end),
      });
    }
    hub.broadcast('changed');
    const decorated = decorateSession(db, getSession(db, id), Date.now(), rounding());
    res.render('partials/session-row', { s: decorated, fmtDuration });
  });

  r.post('/sessions', (req, res) => {
    const start = parseLocal(req.body.start), end = parseLocal(req.body.end);
    createSession(db, {
      description: req.body.description || '',
      taskId: req.body.taskId ? Number(req.body.taskId) : null,
      createdAt: start || Date.now(),
      segments: start ? [{ start, end }] : [],
    });
    hub.broadcast('changed');
    renderList(res, {});
  });

  r.post('/sessions/:id/delete', (req, res) => {
    deleteSession(db, Number(req.params.id));
    hub.broadcast('changed');
    res.status(200).end();
  });

  r.post('/tasks', (req, res) => {
    createTask(db, {
      name: req.body.name, color: req.body.color || '#3b82f6',
      hourlyRateCents: req.body.rate ? Math.round(Number(req.body.rate) * 100) : null,
    });
    res.render('partials/task-tag-pickers', { tasks: listTasks(db), tags: listTags(db), s: null });
  });

  r.post('/tags', (req, res) => {
    createTag(db, { name: req.body.name, color: req.body.color || '#6b7280' });
    res.render('partials/task-tag-pickers', { tasks: listTasks(db), tags: listTags(db), s: null });
  });

  return r;
}
```

- [ ] **Step 4: Create `src/views/partials/session-list.ejs`**

```html
<% if (!sessions.length) { %>
  <p class="empty">No matching sessions.</p>
<% } else { sessions.forEach(s => { %>
  <div class="session-item">
    <div hx-get="/sessions/<%= s.id %>/edit" hx-target="closest .session-item" hx-swap="outerHTML" class="clickable">
      <span class="bar" style="background: <%= s.task ? s.task.color : '#cbd5e1' %>"></span>
      <span class="title"><%= s.description || '(no description)' %><% if (s.task) { %> · <%= s.task.name %><% } %></span>
      <span class="dur"><%= fmtDuration(s.roundedMs) %></span>
    </div>
  </div>
<% }) } %>
```

- [ ] **Step 5: Create `src/views/partials/session-edit.ejs`**

```html
<form class="session-item editing" hx-post="/sessions/<%= s.id %>" hx-target="this" hx-swap="outerHTML">
  <input name="description" value="<%= s.description %>" placeholder="Description">
  <textarea name="details" placeholder="Details"><%= s.details %></textarea>
  <select name="taskId">
    <option value="">(no task)</option>
    <% tasks.forEach(t => { %>
      <option value="<%= t.id %>" <%= s.task_id === t.id ? 'selected' : '' %>><%= t.name %></option>
    <% }) %>
  </select>
  <fieldset class="tagpick">
    <% tags.forEach(t => { %>
      <label><input type="checkbox" name="tagId" value="<%= t.id %>"
        <%= s.tags.some(x => x.id === t.id) ? 'checked' : '' %>> <%= t.name %></label>
    <% }) %>
  </fieldset>
  <% if (s.segments[0]) { %>
    <input type="datetime-local" name="start"
      value="<%= new Date(s.segments[0].start_utc).toISOString().slice(0,16) %>">
    <input type="datetime-local" name="end"
      value="<%= s.segments[0].end_utc ? new Date(s.segments[0].end_utc).toISOString().slice(0,16) : '' %>">
  <% } %>
  <div class="actions">
    <button type="submit">Save</button>
    <button type="button" hx-post="/sessions/<%= s.id %>/delete"
      hx-target="closest .session-item" hx-swap="outerHTML" class="danger">Delete</button>
  </div>
</form>
```

- [ ] **Step 6: Create `src/views/partials/task-tag-pickers.ejs`**

```html
<div id="pickers">
  <details>
    <summary>New task</summary>
    <form hx-post="/tasks" hx-target="#pickers" hx-swap="outerHTML">
      <input name="name" placeholder="Task name" required>
      <input name="color" type="color" value="#3b82f6">
      <input name="rate" type="number" step="0.01" placeholder="Rate/hr">
      <button>Add task</button>
    </form>
  </details>
  <details>
    <summary>New tag</summary>
    <form hx-post="/tags" hx-target="#pickers" hx-swap="outerHTML">
      <input name="name" placeholder="Tag name" required>
      <input name="color" type="color" value="#6b7280">
      <button>Add tag</button>
    </form>
  </details>
</div>
```

- [ ] **Step 7: Create `src/views/tasks.ejs`**

```html
<%
  const list = include('partials/session-list', { sessions, fmtDuration, fmtMoney });
  const pickers = include('partials/task-tag-pickers', { tasks, tags, s: null });
  const body = `
    <h1>Tasks</h1>
    <form class="filters" hx-get="/partials/session-list" hx-target="#session-list" hx-swap="innerHTML" hx-trigger="change, submit">
      <input name="q" placeholder="Search description" value="${q.q || ''}">
      <label><input type="checkbox" name="unlabelled" value="1" ${q.unlabelled ? 'checked' : ''}> Unlabelled</label>
      <label><input type="checkbox" name="uncategorized" value="1" ${q.uncategorized ? 'checked' : ''}> Uncategorized</label>
    </form>
    ${pickers}
    <form class="manual" hx-post="/sessions" hx-target="#session-list" hx-swap="innerHTML">
      <input name="description" placeholder="Description">
      <input type="datetime-local" name="start" required>
      <input type="datetime-local" name="end">
      <button>Add work unit</button>
    </form>
    <div id="session-list" hx-get="/partials/session-list" hx-trigger="tt:changed from:body" hx-swap="innerHTML">${list}</div>`;
%>
<%- include('layout', { title, nav, body }) %>
```

- [ ] **Step 8: Mount router in `src/app.js`**

```js
import { sessionsRouter } from './routes/sessions.js';
// after trackingRouter mount:
app.use(requireAuth, sessionsRouter(db, hub));
```

- [ ] **Step 9: Run tests**

Run: `node --test test/routes-sessions.test.js`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(sessions): add tasks view, filters, edit, manual entry"
```

---

## Task 13: Settings view + route

**Files:**
- Create: `src/routes/settings.js`, `src/views/settings.ejs`, `test/routes-settings.test.js`
- Modify: `src/app.js` (mount `settingsRouter`)

**Interfaces:**
- Consumes: `settings.js`, `hub`.
- Produces: `settingsRouter(db, hub)`: `GET /settings` (form), `POST /settings` (update rounding, broadcast, redirect to `/settings`). Invalid value re-renders with an error.

- [ ] **Step 1: Write `test/routes-settings.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { getSettings } from '../src/settings.js';

test('settings page shows rounding options', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.get('/settings');
  assert.equal(res.status, 200);
  assert.match(res.text, /Rounding/);
});

test('posting rounding updates settings', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/settings').type('form').send({ roundingMinutes: '30' });
  assert.equal(res.status, 302);
  assert.equal(getSettings(db).rounding_minutes, 30);
});

test('invalid rounding re-renders with error', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/settings').type('form').send({ roundingMinutes: '7' });
  assert.equal(res.status, 200);
  assert.match(res.text, /Invalid/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/routes-settings.test.js`
Expected: FAIL (no route).

- [ ] **Step 3: Implement `src/routes/settings.js`**

```js
import express from 'express';
import { getSettings, updateSettings } from '../settings.js';

export function settingsRouter(db, hub) {
  const r = express.Router();
  r.get('/settings', (req, res) =>
    res.render('settings', { title: 'Settings', nav: 'settings', settings: getSettings(db), error: null }));
  r.post('/settings', (req, res) => {
    try {
      updateSettings(db, { roundingMinutes: req.body.roundingMinutes });
      hub.broadcast('changed');
      res.redirect('/settings');
    } catch {
      res.render('settings', { title: 'Settings', nav: 'settings', settings: getSettings(db), error: 'Invalid rounding value' });
    }
  });
  return r;
}
```

- [ ] **Step 4: Create `src/views/settings.ejs`**

```html
<%
  const opts = [[0,'Off'],[15,'Nearest 15 min'],[30,'Nearest 30 min'],[60,'Nearest 1 hour']];
  const radios = opts.map(([v,label]) =>
    `<label><input type="radio" name="roundingMinutes" value="${v}" ${settings.rounding_minutes===v?'checked':''}> ${label}</label>`
  ).join('');
  const body = `
    <h1>Settings</h1>
    ${error ? `<p class="err">${error}</p>` : ''}
    <form method="post" action="/settings" class="settings">
      <fieldset><legend>Rounding</legend>${radios}</fieldset>
      <button type="submit">Save</button>
    </form>`;
%>
<%- include('layout', { title, nav, body }) %>
```

- [ ] **Step 5: Mount router in `src/app.js`**

```js
import { settingsRouter } from './routes/settings.js';
// after sessionsRouter mount:
app.use(requireAuth, settingsRouter(db, hub));
```

- [ ] **Step 6: Run tests**

Run: `node --test test/routes-settings.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(settings): add settings page and rounding update"
```

---

## Task 14: Frontend assets (CSS, WS client, Alpine clock) + vendor libs

**Files:**
- Create: `public/app.css`, `public/app.js`, `public/vendor/htmx.min.js`, `public/vendor/alpine.min.js`

**Interfaces:**
- Consumes: htmx `tt:changed` event convention from views; `clock(since)` Alpine component used in `active-timer.ejs`.
- Produces: `public/app.js` opens a WS to `/ws`, on `{type:'changed'}` dispatches `tt:changed` on `document.body` (triggers every `hx-trigger="tt:changed from:body"`), reconnects with backoff, and registers the Alpine `clock` component.

- [ ] **Step 1: Vendor htmx and Alpine**

Run:
```bash
mkdir -p public/vendor
curl -fsSL https://unpkg.com/htmx.org@2.0.3/dist/htmx.min.js -o public/vendor/htmx.min.js
curl -fsSL https://unpkg.com/alpinejs@3.14.1/dist/cdn.min.js -o public/vendor/alpine.min.js
```
Expected: both files exist and are non-empty (`wc -c public/vendor/*.js`).

- [ ] **Step 2: Create `public/app.js`**

```js
// Live-sync client: WS -> htmx refresh; Alpine running clock.
(function () {
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    let backoff = 500;
    ws.onmessage = (e) => {
      try {
        if (JSON.parse(e.data).type === 'changed') {
          document.body.dispatchEvent(new Event('tt:changed'));
        }
      } catch {}
    };
    ws.onopen = () => { backoff = 500; };
    ws.onclose = () => { setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 10000); };
    ws.onerror = () => ws.close();
  }
  connect();

  document.addEventListener('alpine:init', () => {
    window.Alpine.data('clock', (since) => ({
      text: '0:00',
      init() {
        const tick = () => {
          const s = Math.floor((Date.now() - since) / 1000);
          const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
          this.text = (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(sec).padStart(2, '0');
        };
        tick();
        setInterval(tick, 1000);
      },
    }));
  });
})();
```

- [ ] **Step 3: Create `public/app.css`** (mobile-first; big tap targets, readable on desktop)

```css
:root { --bg:#f7f8fa; --card:#fff; --line:#e5e7eb; --ink:#111827; --muted:#6b7280; --accent:#16a34a; }
* { box-sizing: border-box; }
body { margin:0; font:16px/1.45 system-ui, sans-serif; background:var(--bg); color:var(--ink); }
main { max-width: 720px; margin: 0 auto; padding: 16px; }
h1 { font-size: 1.6rem; margin: .5rem 0 1rem; }
button { font: inherit; padding: .7rem 1rem; border:0; border-radius:10px; background:#e5e7eb; cursor:pointer; }
button.start { background: var(--accent); color:#fff; width:100%; font-size:1.15rem; padding:1rem; }
button.stop { background:#dc2626; color:#fff; }
button.pause { background:#f59e0b; color:#fff; }
button.danger { background:#dc2626; color:#fff; }
input, select, textarea { font: inherit; padding:.6rem; border:1px solid var(--line); border-radius:8px; width:100%; }
.topnav { display:flex; gap:.5rem; align-items:center; padding:.6rem 16px; background:var(--card); border-bottom:1px solid var(--line); }
.topnav a { text-decoration:none; color:var(--muted); padding:.4rem .6rem; border-radius:8px; }
.topnav a.active { color:var(--ink); background:#eef2ff; }
.topnav .logout { margin-left:auto; }
.active-timer { margin-bottom:1rem; }
.active-timer .running { display:flex; align-items:center; gap:.6rem; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:.8rem; }
.active-timer .dot { width:10px; height:10px; border-radius:50%; background:var(--accent); }
.active-timer .elapsed { margin-left:auto; font-variant-numeric: tabular-nums; font-weight:600; }
.day-group { background:var(--card); border:1px solid var(--line); border-radius:12px; margin-bottom:.8rem; overflow:hidden; }
.day-group header { display:flex; gap:.5rem; align-items:center; padding:.8rem; cursor:pointer; background:#fafafa; }
.day-group .totals { margin-left:auto; color:var(--muted); }
.session-row, .session-item .clickable { display:flex; gap:.6rem; align-items:center; padding:.7rem .8rem; border-top:1px solid var(--line); }
.session-row .bar, .session-item .bar { width:4px; align-self:stretch; border-radius:3px; }
.session-row .dur, .session-item .dur { margin-left:auto; color:var(--muted); }
.tag { color:#fff; font-size:.75rem; padding:.05rem .4rem; border-radius:6px; margin-right:.25rem; }
.session-item.editing { display:grid; gap:.5rem; padding:.8rem; border:1px solid var(--line); border-radius:12px; background:var(--card); }
.tagpick { display:flex; flex-wrap:wrap; gap:.5rem; border:0; }
.tagpick label { width:auto; }
.filters, .manual, .settings { display:grid; gap:.5rem; margin-bottom:1rem; }
.login { max-width:340px; margin:12vh auto; display:grid; gap:.7rem; background:var(--card); padding:1.5rem; border-radius:14px; border:1px solid var(--line); }
.err { color:#dc2626; }
.empty { color:var(--muted); text-align:center; padding:2rem 0; }
@media (min-width:640px){ main{ padding:24px; } }
```

- [ ] **Step 4: Verify assets present**

Run: `wc -c public/vendor/*.js public/app.js public/app.css`
Expected: all non-zero.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): add css, ws live-sync client, running clock"
```

---

## Task 15: Server entrypoint (http + ws) + end-to-end smoke

**Files:**
- Create: `src/server.js`, `test/smoke.test.js`

**Interfaces:**
- Consumes: `openDb`, `createApp`, `createHub`, `buildSessionMiddleware`, `ws`.
- Produces: `src/server.js` boots the real app: opens DB at `DB_PATH || data.sqlite`, creates the hub, attaches a `WebSocketServer` at path `/ws` gated by the shared session middleware, and listens on `PORT || 3000`. Exports nothing (side-effecting entry).

- [ ] **Step 1: Write `test/smoke.test.js`** (full stack against a temp file DB, real listen)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createHub } from '../src/ws.js';
import { seedUser } from '../src/auth.js';

test('end-to-end: login, start, stop, see session', async () => {
  const db = openDb(':memory:');
  const app = createApp({ db, hub: createHub() });
  seedUser(db, 'abe', 'pw');
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: 'abe', password: 'pw' });
  await agent.post('/timer/start');
  await agent.post('/timer/stop');
  const home = await agent.get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /Start work/);
  const tasks = await agent.get('/tasks');
  assert.match(tasks.text, /Tasks/);
});
```

- [ ] **Step 2: Run test to verify it passes with existing code**

Run: `node --test test/smoke.test.js`
Expected: PASS (exercises Tasks 1–14).

- [ ] **Step 3: Implement `src/server.js`**

```js
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createHub } from './ws.js';
import { buildSessionMiddleware } from './auth.js';

const db = openDb(process.env.DB_PATH || 'data.sqlite');
const hub = createHub();
const app = createApp({ db, hub });
const server = http.createServer(app);

const sessionMw = buildSessionMiddleware(db);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) return socket.destroy();
  sessionMw(req, {}, () => {
    if (!req.session || !req.session.userId) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => hub.handleConnection(ws));
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Time tracker on :${port}`));
```

> Note: `createApp` and `server.js` each build their own session middleware from the same `db`/store, so cookies validate identically across HTTP and WS upgrades.

- [ ] **Step 4: Manual boot check**

Run:
```bash
TT_USERNAME=abe TT_PASSWORD=pw npm run seed
PORT=3000 npm start &
sleep 1 && curl -s localhost:3000/health && kill %1
```
Expected: `{"ok":true}`.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server): add http+ws entrypoint and e2e smoke"
```

---

## Self-Review Notes

- **Spec coverage:** auth (T4/T10), data model (T2), timer state machine (T8), realtime sync (T9/T14/T15), time-tracking view (T11), tasks/sessions view + filters (T12), settings + rounding (T7/T13), module boundaries (all), error handling (invalid rounding T13, requireAuth T4/T10, single-open invariant T2/T8), testing (every task). Deferred items remain deferred.
- **Rounding:** applied to displayed/earned values via `decorateSession`; running sessions unrounded (T6 test asserts). Raw segment times never mutated.
- **Type consistency:** `decorateSession(db, session, now, roundingMinutes)`, `timerState(db, now)`, `fmtDuration(ms)`, `fmtMoney(cents)`, `createHub().broadcast(type)` used identically across tasks.
- **WS auth:** gated by shared session middleware on upgrade (T15).
- **Known follow-up:** EJS `include(...)` returns rendered strings (used for composition in T11/T12/T13); if a future EJS version changes this, switch to partial `<%- include %>` inline. Not a blocker for v1.
