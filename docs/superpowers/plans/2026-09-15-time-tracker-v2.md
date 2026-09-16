# Time Tracker v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the shipped time tracker: drop multi-segment sessions for a start/stop/paused-ms model, ceil rounding, `.env` config, edit-while-running with description autocomplete, and an app-like responsive UI with dark mode and tag chips.

**Architecture:** Same stack (Express + better-sqlite3 + EJS + htmx + Alpine + ws). A session is now self-contained (`start_utc`, `end_utc`, `paused_ms`, `pause_started_at`); the `segment` table is removed. Pure duration/rounding helpers stay in `calc.js`. Autocomplete prefills a shared `wu-fields` fragment via an htmx per-form swap (no global OOB ids).

**Tech Stack:** Node 20+ (ESM, `node:test`), Express, better-sqlite3, better-sqlite3-session-store, express-session, bcryptjs, ws, ejs, dotenv. Dev: supertest.

## Global Constraints

- Node 20+, ESM only (`"type":"module"`). No TypeScript, no bundler.
- Minimal client JS: htmx + Alpine only. Do NOT use the frontend-design skill.
- Times INTEGER epoch ms, treated as UTC wall-clock. Money INTEGER cents.
- Rounding is **ceil (round up)** to the next increment; 0 stays 0; exact multiples stay.
- Single user; single active session invariant (`session WHERE end_utc IS NULL`).
- **Destructive schema change** — no data preservation; delete any existing `data.sqlite`. Tests use `:memory:`.
- Dark mode via `@media (prefers-color-scheme: dark)` only (no toggle).
- Every logic module takes an injected `db`. Route tests use supertest; run them with the sandbox disabled (they bind a port) and the suite must exit on its own (do NOT add `--test-force-exit`).
- Commit style `<type>(<scope>): <subject>`, imperative, ≤50 chars, no Claude co-author.

## File Structure (changes only)

```
.env.sample                         NEW — documented config
package.json                        MODIFY — add dotenv
scripts/seed-user.js                MODIFY — load dotenv
src/server.js                       MODIFY — load dotenv
src/db.js                           MODIFY — session columns, drop segment
src/calc.js                         REWRITE — roundUpDurationMs, sessionDurationMs
src/sessions.js                     REWRITE — start/end model, autocomplete helpers
src/timer.js                        REWRITE — pause-ms state machine
src/routes/tracking.js             MODIFY — start_utc grouping, resume(no id), /timer/update
src/routes/sessions.js             MODIFY — start/end create+edit, /sessions/template
src/views/partials/active-timer.ejs REWRITE — running/paused, inline edit, clock base
src/views/partials/wu-fields.ejs    NEW — details+task+tag-chips (shared, autocomplete target)
src/views/partials/session-edit.ejs MODIFY — start_utc/end_utc + wu-fields
src/views/partials/session-item.ejs MODIFY — tag chips
src/views/partials/session-row.ejs  MODIFY — tag chips styling
src/views/tracking.ejs              MODIFY — datalist of descriptions
src/views/tasks.ejs                 MODIFY — manual form uses wu-fields + datalist
src/views/settings.ejs              MODIFY — "Round up to next", segmented control
src/views/layout.ejs                MODIFY — bottom action/tab bar + side rail
public/app.css                      REWRITE — theming, dark mode, chips, responsive
public/app.js                       MODIFY — clock(elapsedMs, running)
test/*                              MODIFY/ADD — adapt to new model
```

---

## Task 1: Config via `.env` + `.env.sample`

**Files:**
- Modify: `package.json`, `src/server.js`, `scripts/seed-user.js`
- Create: `.env.sample`

**Interfaces:**
- Produces: `dotenv` loaded before any `process.env` read in the two entrypoints. `.env.sample` documents every var.

- [ ] **Step 1: Add dotenv dependency**

Edit `package.json` dependencies, add:
```json
"dotenv": "^16.4.5"
```
Run: `npm install` (sandbox disabled if needed).

- [ ] **Step 2: Create `.env.sample`**

```
# Copy to .env and edit. .env is gitignored.
# HTTP port
PORT=3000
# SQLite database file path
DB_PATH=data.sqlite
# Session signing secret (REQUIRED in production). Generate: openssl rand -hex 32
SESSION_SECRET=change-me
# Set to 1 to mark the session cookie Secure (serve over HTTPS)
COOKIE_SECURE=0
# production enables the SESSION_SECRET guard and secure cookie default
NODE_ENV=development
# Only used by `npm run seed` to create/update the single user
TT_USERNAME=me
TT_PASSWORD=change-me
```

- [ ] **Step 3: Load dotenv in `src/server.js`**

Add as the very first import line:
```js
import 'dotenv/config';
```

- [ ] **Step 4: Load dotenv in `scripts/seed-user.js`**

Add as the very first line:
```js
import 'dotenv/config';
```

- [ ] **Step 5: Verify wiring**

Run: `node -e "process.env.DB_PATH=':memory:'; import('./src/app.js').then(()=>console.log('ok'))"` (sandbox disabled)
Expected: prints `ok` (imports resolve; dotenv present).
Run: `npm test`
Expected: existing suite still passes (config change doesn't break anything).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(config): load .env and add .env.sample"
```

---

## Task 2: Data model — session columns, drop segment, ceil calc

**Files:**
- Modify: `src/db.js`, `test/db.test.js`
- Rewrite: `src/calc.js`, `test/calc.test.js`

**Interfaces:**
- Produces:
  - `session` table columns: `id, description, details, task_id, created_at, start_utc, end_utc, paused_ms (default 0), pause_started_at`. No `segment` table. Unique index `one_active_session ON session((1)) WHERE end_utc IS NULL`.
  - `roundUpDurationMs(ms, minutes)` → ceil to increment; `minutes===0` returns `ms`; `0`→`0`.
  - `sessionDurationMs(session, now)` → `(end_utc ?? now) - start_utc - paused_ms - (pause_started_at ? now - pause_started_at : 0)`.
  - `earningsCents(durationMs, rateCents)` unchanged.

- [ ] **Step 1: Rewrite `test/calc.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundUpDurationMs, sessionDurationMs, earningsCents } from '../src/calc.js';

const MIN = 60000;

test('rounding off returns raw ms', () => {
  assert.equal(roundUpDurationMs(7 * MIN, 0), 7 * MIN);
});

test('ceil: 0 stays 0, exact multiple stays, else rounds up', () => {
  assert.equal(roundUpDurationMs(0, 15), 0);
  assert.equal(roundUpDurationMs(1 * MIN, 15), 15 * MIN);
  assert.equal(roundUpDurationMs(15 * MIN, 15), 15 * MIN);
  assert.equal(roundUpDurationMs(16 * MIN, 15), 30 * MIN);
  assert.equal(roundUpDurationMs(31 * MIN, 30), 60 * MIN);
  assert.equal(roundUpDurationMs(61 * MIN, 60), 120 * MIN);
});

test('duration without pause is end-start', () => {
  assert.equal(sessionDurationMs({ start_utc: 0, end_utc: 10 * MIN, paused_ms: 0, pause_started_at: null }, 999), 10 * MIN);
});

test('running session counts to now', () => {
  assert.equal(sessionDurationMs({ start_utc: 0, end_utc: null, paused_ms: 0, pause_started_at: null }, 5 * MIN), 5 * MIN);
});

test('paused_ms subtracts from duration', () => {
  assert.equal(sessionDurationMs({ start_utc: 0, end_utc: 30 * MIN, paused_ms: 10 * MIN, pause_started_at: null }, 999), 20 * MIN);
});

test('currently paused freezes elapsed', () => {
  // started at 0, paused at 10min, now 25min -> elapsed frozen at 10min
  assert.equal(sessionDurationMs({ start_utc: 0, end_utc: null, paused_ms: 0, pause_started_at: 10 * MIN }, 25 * MIN), 10 * MIN);
});

