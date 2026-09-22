import Database from 'better-sqlite3';
import { DEFAULT_TASK_COLOR, DEFAULT_TAG_COLOR } from './colors.js';

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
  archived INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS task (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '${DEFAULT_TASK_COLOR}',
  hourly_rate_cents INTEGER,
  client_id INTEGER REFERENCES client(id) ON DELETE SET NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tag (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '${DEFAULT_TAG_COLOR}',
  archived INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS task_tag (
  task_id INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
CREATE TABLE IF NOT EXISTS session (
  id INTEGER PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  task_id INTEGER REFERENCES task(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  start_utc INTEGER,
  end_utc INTEGER,
  paused_ms INTEGER NOT NULL DEFAULT 0,
  pause_started_at INTEGER,
  user_id INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_session
  ON session(user_id) WHERE end_utc IS NULL;
CREATE TABLE IF NOT EXISTS session_tag (
  session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, tag_id)
);
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY,
  business_from TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  week_start INTEGER NOT NULL DEFAULT 1,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  rounding_minutes INTEGER NOT NULL DEFAULT 0,
  session_grouping TEXT NOT NULL DEFAULT 'day',
  invoice_seq INTEGER NOT NULL DEFAULT 0
);
`;

function addColumn(db: Database.Database, table: string, col: string, def: string): void {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch { /* exists */ }
}

export function migrate(db: Database.Database): void {
  db.exec(SCHEMA);
  addColumn(db, 'settings', 'invoice_seq', 'INTEGER NOT NULL DEFAULT 0');
}

export function seedSettings(db: Database.Database, userId = 1): void {
  db.prepare('INSERT OR IGNORE INTO settings (user_id) VALUES (?)').run(userId);
}

// Close DBs before env teardown; unclosed handles assert on node 24 exit.
const openDatabases: Set<Database.Database> = new Set();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const db of openDatabases) {
      try { if (db.open) db.close(); } catch { /* already closing */ }
    }
  });
}

export function openDb(path: string = ':memory:'): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seedSettings(db);
  openDatabases.add(db);
  installExitHook();
  return db;
}
