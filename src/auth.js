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
