import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildSessionMiddleware, requireAuth } from './auth.js';
import { authRouter } from './routes/auth.js';
import { trackingRouter } from './routes/tracking.js';
import { sessionsRouter } from './routes/sessions.js';
import { tasksRouter } from './routes/tasks.js';
import { settingsRouter } from './routes/settings.js';
import { analyticsRouter } from './routes/analytics.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ db, hub }) {
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
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (req.get('HX-Request')) {
      return res.status(status).render('partials/error', { message: 'Something went wrong' });
    }
    res.status(status).send('Something went wrong');
  });
  return app;
}
