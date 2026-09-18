import bcrypt from 'bcryptjs';
import session from 'express-session';
import type { RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import SqliteStoreFactory from 'better-sqlite3-session-store';
import type { UserRow } from './types.js';

const SqliteStore = SqliteStoreFactory(session);

export function hashPassword(pw: string): string {
  return bcrypt.hashSync(pw, 10);
}

export function verifyPassword(pw: string, hash: string): boolean {
  return bcrypt.compareSync(pw, hash);
}

export function seedUser(db: Database.Database, username: string, password: string): void {
  db.prepare(
    `INSERT INTO user (id, username, password_hash) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username,
     password_hash = excluded.password_hash`
  ).run(username, hashPassword(password));
}

export function getUser(db: Database.Database, username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM user WHERE username = ?').get(username) as UserRow | undefined;
}

// SqliteStore starts an internal setInterval for expired-row cleanup but
// never exposes the timer, so it keeps any process alive (fine for the
// long-running server; hangs short-lived tools like `node --test`).
// Capture and unref it without touching store internals.
function createUnrefdSqliteStore(db: Database.Database) {
  const timers: NodeJS.Timeout[] = [];
  const originalSetInterval = global.setInterval;
  global.setInterval = ((...args: Parameters<typeof originalSetInterval>) => {
    const timer = originalSetInterval(...args);
    timers.push(timer);
    return timer;
  }) as typeof global.setInterval;
  let store;
  try {
    store = new SqliteStore({ client: db, expired: { clear: true, intervalMs: 900000 } });
  } finally {
    global.setInterval = originalSetInterval;
  }
  for (const timer of timers) {
    if (timer && typeof timer.unref === 'function') timer.unref();
  }
  return store;
}

export function buildSessionMiddleware(db: Database.Database): RequestHandler {
  const secure = process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';
  return session({
    store: createUnrefdSqliteStore(db),
    secret: process.env.SESSION_SECRET || 'dev-insecure-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure, maxAge: 30 * 24 * 3600 * 1000 },
  });
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (req.session && req.session.userId) return next();
  if (req.get('HX-Request')) {
    res.set('HX-Redirect', '/login');
    return res.status(401).end();
  }
  return res.redirect('/login');
};
