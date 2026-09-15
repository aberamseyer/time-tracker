import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildSessionMiddleware, requireAuth } from './auth.js';
import { authRouter } from './routes/auth.js';
import { trackingRouter } from './routes/tracking.js';

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
  app.use(requireAuth, trackingRouter(db, hub));
  return app;
}
