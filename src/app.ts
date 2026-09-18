import express, { type Request, type Response, type NextFunction } from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { buildSessionMiddleware, requireAuth } from './auth.js';
import { authRouter } from './routes/auth.js';
import { trackingRouter } from './routes/tracking.js';
import { sessionsRouter } from './routes/sessions.js';
import { tasksRouter } from './routes/tasks.js';
import { settingsRouter } from './routes/settings.js';
import { analyticsRouter } from './routes/analytics.js';
import type { Hub } from './types.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ db, hub }: { db: Database.Database; hub: Hub }) {
  const app = express();
  app.set('trust proxy', 1); // behind nginx; honor X-Forwarded-Proto for secure cookies
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
  app.use(requireAuth, sessionsRouter(db, hub));
  app.use(requireAuth, tasksRouter(db, hub));
  app.use(requireAuth, settingsRouter(db, hub));
  app.use(requireAuth, analyticsRouter(db));

  // eslint-disable-next-line no-unused-vars
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    const status = (err as { status?: number }).status || 500;
    if (req.get('HX-Request')) {
      return res.status(status).render('partials/error', { message: 'Something went wrong' });
    }
    res.status(status).send('Something went wrong');
  });
  return app;
}