test('earnings from duration and rate', () => {
  assert.equal(earningsCents(3600000, 4000), 4000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/calc.test.js` (sandbox disabled)
Expected: FAIL (exports not defined).

- [ ] **Step 3: Rewrite `src/calc.js`**

```js
export function roundUpDurationMs(ms, minutes) {
  if (!minutes) return ms;
  const interval = minutes * 60000;
  return Math.ceil(ms / interval) * interval;
}

export function sessionDurationMs(s, now) {
  const end = s.end_utc == null ? now : s.end_utc;
  const currentPause = s.pause_started_at == null ? 0 : now - s.pause_started_at;
  return (end - s.start_utc) - (s.paused_ms || 0) - currentPause;
}

export function earningsCents(durationMs, rateCents) {
  return Math.round((durationMs / 3600000) * rateCents);
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/calc.test.js`
Expected: PASS.

- [ ] **Step 5: Update `src/db.js` schema**

Replace the `session` CREATE, remove the `segment` table + `one_open_segment` index, add `one_active_session`. The `SCHEMA` string's session/segment sections become:

```sql
CREATE TABLE IF NOT EXISTS session (
  id INTEGER PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  task_id INTEGER REFERENCES task(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  start_utc INTEGER,
  end_utc INTEGER,
  paused_ms INTEGER NOT NULL DEFAULT 0,
  pause_started_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_session
  ON session((1)) WHERE end_utc IS NULL;
```

Delete the entire `CREATE TABLE ... segment ...` block and the `one_open_segment` index. Keep `session_tag`, `settings`, etc. unchanged.

- [ ] **Step 6: Update `test/db.test.js`**

Replace the tables list assertion to drop `segment`, and replace the "only one open segment" test with a single-active-session test:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';

test('migrations create all tables (no segment)', () => {
  const db = openDb(':memory:');
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  for (const t of ['user','client','task','tag','session','session_tag','settings']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
  assert.ok(!names.includes('segment'), 'segment table should be gone');
});

test('settings row seeded with defaults', () => {
  const db = openDb(':memory:');
  const s = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  assert.equal(s.rounding_minutes, 0);
});

test('only one active session allowed', () => {
  const db = openDb(':memory:');
  const ins = db.prepare('INSERT INTO session (created_at, start_utc, end_utc) VALUES (?, ?, NULL)');
  ins.run(1, 1);
  assert.throws(() => ins.run(2, 2));
});
```

- [ ] **Step 7: Run tests**

Run: `node --test test/db.test.js test/calc.test.js`
Expected: PASS. (Other suites will fail until Tasks 3-4; that's expected mid-migration.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(model): session start/end/paused, ceil rounding"
```

---

## Task 3: sessions.js — start/end model + autocomplete helpers

**Files:**
- Rewrite: `src/sessions.js`, `test/sessions.test.js`

**Interfaces:**
- Consumes: `calc.js` (`sessionDurationMs`, `roundUpDurationMs`, `earningsCents`), `catalog.js` (`effectiveRateCents`).
- Produces:
  - `createSession(db, { description='', details='', taskId=null, startUtc, endUtc=null, pausedMs=0, pauseStartedAt=null, createdAt=Date.now() })` → id.
  - `getSession(db, id)` → `{...row, tags, task}` or undefined (no `segments`).
  - `updateSession(db, id, fields)` — partial; keys: `description, details, taskId, startUtc, endUtc, pausedMs, pauseStartedAt`.
  - `setSessionTags(db, id, tagIds)`, `deleteSession(db, id)` — unchanged behavior.
  - `listSessions(db, filter)` — filters `q, taskId, tagId, unlabelled, uncategorized, from, to`; range on `COALESCE(end_utc,start_utc)>=from` and `start_utc<=to`; order `start_utc DESC, id DESC`.
  - `decorateSession(db, session, now, roundingMinutes)` → adds `running, paused, active, durationMs, roundedMs, earningsCents`. `roundedMs` = raw when active, else `roundUpDurationMs`.
  - `distinctDescriptions(db, q='', limit=8)` → array of non-empty descriptions, most recent first, matching LIKE `%q%`.
  - `latestByDescription(db, description)` → `{ details, task_id, task, tags }` of the most recent session with that exact description, or null.

- [ ] **Step 1: Rewrite `test/sessions.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createTask } from '../src/catalog.js';
import { createSession, getSession, updateSession, setSessionTags,
  deleteSession, listSessions, decorateSession,
  distinctDescriptions, latestByDescription } from '../src/sessions.js';

const MIN = 60000;

test('create with start/end, read back (no segments key needed)', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { description: 'Work', startUtc: 0, endUtc: 10 * MIN });
  const s = getSession(db, id);
  assert.equal(s.description, 'Work');
  assert.equal(s.start_utc, 0);
  assert.equal(s.end_utc, 10 * MIN);
});

test('update applies only given fields incl times', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { description: 'A', details: 'keep', startUtc: 0, endUtc: MIN });
  updateSession(db, id, { description: 'B', endUtc: 5 * MIN });
  const s = getSession(db, id);
  assert.equal(s.description, 'B');
  assert.equal(s.details, 'keep');
  assert.equal(s.end_utc, 5 * MIN);
});

test('setSessionTags replaces set', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { startUtc: 0, endUtc: 1 });
  db.prepare("INSERT INTO tag (id,name) VALUES (1,'x'),(2,'y')").run();
  setSessionTags(db, id, [1, 2]);
  setSessionTags(db, id, [2]);
  assert.deepEqual(getSession(db, id).tags.map(t => t.id), [2]);
});

test('decorate: stopped rounds up, running raw', () => {
  const db = openDb(':memory:');
  const t = createTask(db, { name: 'Paid', hourlyRateCents: 6000 });
  const stopped = createSession(db, { taskId: t, startUtc: 0, endUtc: 23 * MIN });
  const ds = decorateSession(db, getSession(db, stopped), 999, 15);
  assert.equal(ds.durationMs, 23 * MIN);
  assert.equal(ds.roundedMs, 30 * MIN);            // ceil
  assert.equal(ds.earningsCents, 3000);            // 30min @ $60/h
  const running = createSession(db, { taskId: t, startUtc: 0, endUtc: null });
  const dr = decorateSession(db, getSession(db, running), 23 * MIN, 15);
  assert.equal(dr.running, true);
  assert.equal(dr.roundedMs, 23 * MIN);            // raw while running
});

test('filters unlabelled/uncategorized', () => {
  const db = openDb(':memory:');
  const t = createTask(db, { name: 'T' });
  createSession(db, { description: 'x', taskId: t, startUtc: 1, endUtc: 2 });
  const bare = createSession(db, { startUtc: 3, endUtc: 4 });
  assert.deepEqual(listSessions(db, { unlabelled: true }).map(s => s.id), [bare]);
  assert.deepEqual(listSessions(db, { uncategorized: true }).map(s => s.id), [bare]);
});

test('delete removes session', () => {
  const db = openDb(':memory:');
  const id = createSession(db, { startUtc: 0, endUtc: 1 });
  deleteSession(db, id);
  assert.equal(getSession(db, id), undefined);
});

test('autocomplete: distinct descriptions and template', () => {
  const db = openDb(':memory:');
  const t = createTask(db, { name: 'Dev' });
  const older = createSession(db, { description: 'Bug fix', details: 'old', taskId: t, startUtc: 0, endUtc: 1 });
  db.prepare("INSERT INTO tag (id,name) VALUES (1,'urgent')").run();
  setSessionTags(db, older, [1]);
  const newer = createSession(db, { description: 'Bug fix', details: 'new', taskId: t, startUtc: 10, endUtc: 11 });
  setSessionTags(db, newer, [1]);
  createSession(db, { description: 'Other', startUtc: 20, endUtc: 21 });
  assert.deepEqual(distinctDescriptions(db, 'Bug'), ['Bug fix']);
  const tpl = latestByDescription(db, 'Bug fix');
  assert.equal(tpl.details, 'new');       // most recent
  assert.equal(tpl.task_id, t);
  assert.deepEqual(tpl.tags.map(x => x.id), [1]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sessions.test.js`
Expected: FAIL.

- [ ] **Step 3: Rewrite `src/sessions.js`**

```js
import { sessionDurationMs, roundUpDurationMs, earningsCents } from './calc.js';
import { effectiveRateCents } from './catalog.js';

export function createSession(db, {
  description = '', details = '', taskId = null,
  startUtc, endUtc = null, pausedMs = 0, pauseStartedAt = null,
  createdAt = Date.now(),
} = {}) {
  return db.prepare(
    `INSERT INTO session (description, details, task_id, created_at, start_utc, end_utc, paused_ms, pause_started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(description, details, taskId, createdAt, startUtc, endUtc, pausedMs, pauseStartedAt).lastInsertRowid;
}

const COLS = {
  description: 'description', details: 'details', taskId: 'task_id',
  startUtc: 'start_utc', endUtc: 'end_utc', pausedMs: 'paused_ms', pauseStartedAt: 'pause_started_at',
};

export function updateSession(db, id, fields) {
  const sets = [], vals = [];
  for (const [key, col] of Object.entries(COLS)) {
    if (key in fields) { sets.push(`${col} = ?`); vals.push(fields[key]); }
  }
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

function hydrate(db, row) {
  const tags = db.prepare(
    `SELECT tag.* FROM tag JOIN session_tag st ON st.tag_id = tag.id
     WHERE st.session_id = ? ORDER BY tag.name`
  ).all(row.id);
  const task = row.task_id ? db.prepare('SELECT * FROM task WHERE id = ?').get(row.task_id) : null;
  return { ...row, tags, task };
}

export function getSession(db, id) {
  const row = db.prepare('SELECT * FROM session WHERE id = ?').get(id);
  return row ? hydrate(db, row) : undefined;
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
  if (filter.from != null) { where.push('COALESCE(s.end_utc, s.start_utc) >= ?'); vals.push(filter.from); }
  if (filter.to != null) { where.push('s.start_utc <= ?'); vals.push(filter.to); }
  const sql = `SELECT * FROM session s
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.start_utc DESC, s.id DESC`;
  return db.prepare(sql).all(...vals).map(row => hydrate(db, row));
}

export function decorateSession(db, session, now, roundingMinutes) {
  const active = session.end_utc == null;
  const paused = active && session.pause_started_at != null;
  const running = active && !paused;
  const durationMs = sessionDurationMs(session, now);
  const roundedMs = active ? durationMs : roundUpDurationMs(durationMs, roundingMinutes);
  const rate = effectiveRateCents(db, session.task_id);
  return { ...session, active, paused, running, durationMs, roundedMs, earningsCents: earningsCents(roundedMs, rate) };
}

export function distinctDescriptions(db, q = '', limit = 8) {
  return db.prepare(
    `SELECT description, MAX(start_utc) AS last FROM session
     WHERE description <> '' AND description LIKE ?
     GROUP BY description ORDER BY last DESC LIMIT ?`
  ).all('%' + q + '%', limit).map(r => r.description);
}

export function latestByDescription(db, description) {
  const row = db.prepare(
    `SELECT * FROM session WHERE description = ? ORDER BY start_utc DESC, id DESC LIMIT 1`
  ).get(description);
  if (!row) return null;
  const h = hydrate(db, row);
  return { details: h.details, task_id: h.task_id, task: h.task, tags: h.tags };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/sessions.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sessions): start/end model + autocomplete helpers"
```

---

## Task 4: timer.js — pause-ms state machine

**Files:**
- Rewrite: `src/timer.js`, `test/timer.test.js`

**Interfaces:**
- Consumes: `sessions.js` (`createSession`, `getSession`, `updateSession`, `decorateSession`), `settings.js` (`getSettings`).
- Produces:
  - `getActiveSession(db)` → row with `end_utc IS NULL`, or undefined.
  - `startTimer(db, now, {taskId=null, description=''}={})` → id. Stops any active session first (fold pause, set end), then inserts a running session (`startUtc=now, endUtc=null, pausedMs=0, pauseStartedAt=null`).
  - `pauseTimer(db, now)` → id|null. Sets `pause_started_at=now` if running.
  - `resumeTimer(db, now)` → id|null. Folds pause: `paused_ms += now - pause_started_at`, clears `pause_started_at`.
  - `stopTimer(db, now)` → id|null. Folds any pause, sets `end_utc=now`, clears `pause_started_at`.
  - `timerState(db, now)` → `{ state: 'running'|'paused'|'none', session: <decorated>|null, elapsedMs: number }`.

- [ ] **Step 1: Rewrite `test/timer.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { getSession } from '../src/sessions.js';
import { startTimer, pauseTimer, resumeTimer, stopTimer, getActiveSession, timerState } from '../src/timer.js';

const MIN = 60000;

test('start creates a running session', () => {
  const db = openDb(':memory:');
  const id = startTimer(db, 1000);
  const a = getActiveSession(db);
  assert.equal(a.id, id);
  assert.equal(a.end_utc, null);
  assert.equal(timerState(db, 2000).state, 'running');
});

test('starting again stops the previous active session', () => {
  const db = openDb(':memory:');
  const first = startTimer(db, 0);
  startTimer(db, 5 * MIN);
  assert.equal(getSession(db, first).end_utc, 5 * MIN);
});

test('pause then resume accumulates paused_ms in same session', () => {
  const db = openDb(':memory:');
  const id = startTimer(db, 0);
  pauseTimer(db, 10 * MIN);
  assert.equal(timerState(db, 12 * MIN).state, 'paused');
  assert.equal(timerState(db, 12 * MIN).elapsedMs, 10 * MIN); // frozen
  resumeTimer(db, 20 * MIN);
  const s = getSession(db, id);
  assert.equal(s.paused_ms, 10 * MIN);
  assert.equal(s.pause_started_at, null);
  assert.equal(timerState(db, 25 * MIN).elapsedMs, 15 * MIN); // 25 - 10 paused
});

test('stop while paused folds the open pause', () => {
  const db = openDb(':memory:');
  const id = startTimer(db, 0);
  pauseTimer(db, 10 * MIN);
  stopTimer(db, 30 * MIN);
  const s = getSession(db, id);
  assert.equal(s.end_utc, 30 * MIN);
  assert.equal(s.pause_started_at, null);
  assert.equal(s.paused_ms, 20 * MIN); // paused 10->30
});

test('pause/resume/stop with nothing active return null', () => {
  const db = openDb(':memory:');
  assert.equal(pauseTimer(db, 1), null);
  assert.equal(resumeTimer(db, 1), null);
  assert.equal(stopTimer(db, 1), null);
  assert.equal(timerState(db, 1).state, 'none');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/timer.test.js`
Expected: FAIL.

- [ ] **Step 3: Rewrite `src/timer.js`**

```js
import { createSession, getSession, updateSession, decorateSession } from './sessions.js';
import { getSettings } from './settings.js';

export function getActiveSession(db) {
  return db.prepare('SELECT * FROM session WHERE end_utc IS NULL').get();
}

function foldPause(active, now) {
  // returns extra paused_ms to add if currently paused
  return active.pause_started_at == null ? 0 : now - active.pause_started_at;
}

export function stopTimer(db, now) {
  const active = getActiveSession(db);
  if (!active) return null;
  updateSession(db, active.id, {
    endUtc: now,
    pausedMs: active.paused_ms + foldPause(active, now),
    pauseStartedAt: null,
  });
  return active.id;
}

export function startTimer(db, now, { taskId = null, description = '' } = {}) {
  const tx = db.transaction(() => {
    stopTimer(db, now);
    return createSession(db, { taskId, description, startUtc: now, endUtc: null, createdAt: now });
  });
  return tx();
}

export function pauseTimer(db, now) {
  const active = getActiveSession(db);
  if (!active || active.pause_started_at != null) return active ? active.id : null;
  updateSession(db, active.id, { pauseStartedAt: now });
  return active.id;
}

export function resumeTimer(db, now) {
  const active = getActiveSession(db);
  if (!active || active.pause_started_at == null) return active ? active.id : null;
  updateSession(db, active.id, {
    pausedMs: active.paused_ms + (now - active.pause_started_at),
    pauseStartedAt: null,
  });
  return active.id;
}

export function timerState(db, now) {
  const active = getActiveSession(db);
  if (!active) return { state: 'none', session: null, elapsedMs: 0 };
  const session = decorateSession(db, getSession(db, active.id), now, getSettings(db).rounding_minutes);
  return { state: session.paused ? 'paused' : 'running', session, elapsedMs: session.durationMs };
}
```

Note: `pauseTimer`/`resumeTimer` return the active id even when already in the requested state (idempotent); only `null` when nothing is active. The tests assert null only for the no-active case.

- [ ] **Step 4: Run tests**

Run: `node --test test/timer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(timer): pause-ms state machine"
```

---

## Task 5: routes/tracking.js — grouping, resume, edit-while-running

**Files:**
- Modify: `src/routes/tracking.js`, `test/routes-tracking.test.js`

**Interfaces:**
- Consumes: `timer.js` (`startTimer, pauseTimer, resumeTimer, stopTimer, timerState, getActiveSession`), `sessions.js` (`listSessions, decorateSession, updateSession, setSessionTags`), `settings.js`, `catalog.js` (`listTasks, listTags`).
- Produces: `trackingRouter(db, hub)`:
  - `groupByDay` anchors on `session.start_utc`.
  - `GET /` renders tracking page with `state`, groups, `tasks`, `tags`, `descriptions` (for datalist).
  - `GET /partials/active-timer` renders the active-timer fragment (needs `tasks, tags`).
  - `GET /partials/tracking-list`.
  - `POST /timer/start`, `/timer/pause`, `/timer/resume` (no id), `/timer/stop` → mutate, broadcast, render active-timer.
  - `POST /timer/update` → update the active session's `description, details, taskId, tags`; broadcast; render active-timer.
  - Exports `fmtDuration, fmtMoney, escapeHtml` unchanged.

- [ ] **Step 1: Update `test/routes-tracking.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';
import { getActiveSession } from '../src/timer.js';
import { getSession } from '../src/sessions.js';
import { createTask } from '../src/catalog.js';

test('start creates a running session and broadcasts', async () => {
  const events = [];
  const { app, db } = makeApp({ hub: { broadcast: (t) => events.push(t || 'changed'), handleConnection() {} } });
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/timer/start');
  assert.equal(res.status, 200);
  assert.ok(getActiveSession(db));
  assert.deepEqual(events, ['changed']);
});

test('pause then resume keeps one active session', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  await agent.post('/timer/start');
  await agent.post('/timer/pause');
  await agent.post('/timer/resume');
  await agent.post('/timer/stop');
  assert.equal(getActiveSession(db), undefined);
});

test('edit while running updates description and task', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const t = createTask(db, { name: 'Paid' });
  await agent.post('/timer/start');
  const id = getActiveSession(db).id;
  const res = await agent.post('/timer/update').type('form').send({ description: 'Live edit', taskId: String(t) });
  assert.equal(res.status, 200);
  const s = getSession(db, id);
  assert.equal(s.description, 'Live edit');
  assert.equal(s.task_id, t);
});

test('naming running work autocompletes empty fields from history', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const t = createTask(db, { name: 'Dev' });
  createSession(db, { description: 'Standup', details: 'daily', taskId: t, startUtc: 1, endUtc: 2 });
  await agent.post('/timer/start');
  const id = getActiveSession(db).id;
  // only description sent; details/task empty -> filled from template
  await agent.post('/timer/update').type('form').send({ description: 'Standup', details: '', taskId: '' });
  const s = getSession(db, id);
  assert.equal(s.details, 'daily');
  assert.equal(s.task_id, t);
});

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/routes-tracking.test.js` (sandbox disabled)
Expected: FAIL.

- [ ] **Step 3: Rewrite `src/routes/tracking.js`**

```js
import express from 'express';
import { startTimer, pauseTimer, stopTimer, resumeTimer, timerState, getActiveSession } from '../timer.js';
import { listSessions, decorateSession, updateSession, setSessionTags, distinctDescriptions, latestByDescription } from '../sessions.js';
import { listTasks, listTags } from '../catalog.js';
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

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}
function dayLabel(ms) {
  return new Date(ms).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function groupByDay(db, sessions, now, rounding) {
  const groups = new Map();
  for (const s of sessions) {
    const d = decorateSession(db, s, now, rounding);
    const anchor = s.start_utc ?? s.created_at;
    const key = dayKey(anchor);
    if (!groups.has(key)) {
      groups.set(key, { key, anchor, label: dayLabel(anchor), sessions: [], totalMs: 0, totalCents: 0 });
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

  function activeCtx() {
    return { state: timerState(db, Date.now()), tasks: listTasks(db), tags: listTags(db), fmtDuration };
  }

  r.get('/', (req, res) => {
    const from = Date.now() - 14 * 24 * 3600 * 1000;
    const sessions = listSessions(db, { from });
    const groups = groupByDay(db, sessions, Date.now(), rounding());
    res.render('tracking', {
      title: 'Time tracking', nav: 'tracking',
      ...activeCtx(), groups, fmtMoney, descriptions: distinctDescriptions(db, '', 50),
    });
  });

  r.get('/partials/active-timer', (req, res) =>
    res.render('partials/active-timer', activeCtx()));

  r.get('/partials/tracking-list', (req, res) => {
    const from = Date.now() - 14 * 24 * 3600 * 1000;
    const groups = groupByDay(db, listSessions(db, { from }), Date.now(), rounding());
    res.render('partials/tracking-list', { groups, fmtDuration, fmtMoney });
  });

  function afterMutation(res) {
    hub.broadcast('changed');
    res.render('partials/active-timer', activeCtx());
  }

  r.post('/timer/start', (req, res) => { startTimer(db, Date.now()); afterMutation(res); });
  r.post('/timer/pause', (req, res) => { pauseTimer(db, Date.now()); afterMutation(res); });
  r.post('/timer/resume', (req, res) => { resumeTimer(db, Date.now()); afterMutation(res); });
  r.post('/timer/stop', (req, res) => { stopTimer(db, Date.now()); afterMutation(res); });

  // Autosave the running editor. When the description changes to a known one,
  // fill still-empty details/task/tags from the most recent matching session
  // (autocomplete), without clobbering values the user already set.
  r.post('/timer/update', (req, res) => {
    const active = getActiveSession(db);
    if (active) {
      const description = req.body.description ?? '';
      let details = req.body.details ?? '';
      let taskId = req.body.taskId ? Number(req.body.taskId) : null;
      let tagIds = (Array.isArray(req.body.tagId) ? req.body.tagId : req.body.tagId ? [req.body.tagId] : []).map(Number).filter(Boolean);
      if (description && description !== active.description) {
        const tpl = latestByDescription(db, description);
        if (tpl) {
          if (!details) details = tpl.details;
          if (taskId == null) taskId = tpl.task_id;
          if (!tagIds.length) tagIds = tpl.tags.map(t => t.id);
        }
      }
      updateSession(db, active.id, { description, details, taskId });
      setSessionTags(db, active.id, tagIds);
    }
    afterMutation(res);
  });

  return r;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/routes-tracking.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(tracking): resume, edit-while-running, day anchor"
```

---

## Task 6: routes/sessions.js — start/end create+edit + autocomplete template

**Files:**
- Modify: `src/routes/sessions.js`, `test/routes-sessions.test.js`

**Interfaces:**
- Consumes: `sessions.js` (`listSessions, getSession, updateSession, setSessionTags, createSession, deleteSession, decorateSession, latestByDescription, distinctDescriptions`), `catalog.js`, `settings.js`, `./tracking.js` (`fmtDuration, fmtMoney, escapeHtml`).
- Produces: `sessionsRouter(db, hub)`:
  - `GET /tasks` → list + filters + manual form; passes `tasks, tags, descriptions, q`.
  - `GET /partials/session-list`.
  - `GET /sessions/:id/edit` → edit form.
  - `POST /sessions/:id` → update description/details/taskId/tags and, if `start` provided, `startUtc/endUtc` (require valid end ≥ start); return `session-item`.
  - `POST /sessions` → manual create; require valid start+end; `pausedMs=0`; return list.
  - `POST /sessions/:id/delete`.
  - `POST /tasks`, `POST /tags` (unchanged, still validate name + broadcast).
  - `GET /sessions/template?description=` → render `partials/wu-fields` prefilled from `latestByDescription` (empty fields if no match).

- [ ] **Step 1: Update `test/routes-sessions.test.js`**

Keep the existing XSS, empty-name, and delete tests. Replace the manual-create/edit/tz tests with start/end versions and add a template test:

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
  createSession(db, { description: 'labeled', startUtc: 1, endUtc: 2 });
  createSession(db, { startUtc: 3, endUtc: 4 });
  const res = await agent.get('/partials/session-list?unlabelled=1');
  assert.match(res.text, /no description/);
  assert.doesNotMatch(res.text, /labeled/);
});

test('manual create requires start and end', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const bad = await agent.post('/sessions').type('form').send({ description: 'x', start: '2026-09-15T09:00' });
  assert.equal(bad.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM session').get().c, 0);
  const ok = await agent.post('/sessions').type('form').send({ description: 'Call', start: '2026-09-15T09:00', end: '2026-09-15T10:00' });
  assert.equal(ok.status, 200);
  const s = db.prepare('SELECT * FROM session').get();
  assert.equal(s.start_utc, Date.parse('2026-09-15T09:00Z'));
  assert.equal(s.end_utc, Date.parse('2026-09-15T10:00Z'));
});

test('edit updates fields and times, returns re-editable row', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const t = createTask(db, { name: 'Paid' });
  const tag = createTag(db, { name: 'Bug' });
  const id = createSession(db, { startUtc: Date.parse('2026-09-15T09:00Z'), endUtc: Date.parse('2026-09-15T10:00Z') });
  const res = await agent.post('/sessions/' + id).type('form')
    .send({ description: 'Fixed', taskId: String(t), tagId: String(tag), start: '2026-09-15T09:30', end: '2026-09-15T10:30' });
  assert.equal(res.status, 200);
  assert.match(res.text, new RegExp(`hx-get="/sessions/${id}/edit"`));
  const s = getSession(db, id);
  assert.equal(s.description, 'Fixed');
  assert.equal(s.start_utc, Date.parse('2026-09-15T09:30Z'));
});

test('template endpoint prefills from last matching description', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const t = createTask(db, { name: 'Dev' });
  createSession(db, { description: 'Bug fix', details: 'notes', taskId: t, startUtc: 1, endUtc: 2 });
  const res = await agent.get('/sessions/template').query({ description: 'Bug fix' });
  assert.equal(res.status, 200);
  assert.match(res.text, /notes/);            // details prefilled
  assert.match(res.text, new RegExp(`value="${t}" selected`)); // task preselected
});

test('empty task name rejected 400', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.post('/tasks').type('form').send({ name: '' });
  assert.equal(res.status, 400);
});

test('xss: q param is escaped', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.get('/tasks').query({ q: '"><script>alert(1)</script>' });
  assert.doesNotMatch(res.text, /<script>alert\(1\)<\/script>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/routes-sessions.test.js`
Expected: FAIL.

- [ ] **Step 3: Rewrite `src/routes/sessions.js`**

```js
import express from 'express';
import { listSessions, getSession, updateSession, setSessionTags,
  createSession, deleteSession, decorateSession, latestByDescription, distinctDescriptions } from '../sessions.js';
import { listTasks, listTags, createTask, createTag } from '../catalog.js';
import { getSettings } from '../settings.js';
import { fmtDuration, fmtMoney, escapeHtml } from './tracking.js';

// Wall-clock times are treated as UTC (v2); timezone setting is future work.
function parseLocal(v) {
  if (!v) return null;
  const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + 'Z';
  const ms = Date.parse(withZone);
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
    const sessions = listSessions(db, filterFrom(q)).map(s => decorateSession(db, s, Date.now(), rounding()));
    res.render('partials/session-list', { sessions, fmtDuration, fmtMoney });
  }

  r.get('/tasks', (req, res) => {
    const sessions = listSessions(db, filterFrom(req.query)).map(s => decorateSession(db, s, Date.now(), rounding()));
    res.render('tasks', {
      title: 'Tasks', nav: 'tasks', sessions,
      tasks: listTasks(db), tags: listTags(db), q: req.query,
      descriptions: distinctDescriptions(db, '', 50), fmtDuration, fmtMoney, escapeHtml,
    });
  });

  r.get('/partials/session-list', (req, res) => renderList(res, req.query));

  r.get('/sessions/template', (req, res) => {
    const tpl = latestByDescription(db, req.query.description || '');
    const s = tpl ? { details: tpl.details, task_id: tpl.task_id, tags: tpl.tags } : { details: '', task_id: null, tags: [] };
    res.render('partials/wu-fields', { s, tasks: listTasks(db), tags: listTags(db) });
  });

  r.get('/sessions/:id/edit', (req, res) => {
    const s = getSession(db, Number(req.params.id));
    res.render('partials/session-edit', { s, tasks: listTasks(db), tags: listTags(db) });
  });

  r.post('/sessions/:id', (req, res) => {
    const id = Number(req.params.id);
    let start, end;
    if (req.body.start) {
      start = parseLocal(req.body.start); end = parseLocal(req.body.end);
      if (!start || !end || end < start) {
        return res.status(400).render('partials/error', { message: 'Start and end times are required' });
      }
    }
    updateSession(db, id, {
      description: req.body.description ?? '',
      details: req.body.details ?? '',
      taskId: req.body.taskId ? Number(req.body.taskId) : null,
      ...(req.body.start ? { startUtc: start, endUtc: end } : {}),
    });
    setSessionTags(db, id, idsFrom(req.body, 'tagId'));
    hub.broadcast('changed');
    const decorated = decorateSession(db, getSession(db, id), Date.now(), rounding());
    res.render('partials/session-item', { s: decorated, fmtDuration });
  });

  r.post('/sessions', (req, res) => {
    const start = parseLocal(req.body.start), end = parseLocal(req.body.end);
    if (!start || !end || end < start) {
      return res.status(400).render('partials/error', { message: 'Start and end times are required' });
    }
    const id = createSession(db, {
      description: req.body.description || '',
      details: req.body.details || '',
      taskId: req.body.taskId ? Number(req.body.taskId) : null,
      startUtc: start, endUtc: end, createdAt: start,
    });
    setSessionTags(db, id, idsFrom(req.body, 'tagId'));
    hub.broadcast('changed');
    renderList(res, {});
  });

  r.post('/sessions/:id/delete', (req, res) => {
    deleteSession(db, Number(req.params.id));
    hub.broadcast('changed');
    res.status(200).end();
  });

  r.post('/tasks', (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Task name is required' });
    createTask(db, { name, color: req.body.color || '#3b82f6', hourlyRateCents: req.body.rate ? Math.round(Number(req.body.rate) * 100) : null });
    hub.broadcast('changed');
    res.render('partials/task-tag-pickers', { tasks: listTasks(db), tags: listTags(db), s: null });
  });

  r.post('/tags', (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Tag name is required' });
    createTag(db, { name, color: req.body.color || '#6b7280' });
    hub.broadcast('changed');
    res.render('partials/task-tag-pickers', { tasks: listTasks(db), tags: listTags(db), s: null });
  });

  return r;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/routes-sessions.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sessions): start/end create+edit, template endpoint"
```

---

## Task 7: Views — new model + shared wu-fields + edit-while-running

**Files:**
- Create: `src/views/partials/wu-fields.ejs`
- Rewrite: `src/views/partials/active-timer.ejs`
- Modify: `src/views/partials/session-edit.ejs`, `src/views/partials/session-item.ejs`, `src/views/partials/session-row.ejs`, `src/views/tracking.ejs`, `src/views/tasks.ejs`, `src/views/settings.ejs`
- Modify: `public/app.js`

**Interfaces:**
- Consumes: route context from Tasks 5-6.
- Produces: `wu-fields.ejs` (details textarea `#…`, task select, tag chips) reused by manual-add, running-edit, session-edit, and the template endpoint. Active-timer supports running/paused + inline edit + a clock seeded with `elapsedMs`. `app.js` exposes `clock(elapsedMs, running)`.

Note on autocomplete wiring — two distinct patterns:
- **Manual-add and session-edit forms** (explicit submit, no autosave): the
  description input carries `hx-get="/sessions/template" hx-trigger="change"
  hx-include="this" hx-target="next .wu-fields" hx-swap="innerHTML"` plus
  `list="desc-options"`. The `.wu-fields` div immediately follows the input, so
  the template fill replaces only those fields.
- **Running editor** (autosaves): the whole editor is one form posting to
  `/timer/update` on `change` with `hx-include="closest form"`. The template is
  applied server-side (fills only still-empty details/task/tags), so there is
  no separate fill request and no swap race. The description input here uses
  only `list="desc-options"` for suggestions — no `hx-get`.

- [ ] **Step 1: Create `src/views/partials/wu-fields.ejs`**

```html
<div class="wu-fields">
  <textarea name="details" placeholder="Details"><%= s && s.details ? s.details : '' %></textarea>
  <select name="taskId" class="task-select">
    <option value="">(no task)</option>
    <% tasks.forEach(t => { %>
      <option value="<%= t.id %>" <%= s && s.task_id === t.id ? 'selected' : '' %>><%= t.name %></option>
    <% }) %>
  </select>
  <div class="chips">
    <% tags.forEach(t => { const on = s && s.tags && s.tags.some(x => x.id === t.id); %>
      <label class="chip<%= on ? ' on' : '' %>" style="--chip: <%= t.color %>">
        <input type="checkbox" name="tagId" value="<%= t.id %>" <%= on ? 'checked' : '' %>>
        <span><%= t.name %></span>
      </label>
    <% }) %>
  </div>
</div>
```

- [ ] **Step 2: Rewrite `src/views/partials/active-timer.ejs`**

Running/paused shows the live clock + Pause|Resume + Stop, plus an inline editor (description + wu-fields) that autosaves on change to `/timer/update`. Idle shows the big Start button.

```html
<div id="active-timer" class="active-timer"
     hx-get="/partials/active-timer" hx-trigger="tt:changed from:body" hx-swap="outerHTML">
  <% if (state.state !== 'none') { const s = state.session; %>
    <div class="timer-card <%= state.state %>">
      <div class="timer-head" x-data="clock(<%= state.elapsedMs %>, <%= state.state === 'running' %>)">
        <span class="dot"></span>
        <span class="elapsed" x-text="text"></span>
        <div class="timer-controls">
          <% if (state.state === 'running') { %>
            <form hx-post="/timer/pause" hx-target="#active-timer" hx-swap="outerHTML"><button class="pause">Pause</button></form>
          <% } else { %>
            <form hx-post="/timer/resume" hx-target="#active-timer" hx-swap="outerHTML"><button class="resume">Resume</button></form>
          <% } %>
          <form hx-post="/timer/stop" hx-target="#active-timer" hx-swap="outerHTML"><button class="stop">Stop</button></form>
        </div>
      </div>
      <form class="timer-edit" hx-post="/timer/update" hx-trigger="change"
            hx-include="closest form" hx-target="#active-timer" hx-swap="outerHTML">
        <input name="description" value="<%= s.description %>" placeholder="What are you working on?" list="desc-options">
        <%- include('wu-fields', { s, tasks, tags }) %>
      </form>
    </div>
  <% } else { %>
    <form hx-post="/timer/start" hx-target="#active-timer" hx-swap="outerHTML">
      <button class="start">Start work</button>
    </form>
  <% } %>
</div>
```

Note: the description input's `hx-trigger="change"` fires both the template fill (its own `hx-get`) and the parent form's autosave (`change` bubbles to the form's `hx-post`). Both are acceptable — the autosave persists the typed description; the template fill populates `.wu-fields`. htmx handles the element's own `hx-get` and the form's delegated trigger independently.

- [ ] **Step 3: Modify `src/views/partials/session-edit.ejs`** to use start_utc/end_utc and wu-fields

```html
<form class="session-item editing" hx-post="/sessions/<%= s.id %>" hx-target="this" hx-swap="outerHTML">
  <input name="description" value="<%= s.description %>" placeholder="Description"
         list="desc-options" hx-get="/sessions/template" hx-trigger="change" hx-include="this"
         hx-target="next .wu-fields" hx-swap="innerHTML">
  <%- include('wu-fields', { s, tasks, tags }) %>
  <div class="time-row">
    <label>Start<input type="datetime-local" name="start"
      value="<%= new Date(s.start_utc).toISOString().slice(0,16) %>"></label>
    <label>End<input type="datetime-local" name="end"
      value="<%= s.end_utc ? new Date(s.end_utc).toISOString().slice(0,16) : '' %>"></label>
  </div>
  <div class="actions">
    <button type="submit">Save</button>
    <button type="button" hx-post="/sessions/<%= s.id %>/delete"
      hx-target="closest .session-item" hx-swap="outerHTML" class="danger">Delete</button>
  </div>
</form>
```

- [ ] **Step 4: Modify `src/views/partials/session-item.ejs`** to show tag chips

```html
<div class="session-item">
  <div hx-get="/sessions/<%= s.id %>/edit" hx-target="closest .session-item" hx-swap="outerHTML" class="clickable">
    <span class="bar" style="background: <%= s.task ? s.task.color : 'var(--line)' %>"></span>
    <div class="meta">
      <div class="title"><%= s.description || '(no description)' %><% if (s.task) { %> · <span class="task"><%= s.task.name %></span><% } %></div>
      <div class="tags">
        <% s.tags.forEach(t => { %><span class="tag" style="--chip: <%= t.color %>"><%= t.name %></span><% }) %>
      </div>
    </div>
    <span class="dur"><%= fmtDuration(s.roundedMs) %></span>
  </div>
</div>
```

- [ ] **Step 5: Modify `src/views/partials/session-row.ejs`** — change the tag span to use `--chip` custom prop (styling in Task 9)

```html
<div class="session-row">
  <span class="bar" style="background: <%= s.task ? s.task.color : 'var(--line)' %>"></span>
  <div class="meta">
    <div class="title"><%= s.description || '(no description)' %><% if (s.task) { %> · <span class="task"><%= s.task.name %></span><% } %></div>
    <div class="tags">
      <% s.tags.forEach(t => { %><span class="tag" style="--chip: <%= t.color %>"><%= t.name %></span><% }) %>
    </div>
  </div>
  <span class="dur"><%= fmtDuration(s.roundedMs) %></span>
</div>
```

- [ ] **Step 6: Modify `src/views/tracking.ejs`** to include the descriptions datalist

```html
<%
  const active = include('partials/active-timer', { state, tasks, tags, fmtDuration });
  const list = include('partials/tracking-list', { groups, fmtDuration, fmtMoney });
  const options = descriptions.map(d => `<option value="${escapeHtmlAttr(d)}">`).join('');
  const body = `${active}
    <datalist id="desc-options">${options}</datalist>
    <div id="tracking-list" hx-get="/partials/tracking-list" hx-trigger="tt:changed from:body" hx-swap="innerHTML">${list}</div>`;
%>
<%- include('layout', { title, nav, body }) %>
```

Because `tracking.ejs` builds `body` as a raw string, define a local escaper at the top of the file (EJS can call functions in scope). Add before `const active`:

```js
function escapeHtmlAttr(str){return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
```

- [ ] **Step 7: Modify `src/views/tasks.ejs`** — manual form gets description+wu-fields+datalist; keep filters

```html
<%
  function escapeHtmlAttr(str){return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  const list = include('partials/session-list', { sessions, fmtDuration, fmtMoney });
  const pickers = include('partials/task-tag-pickers', { tasks, tags, s: null });
  const fields = include('partials/wu-fields', { s: null, tasks, tags });
  const options = descriptions.map(d => `<option value="${escapeHtmlAttr(d)}">`).join('');
  const body = `
    <h1>Tasks</h1>
    <datalist id="desc-options">${options}</datalist>
    <form class="filters" hx-get="/partials/session-list" hx-target="#session-list" hx-swap="innerHTML" hx-trigger="change, submit">
      <input name="q" placeholder="Search description" value="${escapeHtml(q.q || '')}">
      <label class="toggle"><input type="checkbox" name="unlabelled" value="1" ${q.unlabelled ? 'checked' : ''}><span>Unlabelled</span></label>
      <label class="toggle"><input type="checkbox" name="uncategorized" value="1" ${q.uncategorized ? 'checked' : ''}><span>Uncategorized</span></label>
    </form>
    ${pickers}
    <form class="manual" hx-post="/sessions" hx-target="#session-list" hx-swap="innerHTML">
      <input name="description" placeholder="Description" list="desc-options"
             hx-get="/sessions/template" hx-trigger="change" hx-include="this" hx-target="next .wu-fields" hx-swap="innerHTML">
      ${fields}
      <div class="time-row">
        <label>Start<input type="datetime-local" name="start" required></label>
        <label>End<input type="datetime-local" name="end" required></label>
      </div>
      <button>Add work unit</button>
    </form>
    <div id="session-list" hx-get="/partials/session-list" hx-trigger="tt:changed from:body" hx-swap="innerHTML">${list}</div>`;
%>
<%- include('layout', { title, nav, body }) %>
```

- [ ] **Step 8: Modify `src/views/settings.ejs`** — copy "Round up to next", segmented control markup

```html
<%
  const opts = [[0,'Off'],[15,'15 min'],[30,'30 min'],[60,'1 hour']];
  const seg = opts.map(([v,label]) =>
    `<label class="seg${settings.rounding_minutes===v?' on':''}"><input type="radio" name="roundingMinutes" value="${v}" ${settings.rounding_minutes===v?'checked':''}><span>${label}</span></label>`
  ).join('');
  const body = `
    <h1>Settings</h1>
    ${error ? `<p class="err">${error}</p>` : ''}
    <form method="post" action="/settings" class="settings">
      <fieldset><legend>Round up working time to the next…</legend><div class="segmented">${seg}</div></fieldset>
      <button type="submit">Save</button>
    </form>`;
%>
<%- include('layout', { title, nav, body }) %>
```

- [ ] **Step 9: Update `public/app.js` clock signature**

Replace the `clock` component with:

```js
window.Alpine.data('clock', (elapsedMs, running) => ({
  text: '',
  init() {
    const origin = Date.now() - elapsedMs;
    const render = (ms) => {
      const s = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      this.text = (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(sec).padStart(2, '0');
    };
    render(elapsedMs);
    if (running) setInterval(() => render(Date.now() - origin), 1000);
  },
}));
```

- [ ] **Step 10: Run the full suite**

Run: `npm test` (sandbox disabled)
Expected: all pass, clean exit. (Views render through the passing route tests; the smoke test still logs in → start → stop → view.)

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(views): new model, wu-fields, edit-while-running"
```

---

## Task 8: Autocomplete + smoke coverage

**Files:**
- Modify: `test/smoke.test.js`

**Interfaces:**
- Verifies the template endpoint fill and the running/manual description flows end-to-end at the HTTP level (view wiring already committed in Task 7).

- [ ] **Step 1: Extend `test/smoke.test.js`**

Add, after the existing flow, assertions that the tracking page and template work together:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createHub } from '../src/ws.js';
import { seedUser } from '../src/auth.js';
import { createSession } from '../src/sessions.js';
import { createTask } from '../src/catalog.js';

test('e2e: login, start, stop, tracking + tasks pages render', async () => {
  const db = openDb(':memory:');
  const app = createApp({ db, hub: createHub() });
  seedUser(db, 'abe', 'pw');
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: 'abe', password: 'pw' });
  await agent.post('/timer/start');
  await agent.post('/timer/stop');
  const home = await agent.get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /Start work|Resume|Stop/);
  const tasks = await agent.get('/tasks');
  assert.match(tasks.text, /Add work unit/);
});

test('e2e: description template prefills the work-unit fields', async () => {
  const db = openDb(':memory:');
  const app = createApp({ db, hub: createHub() });
  seedUser(db, 'abe', 'pw');
  const t = createTask(db, { name: 'Dev' });
  createSession(db, { description: 'Recurring', details: 'same as before', taskId: t, startUtc: 1, endUtc: 2 });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: 'abe', password: 'pw' });
  const res = await agent.get('/sessions/template').query({ description: 'Recurring' });
  assert.equal(res.status, 200);
  assert.match(res.text, /same as before/);
});
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: all pass, clean exit.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(smoke): cover autocomplete template flow"
```

---

## Task 9: UI overhaul — layout, dark mode, chips, responsive

**Files:**
- Modify: `src/views/layout.ejs`
- Rewrite: `public/app.css`

**Interfaces:**
- Produces: mobile-first layout with a fixed bottom bar (primary control lives in the page; tab nav in a fixed bottom bar), promoted to a side rail at ≥768px. CSS custom properties with a dark-mode block. Tag chips (`.tag`, `.chip`) tinted by `--chip`. Label-tied inputs (`.toggle`, `.seg`, `.chip`) via `:has()`. ≥44px tap targets.

- [ ] **Step 1: Rewrite `src/views/layout.ejs`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title><%= title %></title>
  <link rel="stylesheet" href="/app.css">
  <script src="/vendor/htmx.min.js" defer></script>
  <script src="/vendor/alpine.min.js" defer></script>
  <script src="/app.js" defer></script>
</head>
<body class="<%= (typeof nav !== 'undefined' && nav) ? 'app' : 'auth' %>">
  <% if (typeof nav !== 'undefined' && nav) { %>
  <nav class="tabbar">
    <a href="/" class="<%= nav==='tracking'?'active':'' %>"><span class="ico">⏱</span><span class="lbl">Time</span></a>
    <a href="/tasks" class="<%= nav==='tasks'?'active':'' %>"><span class="ico">☰</span><span class="lbl">Tasks</span></a>
    <a href="/settings" class="<%= nav==='settings'?'active':'' %>"><span class="ico">⚙</span><span class="lbl">Settings</span></a>
    <form method="post" action="/logout" class="logout"><button title="Log out"><span class="ico">⏻</span><span class="lbl">Logout</span></button></form>
  </nav>
  <% } %>
  <main><%- body %></main>
</body>
</html>
```

- [ ] **Step 2: Rewrite `public/app.css`**

```css
:root {
  --bg:#f2f3f5; --card:#fff; --line:#e3e6ea; --ink:#111827; --muted:#6b7280;
  --accent:#2563eb; --green:#16a34a; --amber:#f59e0b; --red:#dc2626;
  --radius:14px; --tap:44px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg:#0f1115; --card:#171a21; --line:#262b34; --ink:#e5e7eb; --muted:#9aa4b2;
    --accent:#3b82f6; --green:#22c55e; --amber:#fbbf24; --red:#ef4444;
  }
}
* { box-sizing: border-box; }
html,body { margin:0; }
body { font:16px/1.45 system-ui, -apple-system, sans-serif; background:var(--bg); color:var(--ink); }
main { max-width:760px; margin:0 auto; padding:16px 16px 96px; }        /* bottom pad clears tabbar */
h1 { font-size:1.5rem; margin:.25rem 0 1rem; }
a { color:var(--accent); }

button, .btn { font:inherit; min-height:var(--tap); padding:.6rem 1rem; border:0; border-radius:12px;
  background:var(--line); color:var(--ink); cursor:pointer; }
button.start { background:var(--green); color:#fff; width:100%; font-size:1.15rem; }
button.resume { background:var(--green); color:#fff; }
button.pause { background:var(--amber); color:#111; }
button.stop, button.danger { background:var(--red); color:#fff; }
input, select, textarea { font:inherit; width:100%; padding:.6rem .7rem; min-height:var(--tap);
  border:1px solid var(--line); border-radius:10px; background:var(--card); color:var(--ink); }
textarea { min-height:3rem; }
fieldset { border:0; padding:0; margin:0; }
legend { color:var(--muted); font-size:.9rem; margin-bottom:.4rem; }
.err { color:var(--red); }
.empty { color:var(--muted); text-align:center; padding:2rem 0; }

/* Cards */
.timer-card, .day-group, .session-item, .session-item.editing, .login { background:var(--card);
  border:1px solid var(--line); border-radius:var(--radius); }

/* Active timer */
.active-timer { margin-bottom:1rem; }
.timer-card { padding:.9rem; display:grid; gap:.7rem; }
.timer-head { display:flex; align-items:center; gap:.6rem; }
.timer-head .dot { width:10px; height:10px; border-radius:50%; background:var(--green); }
.timer-card.paused .timer-head .dot { background:var(--amber); }
.timer-head .elapsed { font-variant-numeric:tabular-nums; font-weight:700; font-size:1.4rem; }
.timer-controls { margin-left:auto; display:flex; gap:.5rem; }
.timer-edit { display:grid; gap:.6rem; }

/* Work-unit shared fields */
.wu-fields { display:grid; gap:.6rem; }

/* Chips (tags) */
.chips { display:flex; flex-wrap:wrap; gap:.4rem; }
.chip { display:inline-flex; align-items:center; gap:.3rem; padding:.35rem .7rem; border-radius:999px;
  border:1.5px solid var(--chip); color:var(--chip); background:transparent; cursor:pointer; min-height:0; font-size:.85rem; }
.chip input { position:absolute; opacity:0; width:0; height:0; }
.chip:has(input:checked) { background:var(--chip); color:#fff; }
.tag { display:inline-block; padding:.1rem .5rem; border-radius:999px; font-size:.72rem;
  background:var(--chip); color:#fff; margin-right:.25rem; }

/* Toggles / segmented / radios tied to labels */
.toggle { display:inline-flex; align-items:center; gap:.4rem; width:auto; padding:.4rem .7rem;
  border:1px solid var(--line); border-radius:999px; cursor:pointer; background:var(--card); }
.toggle input { position:absolute; opacity:0; }
.toggle:has(input:checked) { background:var(--accent); color:#fff; border-color:var(--accent); }
.segmented { display:flex; gap:.3rem; background:var(--line); padding:.25rem; border-radius:12px; }
.seg { flex:1; text-align:center; padding:.5rem; border-radius:9px; cursor:pointer; }
.seg input { position:absolute; opacity:0; }
.seg:has(input:checked) { background:var(--card); font-weight:600; }

/* Day groups + rows */
.day-group { margin-bottom:.8rem; overflow:hidden; }
.day-group header { display:flex; gap:.5rem; align-items:center; padding:.85rem; cursor:pointer; }
.day-group .totals { margin-left:auto; color:var(--muted); }
.session-row, .session-item .clickable { display:flex; gap:.7rem; align-items:center; padding:.7rem .85rem; border-top:1px solid var(--line); }
.session-row .bar, .session-item .bar { width:4px; align-self:stretch; border-radius:3px; }
.session-row .meta, .session-item .meta { min-width:0; }
.session-row .title, .session-item .title { font-weight:500; }
.session-row .dur, .session-item .dur { margin-left:auto; color:var(--muted); white-space:nowrap; }
.session-item.editing { display:grid; gap:.6rem; padding:.85rem; }
.session-item .clickable { cursor:pointer; }
.time-row { display:flex; gap:.6rem; }
.time-row label { display:grid; gap:.2rem; font-size:.8rem; color:var(--muted); }

.filters, .manual, .settings { display:grid; gap:.6rem; margin-bottom:1rem; }
.filters { grid-auto-flow:row; }
#pickers details { border:1px solid var(--line); border-radius:10px; padding:.4rem .7rem; margin-bottom:.5rem; }
#pickers form { display:grid; gap:.5rem; margin-top:.5rem; }

/* Login */
.login { max-width:340px; margin:14vh auto; display:grid; gap:.7rem; padding:1.5rem; }

/* Bottom tab bar (mobile-first) */
.tabbar { position:fixed; left:0; right:0; bottom:0; z-index:10; display:flex;
  background:var(--card); border-top:1px solid var(--line); padding:.25rem; padding-bottom:env(safe-area-inset-bottom); }
.tabbar a, .tabbar .logout button { flex:1; display:flex; flex-direction:column; align-items:center; gap:.1rem;
  text-decoration:none; color:var(--muted); background:transparent; min-height:var(--tap); font-size:.7rem; }
.tabbar a.active { color:var(--accent); }
.tabbar .logout { flex:1; display:flex; }
.tabbar .ico { font-size:1.2rem; }

/* Wide screens: side rail, no bottom bar */
@media (min-width:768px) {
  body.app { display:grid; grid-template-columns:220px 1fr; }
  main { padding:24px 24px 24px; }
  .tabbar { position:sticky; top:0; bottom:auto; height:100vh; flex-direction:column; align-items:stretch;
    border-top:0; border-right:1px solid var(--line); padding:1rem .5rem; gap:.25rem; }
  .tabbar a, .tabbar .logout button { flex:0; flex-direction:row; justify-content:flex-start; gap:.6rem; padding:.6rem .8rem;
    border-radius:10px; font-size:1rem; }
  .tabbar a.active { background:color-mix(in srgb, var(--accent) 12%, transparent); }
  .tabbar .logout { margin-top:auto; flex:0; }
}
```

Note: `color-mix` and `:has()` are supported in current Chrome/Safari/Firefox; acceptable for a self-hosted single-user app.

- [ ] **Step 3: Run the suite (no visual regressions to code)**

Run: `npm test`
Expected: all pass, clean exit.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): responsive layout, dark mode, tag chips"
```

---

## Task 10: Live verification with chrome-devtools MCP (controller-run)

Not a unit task — the controller drives the running app to confirm the UX. Executed after Tasks 1-9 pass and the suite is green.

- [ ] **Step 1: Seed + start the server**

```bash
rm -f data.sqlite
TT_USERNAME=demo TT_PASSWORD=demo DB_PATH=data.sqlite npm run seed
SESSION_SECRET=dev DB_PATH=data.sqlite PORT=3210 npm start   # background
```

- [ ] **Step 2: Drive with chrome-devtools MCP** — new page → `http://localhost:3210`, login, then:
  - Start → confirm running clock ticks; Pause → clock freezes, dot amber; Resume → resumes; Stop.
  - Edit description while running; pick a task; toggle a tag chip (fills/outlines); confirm autosave (reload shows persistence).
  - Type a repeated description → datalist suggestion; on change, wu-fields prefill (details/task/tags).
  - Add a manual work unit; confirm it appears grouped by day with ceil-rounded duration.
  - Resize to a phone viewport (e.g. 390×844): confirm the Start/Pause/Stop control and bottom tab bar are within thumb reach; emulate `prefers-color-scheme: dark` and confirm dark theme.
  - Screenshot: mobile light, mobile dark, desktop light.

- [ ] **Step 3: Record findings** — fix any issues found via the normal task/fix loop; stop the server; `rm -f data.sqlite`.

---

## Self-Review Notes

- **Spec coverage:** .env (T1), drop-segment model + ceil (T2/T3/T4), edit-while-running + autocomplete (T5/T6/T7/T8), UI overhaul incl. bottom bar/side rail, dark mode, tag chips, label-tied inputs, segmented rounding (T9), verification (T10).
- **Pause semantics:** duration excludes `paused_ms` and any open pause; running/paused show raw, stopped rounds up — asserted in calc/sessions/timer tests.
- **Type consistency:** `decorateSession(db, s, now, rounding)` returns `active/paused/running/durationMs/roundedMs/earningsCents`; `timerState` returns `{state, session, elapsedMs}`; `clock(elapsedMs, running)`; `wu-fields` consumes `{s, tasks, tags}` where `s` may be null. Used consistently across tasks.
- **Autocomplete:** description `change` → `/sessions/template` fills `next .wu-fields` (per-form, no global OOB ids); suggestions via server-rendered `<datalist id="desc-options">`.
- **Invariant:** one active session enforced by DB partial unique index + `startTimer` stopping any active first in a transaction.
- **Destructive migration:** documented; delete `data.sqlite`; tests use `:memory:`.
